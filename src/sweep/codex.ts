import { isRateLimited } from '@bevyl-ai/agent-tools'
// Running Codex over one PR's diff and classifying the result. The SDK talks to the local `codex` CLI; we pin
// workspace-write + no network + /tmp-only extra writes so a prompt-injected diff cannot exfiltrate or touch gh.
import { Codex, type CodexOptions, type Usage } from '@openai/codex-sdk'

import { type Config, logRaw } from './config'
import { reviewPrompt, SECOND_PASS_PROMPT } from './prompt'
import { type Pr } from './prs'
import { type ParsedFinding, parseReviewJson, REVIEW_SCHEMA } from './verdict'

/** The outcome of running Codex over one PR — classified but NOT acted on. The sweep posts/converges from this;
 *  the ad-hoc `stupify review` prints it or `--post`s it. */
export type ReviewOutcome =
  | { kind: 'limit'; reason: string; raw: string } // plan/credit exhaustion — caller STOPS; raw = full error for the rotation matcher
  | { kind: 'fail'; reason: string } // Codex couldn't produce a review (down, timeout, wrote nothing)
  | { kind: 'noop'; tokens: number | null } // verdict no_new_issues → stay silent / re-approve
  | { kind: 'fixed'; tokens: number | null } // verdict fixed → prior findings resolved
  | { kind: 'review'; opener: string; findings: ParsedFinding[]; tokens: number | null } // parsed + validated findings (no marker yet)

const MODEL_TIMEOUT_MS = 1_200_000

function usageTokens(usage: Usage | null): number | null {
  if (usage === null) {
    return null
  }
  return usage.input_tokens + usage.output_tokens
}

function addedTokens(first: number | null, second: number | null): number | null {
  if (first === null && second === null) {
    return null
  }
  return (first ?? 0) + (second ?? 0)
}

function failureReason(out: string): string {
  const signal = /payment required|credits|quota|rate.?limit|429|5\d\d |timeout|killed|enoent|spawn|error/i
  const noise = /no error|0 error/i
  const hit = out
    .split('\n')
    .map((l) => l.trim())
    .findLast((l) => signal.test(l) && !noise.test(l))
  const cleaned = (hit ?? '').replaceAll('`', ' ').slice(0, 220).trim()
  if (cleaned.length > 0) {
    return cleaned
  }
  const short = out.replaceAll('`', ' ').trim()
  if (short.length > 0 && short.length <= 220 && !short.includes('\n')) {
    return short
  }
  return 'codex run failed (no output captured — check the sweep log)'
}

function callFailed(out: string): ReviewOutcome {
  const reason = failureReason(out)
  if (isRateLimited(out)) {
    return { kind: 'limit', reason, raw: out }
  }
  return { kind: 'fail', reason }
}

function startThread(cfg: Config, cwd: string) {
  const config: NonNullable<CodexOptions['config']> = {
    model_reasoning_effort: cfg.codexEffort,
    sandbox_workspace_write: {
      network_access: false,
      writable_roots: ['/tmp'],
    },
  }
  if (cfg.codexProvider) {
    config.model_provider = cfg.codexProvider
  }
  const client = new Codex({
    codexPathOverride: Bun.which('codex') ?? 'codex',
    config,
  })
  return client.startThread({
    workingDirectory: cwd,
    sandboxMode: 'workspace-write',
    networkAccessEnabled: false,
    additionalDirectories: ['/tmp'],
    approvalPolicy: 'never',
    ...(cfg.codexModel ? { model: cfg.codexModel } : {}),
  })
}

async function modelTurn(thread: ReturnType<typeof startThread>, input: string, schema?: unknown) {
  const turn = await thread.run(input, {
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    ...(schema === undefined ? {} : { outputSchema: schema }),
  })
  logRaw(`${turn.finalResponse}\n`)
  return { message: turn.finalResponse.trim(), tokens: usageTokens(turn.usage) }
}

/** Run Codex over one PR's diff and classify the result. Does NO gh I/O and NO posting — the caller owns those. */
export async function runReview(
  cfg: Config,
  pr: Pr,
  priorThread: string,
  diff: string,
  dismissed: string[] = [],
  workDir?: string,
): Promise<ReviewOutcome> {
  const cwd = workDir ?? cfg.repoDir
  try {
    const thread = startThread(cfg, cwd)
    const first = await modelTurn(thread, reviewPrompt(cfg, pr, priorThread, diff, dismissed))
    const second = await modelTurn(thread, SECOND_PASS_PROMPT, REVIEW_SCHEMA)
    const verdict = parseReviewJson(second.message)
    const tokens = addedTokens(first.tokens, second.tokens)
    if (verdict.kind === 'fixed') {
      return { kind: 'fixed', tokens }
    }
    if (verdict.kind === 'no_new_issues') {
      return { kind: 'noop', tokens }
    }
    return { kind: 'review', opener: verdict.opener, findings: verdict.findings, tokens }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    logRaw(`${raw}\n`)
    return callFailed(raw)
  }
}
