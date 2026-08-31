import { isRateLimited } from '@bevyl-ai/agent-tools'
import { Codex } from '@openai/codex-sdk'

import { SECOND_PASS_PROMPT } from '../hand-written-prompts'
import { type Config } from './config'
import { reviewPrompt } from './prompt'
import { type Pr } from './prs'
import { parseReview, REVIEW_SCHEMA, type ReviewVerdict } from './verdict'

export type ReviewOutcome =
  | { kind: 'limit'; reason: string; raw: string }
  | { kind: 'fail'; reason: string }
  | ReviewVerdict

const MODEL_TIMEOUT_MS = 1_200_000

export async function runReview(
  cfg: Config,
  pr: Pr,
  priorThread: string,
  diff: string,
  workDir?: string,
): Promise<ReviewOutcome> {
  const cwd = workDir ?? cfg.repoDir
  try {
    const thread = new Codex().startThread({
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
    if (isRateLimited(raw)) {
      return { kind: 'limit', reason: raw, raw }
    }
    return { kind: 'fail', reason: raw }
  }
}
