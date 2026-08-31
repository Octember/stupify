import { isRateLimited } from '@bevyl-ai/agent-tools'
// Running Codex over one PR's diff and classifying the result. The SDK talks to the local `codex` CLI.
import { Codex } from '@openai/codex-sdk'

import { SECOND_PASS_PROMPT } from '../hand-written-prompts'
import { type Config, logRaw } from './config'
import { reviewPrompt } from './prompt'
import { type Pr } from './prs'
import { parseReview, REVIEW_SCHEMA, type ReviewVerdict } from './verdict'

/** The outcome of running Codex over one PR — classified but NOT acted on. The sweep posts/converges from this;
 *  the ad-hoc `stupify review` prints it or `--post`s it. */
export type ReviewOutcome =
  | { kind: 'limit'; reason: string; raw: string } // plan/credit exhaustion — caller STOPS; raw = full error for the rotation matcher
  | { kind: 'fail'; reason: string } // Codex couldn't produce a review (down, timeout, wrote nothing)
  | ReviewVerdict

const MODEL_TIMEOUT_MS = 1_200_000

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
    return parseReview(second.finalResponse)
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    logRaw(`${raw}\n`)
    if (isRateLimited(raw)) {
      return { kind: 'limit', reason: raw, raw }
    }
    return { kind: 'fail', reason: raw }
  }
}
