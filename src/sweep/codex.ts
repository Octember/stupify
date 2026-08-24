// Running codex over one PR's diff and classifying the result. codex runs sandboxed with no network of its own
// and /tmp-only writes, so a prompt-injected diff can at worst make it write a junk review file: it cannot
// exfiltrate, touch the gh token, or run commands. Callers decide what to do with the outcome.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isRateLimited } from '@bevyl-ai/agent-tools'
import { type Config, logRaw } from './config'
import { reviewOutPath, reviewPrompt } from './prompt'
import type { Pr } from './prs'
import { finalCodexMessage, type ParsedFinding, parseReview, REVIEW_SCHEMA } from './verdict'

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
  } catch (e) {
    return { ok: false, stdout: '', combined: `${cmd}: ${e instanceof Error ? e.message : String(e)}` } // spawn failure (ENOENT etc.)
  }
}

/** Run codex over one PR's diff and classify the result. Does NO gh I/O and NO posting — the caller owns those. */
export async function runReview(
  cfg: Config,
  pr: Pr,
  priorThread: string,
  diff: string,
  dismissed: string[] = [],
): Promise<ReviewOutcome> {
  const outPath = reviewOutPath(cfg, pr)
  rmSync(outPath, { force: true }) // clear any stale file so we never read a previous run's review
  const schemaPath = join(cfg.stateDir, 'review-schema.json')
  writeFileSync(schemaPath, JSON.stringify(REVIEW_SCHEMA))
  const codexArgs = [
    'exec',
    '--cd',
    cfg.repoDir,
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
  if (cfg.codexProvider) codexArgs.push('-c', `model_provider=${cfg.codexProvider}`)
  if (cfg.codexModel) codexArgs.push('-c', `model=${cfg.codexModel}`)
  codexArgs.push('-') // read the prompt from STDIN, not argv — the inlined corpus + diff would blow ARG_MAX (E2BIG)

  const cx = await execAsync('codex', codexArgs, {
    cwd: cfg.repoDir,
    timeoutMs: 1_200_000,
    input: reviewPrompt(cfg, pr, priorThread, diff, dismissed),
  })
  logRaw(`${cx.combined}\n`)
  const fromFile = cx.ok && existsSync(outPath) ? readFileSync(outPath, 'utf8').trim() : ''
  // Belt: if the CLI didn't write the last-message file, recover the final message from the transcript. It still
  // has to parse as ReviewOutput, so anything looser fails visibly.
  const review = fromFile || (cx.ok ? finalCodexMessage(cx.combined) : '')
  if (review.length === 0) {
    const reason = failureReason(cx.combined)
    return isRateLimited(cx.combined) ? { kind: 'limit', reason, raw: cx.combined } : { kind: 'fail', reason }
  }
  const verdict = parseReview(review)
  if (verdict === null) {
    logRaw(`  unparseable review output for #${pr.number}:\n${review.slice(0, 2000)}\n`)
    const reason = 'codex output was not a valid review JSON (raw output is in the sweep log)'
    return isRateLimited(cx.combined) ? { kind: 'limit', reason, raw: cx.combined } : { kind: 'fail', reason }
  }
  const tokens = parseTokens(cx.combined)
  if (verdict.kind === 'fixed') return { kind: 'fixed', tokens }
  if (verdict.kind === 'no_new_issues') return { kind: 'noop', tokens }
  return { kind: 'review', opener: verdict.opener, findings: verdict.findings, tokens }
}

/** codex prints `tokens used` then the count on the next line — read the last such pair. */
function parseTokens(out: string): number | null {
  const lines = out.split('\n')
  const i = lines.findLastIndex((line) => line !== undefined && /tokens used/i.test(line))
  if (i === -1) return null
  const digits = (lines[i + 1] ?? '').replace(/\D/g, '')
  return digits ? Number(digits) : null
}

function failureReason(out: string): string {
  const signal = /payment required|credits|quota|rate.?limit|429|5\d\d |timeout|killed|enoent|spawn|error/i
  const noise = /no error|0 error/i
  const hit = out
    .split('\n')
    .map((l) => l.trim())
    .findLast((l) => signal.test(l) && !noise.test(l))
  const cleaned = (hit ?? '').replace(/`/g, ' ').slice(0, 220).trim()
  return cleaned || 'codex run failed (no output captured — check the sweep log)'
}
