// Running codex over one PR's diff and classifying the result. codex runs sandboxed with no network of its own
// and /tmp-only writes, so a prompt-injected diff can at worst make it write a junk review file: it cannot
// exfiltrate, touch the gh token, or run commands. Callers decide what to do with the outcome.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { isRateLimited } from '@bevyl-ai/agent-tools'
import { z } from 'zod'

import { type ModelOpts, modelArgs } from './codex-args'
import { type Config, logRaw } from './config'
import { reviewOutPath, reviewPrompt, SECOND_PASS_PROMPT } from './prompt'
import { type Pr } from './prs'
import { type ParsedFinding, parseReviewJson, REVIEW_SCHEMA } from './verdict'

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
): Promise<string> {
  let child
  try {
    child = Bun.spawn([cmd, ...args], {
      cwd: opts.cwd,
      stdin: new TextEncoder().encode(opts.input),
      stdout: 'pipe',
      stderr: 'pipe',
    })
  } catch (error) {
    const combined = `${cmd}: ${error instanceof Error ? error.message : String(error)}`
    logRaw(`${combined}\n`)
    throw new Error(combined, { cause: error })
  }
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
  logRaw(`${combined}\n`)
  if (code !== 0 || child.signalCode !== null) {
    throw new Error(combined)
  }
  return stdout
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

function firstMatch<T>(out: string, schema: z.ZodType<T>, fromEnd: boolean): T | undefined {
  const events = fromEnd ? jsonEvents(out).toReversed() : jsonEvents(out)
  for (const event of events) {
    const parsed = schema.safeParse(event)
    if (parsed.success) {
      return parsed.data
    }
  }
  return undefined
}

export function codexThreadId(out: string): string {
  const event = firstMatch(out, ThreadStartedEvent, false)
  if (event === undefined) {
    throw new Error('codex did not report a thread id for the second review pass')
  }
  return event.thread_id
}

export function codexTokens(out: string): number | null {
  const event = firstMatch(out, TurnCompletedEvent, true)
  if (event === undefined) {
    return null
  }
  return event.usage.input_tokens + event.usage.output_tokens
}

export function codexFinalMessage(out: string): string {
  const event = firstMatch(out, AgentMessageEvent, true)
  if (event === undefined) {
    return ''
  }
  return event.item.text.trim()
}

function addedTokens(first: string, second: string): number | null {
  const a = codexTokens(first)
  const b = codexTokens(second)
  if (a === null && b === null) {
    return null
  }
  return (a ?? 0) + (b ?? 0)
}

const MODEL_TIMEOUT_MS = 1_200_000

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

async function modelCall(
  cfg: Config,
  cwd: string,
  input: string,
  opts: ModelOpts = {},
): Promise<{ stdout: string; message: string; threadId: string }> {
  const args = modelArgs(cfg, cwd, opts)
  if (opts.outPath !== undefined) {
    rmSync(opts.outPath, { force: true })
  }
  const stdout = await execAsync('codex', args, { cwd, timeoutMs: MODEL_TIMEOUT_MS, input })
  let message = ''
  if (opts.outPath !== undefined && existsSync(opts.outPath)) {
    message = readFileSync(opts.outPath, 'utf8').trim()
  }
  if (message.length === 0) {
    message = codexFinalMessage(stdout)
  }
  return { stdout, message, threadId: opts.threadId ?? codexThreadId(stdout) }
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
  const schemaPath = join(cfg.stateDir, 'review-schema.json')
  writeFileSync(schemaPath, JSON.stringify(REVIEW_SCHEMA))
  const paths = { schemaPath, outPath }

  try {
    const first = await modelCall(cfg, cwd, reviewPrompt(cfg, pr, priorThread, diff, dismissed))
    const second = await modelCall(cfg, cwd, SECOND_PASS_PROMPT, { ...paths, threadId: first.threadId })
    const verdict = parseReviewJson(second.message)
    const tokens = addedTokens(first.stdout, second.stdout)
    if (verdict.kind === 'fixed') {
      return { kind: 'fixed', tokens }
    }
    if (verdict.kind === 'no_new_issues') {
      return { kind: 'noop', tokens }
    }
    return { kind: 'review', opener: verdict.opener, findings: verdict.findings, tokens }
  } catch (error) {
    return callFailed(error instanceof Error ? error.message : String(error))
  }
}
