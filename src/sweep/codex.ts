// Running codex over one PR's diff and classifying the result. codex runs sandboxed with no network of its own
// and /tmp-only writes, so a prompt-injected diff can at worst make it write a junk review file: it cannot
// exfiltrate, touch the gh token, or run commands. Callers decide what to do with the outcome.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { isRateLimited } from '@bevyl-ai/agent-tools'
import { z } from 'zod'

import { type Config, logRaw } from './config'
import { reviewOutPath, reviewPrompt } from './prompt'
import { type Pr } from './prs'
import { type ParsedFinding, parseReview, REVIEW_SCHEMA } from './verdict'

/** The outcome of running codex over one PR — classified but NOT acted on. The sweep posts/converges from this;
 *  the ad-hoc `stupify review` prints it or `--post`s it. */
export type ReviewOutcome =
  | { kind: 'limit'; reason: string; raw: string } // plan/credit exhaustion — caller STOPS; raw = full codex output for the rotation matcher (reason is a truncated excerpt that can miss the quota signature)
  | { kind: 'fail'; reason: string } // codex couldn't produce a review (down, timeout, wrote nothing)
  | { kind: 'noop'; tokens: number | null } // verdict no_new_issues → stay silent / re-approve
  | { kind: 'fixed'; tokens: number | null } // verdict fixed → prior findings resolved
  | { kind: 'review'; opener: string; findings: ParsedFinding[]; tokens: number | null } // parsed + validated findings (no marker yet)

// Async twin of the kit's `exec`, same result shape — ONLY for the codex child, so several multi-minute reviews
// can run at once while every gh call around them stays the kit's sync exec.
async function execAsync(
  cmd: string,
  args: string[],
  opts: { cwd: string; input: string; timeoutMs: number },
): Promise<{ ok: boolean; stdout: string; combined: string }> {
  try {
    const child = Bun.spawn([cmd, ...args], {
      cwd: opts.cwd,
      stdin: new TextEncoder().encode(opts.input),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => child.kill(), opts.timeoutMs)
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    clearTimeout(timer)
    const combined = child.signalCode
      ? `${stdout}${stderr}\n${cmd}: process killed by ${child.signalCode} (timeout ${opts.timeoutMs}ms)`
      : stdout + stderr
    return { ok: code === 0 && child.signalCode === null, stdout, combined }
  } catch (error) {
    return { ok: false, stdout: '', combined: `${cmd}: ${error instanceof Error ? error.message : String(error)}` } // spawn failure (ENOENT etc.)
  }
}

const ThreadStartedEvent = z.object({ type: z.literal('thread.started'), thread_id: z.string().min(1) }).passthrough()
const TurnCompletedEvent = z
  .object({
    type: z.literal('turn.completed'),
    usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
  })
  .passthrough()
const AgentMessageEvent = z
  .object({
    type: z.literal('item.completed'),
    item: z.object({ type: z.literal('agent_message'), text: z.string() }),
  })
  .passthrough()

function jsonEvents(out: string): unknown[] {
  return out.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
}

export function codexThreadId(out: string): string | null {
  for (const event of jsonEvents(out)) {
    const parsed = ThreadStartedEvent.safeParse(event)
    if (parsed.success) {
      return parsed.data.thread_id
    }
  }
  return null
}

export function codexTokens(out: string): number | null {
  for (const event of jsonEvents(out).toReversed()) {
    const parsed = TurnCompletedEvent.safeParse(event)
    if (parsed.success) {
      return parsed.data.usage.input_tokens + parsed.data.usage.output_tokens
    }
  }
  return null
}

export function codexFinalMessage(out: string): string {
  for (const event of jsonEvents(out).toReversed()) {
    const parsed = AgentMessageEvent.safeParse(event)
    if (parsed.success) {
      return parsed.data.item.text.trim()
    }
  }
  return ''
}

export const SECOND_PASS_PROMPT = `Look at unchanged code. Drop findings whose job already lives elsewhere; name that path. Keep what still stands. Same JSON schema.

Write bodies like this (no em dash, no emoji, no confidence scores; GitHub already has the file):
- you're adding a second source of truth: reuse the existing one at \`....\`
- this already has an owner at \`....\`. drop the extra state.
- this is bigger than the problem. keep \`....\` and delete the rest.
- this isn't used. delete it.
- this error message isn't honest. it says "speech" and that's not what's happening.

Praise is one of:
![](https://media.giphy.com/media/ftYpwfV6ZcerEa8poV/giphy.gif)
![](https://media.giphy.com/media/3oFzlX9khlRIev1E2Y/giphy.gif)
![](https://media.giphy.com/media/RrVzUOXldFe8M/giphy.gif)
![](https://media.giphy.com/media/a0h7sAqON67nO/giphy.gif)
![](https://media.giphy.com/media/eM0U5NQtVHu30VM5sS/giphy.gif)
![](https://i.fluffy.cc/BPgxZkmsrgmfcDFDCNWC3m4CW0gCJF7w.gif)
![](https://media.giphy.com/media/3ohzAu2U1tOafteBa0/giphy.gif)
Pick one. Don't stack.`

function failureReason(out: string): string {
  const signal = /payment required|credits|quota|rate.?limit|429|5\d\d |timeout|killed|enoent|spawn|error/i
  const noise = /no error|0 error/i
  const hit = out
    .split('\n')
    .map((l) => l.trim())
    .findLast((l) => signal.test(l) && !noise.test(l))
  const cleaned = (hit ?? '').replaceAll('`', ' ').slice(0, 220).trim()
  return cleaned || 'codex run failed (no output captured — check the sweep log)'
}

/** Run codex over one PR's diff and classify the result. Does NO gh I/O and NO posting — the caller owns those. */
export async function runReview(
  cfg: Config,
  pr: Pr,
  priorThread: string,
  diff: string,
  dismissed: string[] = [],
  workDir?: string,
): Promise<ReviewOutcome> {
  const cwd = workDir ?? cfg.repoDir
  const outPath = reviewOutPath(cfg, pr)
  rmSync(outPath, { force: true }) // clear any stale file so we never read a previous run's review
  const schemaPath = join(cfg.stateDir, 'review-schema.json')
  writeFileSync(schemaPath, JSON.stringify(REVIEW_SCHEMA))
  const codexArgs = [
    'exec',
    '--json',
    '--cd',
    cwd,
    '--output-schema',
    schemaPath, // the provider enforces ReviewOutput on the final message...
    '--output-last-message',
    outPath, // ...and the CLI writes that message here — the model never writes the file itself
    '--sandbox',
    'workspace-write',
    '-c',
    `model_reasoning_effort=${cfg.codexEffort}`,
    '-c',
    'sandbox_workspace_write.network_access=false', // locked down: the diff is in the prompt; the caller owns all gh I/O
    '-c',
    'sandbox_workspace_write.writable_roots=["/tmp"]',
  ]
  if (cfg.codexProvider) {
    codexArgs.push('-c', `model_provider=${cfg.codexProvider}`)
  }
  if (cfg.codexModel) {
    codexArgs.push('-c', `model=${cfg.codexModel}`)
  }
  codexArgs.push('-') // read the prompt from STDIN, not argv — the inlined corpus + diff would blow ARG_MAX (E2BIG)

  const cx = await execAsync('codex', codexArgs, {
    cwd,
    timeoutMs: 1_200_000,
    input: reviewPrompt(cfg, pr, priorThread, diff, dismissed),
  })
  logRaw(`${cx.combined}\n`)
  if (!cx.ok) {
    const reason = failureReason(cx.combined)
    return isRateLimited(cx.combined) ? { kind: 'limit', reason, raw: cx.combined } : { kind: 'fail', reason }
  }
  const threadId = codexThreadId(cx.stdout)
  if (threadId === null) {
    return { kind: 'fail', reason: 'codex did not report a thread id for the second review pass' }
  }

  rmSync(outPath, { force: true })
  const resumeArgs = [
    'exec',
    'resume',
    '--json',
    '--output-schema',
    schemaPath,
    '--output-last-message',
    outPath,
    '-c',
    `model_reasoning_effort=${cfg.codexEffort}`,
  ]
  if (cfg.codexProvider) {
    resumeArgs.push('-c', `model_provider=${cfg.codexProvider}`)
  }
  if (cfg.codexModel) {
    resumeArgs.push('-c', `model=${cfg.codexModel}`)
  }
  resumeArgs.push(threadId, '-')

  const second = await execAsync('codex', resumeArgs, {
    cwd,
    timeoutMs: 1_200_000,
    input: SECOND_PASS_PROMPT,
  })
  logRaw(`${second.combined}\n`)
  const fromFile = second.ok && existsSync(outPath) ? readFileSync(outPath, 'utf8').trim() : ''
  // Belt: if the CLI didn't write the last-message file, recover the final message from the transcript. It still
  // has to parse as ReviewOutput, so anything looser fails visibly.
  const review = fromFile || (second.ok ? codexFinalMessage(second.stdout) : '')
  if (review.length === 0) {
    const reason = failureReason(second.combined)
    return isRateLimited(second.combined) ? { kind: 'limit', reason, raw: second.combined } : { kind: 'fail', reason }
  }
  const verdict = parseReview(review)
  if (verdict === null) {
    logRaw(`  unparseable review output for #${pr.number}:\n${review.slice(0, 2000)}\n`)
    const reason = 'codex output was not a valid review JSON (raw output is in the sweep log)'
    return isRateLimited(second.combined) ? { kind: 'limit', reason, raw: second.combined } : { kind: 'fail', reason }
  }
  const firstTokens = codexTokens(cx.stdout)
  const secondTokens = codexTokens(second.stdout)
  const tokens = firstTokens === null && secondTokens === null ? null : (firstTokens ?? 0) + (secondTokens ?? 0)
  if (verdict.kind === 'fixed') {
    return { kind: 'fixed', tokens }
  }
  if (verdict.kind === 'no_new_issues') {
    return { kind: 'noop', tokens }
  }
  return { kind: 'review', opener: verdict.opener, findings: verdict.findings, tokens }
}
