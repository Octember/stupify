import { isRateLimited } from '@bevyl-ai/agent-tools'
// Running Codex over one PR's diff and classifying the result. The SDK talks to the local `codex` CLI.
import { Codex } from '@openai/codex-sdk'

import { type Config, logRaw } from './config'
import { reviewPrompt } from './prompt'
import { SECOND_PASS_PROMPT } from './second-pass'
import { type Pr } from './prs'
import { parseReviewJson, REVIEW_SCHEMA, type ReviewVerdict } from './verdict'

/** The outcome of running Codex over one PR — classified but NOT acted on. The sweep posts/converges from this;
 *  the ad-hoc `stupify review` prints it or `--post`s it. */
export type ReviewOutcome =
  | { kind: 'limit'; reason: string; raw: string } // plan/credit exhaustion — caller STOPS; raw = full error for the rotation matcher
  | { kind: 'fail'; reason: string } // Codex couldn't produce a review (down, timeout, wrote nothing)
  | ReviewVerdict

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

/** Run Codex over one PR's diff and classify the result. Does NO gh I/O and NO posting — the caller owns those. */
export async function runReview(
  cfg: Config,
  pr: Pr,
  priorThread: string,
  diff: string,
  workDir?: string,
): Promise<ReviewOutcome> {
  const cwd = workDir ?? cfg.repoDir
  try {
    const thread = new Codex({ codexPathOverride: Bun.which('codex') ?? 'codex' }).startThread({
      workingDirectory: cwd,
    })
    await thread.run(reviewPrompt(cfg, pr, priorThread, diff), {
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    })
    const second = await thread.run(SECOND_PASS_PROMPT, {
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      outputSchema: REVIEW_SCHEMA,
    })
    return parseReviewJson(second.finalResponse)
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    logRaw(`${raw}\n`)
    return callFailed(raw)
  }
}
