// Running Codex over one PR's diff through the kit's app-server session, and classifying the result. The verdict
// is a `review_verdict` TOOL CALL the kit validates against ReviewOutput mid-turn (a bad shape goes back to the
// model as the tool error); the model's text is never read.
import { AppServerSession, isQuotaWall, isRateLimited, scrubSecrets, tool } from '@bevyl-ai/agent-tools'

import { SECOND_PASS_PROMPT } from '../hand-written-prompts'
import { type Config, logRaw } from './config'
import { diffRightLines } from './diff'
import { reviewPrompt } from './prompt'
import { type Pr } from './prs'
import { parseReview, ReviewOutput, type ReviewVerdict } from './verdict'

/** The outcome of running Codex over one PR — classified but NOT acted on. The sweep posts/converges from this;
 *  the ad-hoc `stupify review` prints it or `--post`s it. */
export type ReviewOutcome =
  | { kind: 'limit'; reason: string; raw: string } // plan/credit exhaustion — caller STOPS; raw = full error for the rotation matcher
  | { kind: 'fail'; reason: string } // Codex couldn't produce a review (down, timeout, stalled, never submitted)
  | ReviewVerdict

const TURN_TIMEOUT_MS = 1_200_000

function callFailed(raw: string): ReviewOutcome {
  const reason = raw.replaceAll('`', ' ').replaceAll(/\s+/g, ' ').trim().slice(0, 220) || 'codex turn failed'
  // isQuotaWall covers a 502 'ChatGPT account unavailable' (dead login) — the pool must walk past it too.
  if (isRateLimited(raw) || isQuotaWall(raw)) {
    return { kind: 'limit', reason, raw }
  }
  return { kind: 'fail', reason }
}

const nearest = (lines: Set<number>, line: number): string =>
  [...lines]
    .toSorted((a, b) => Math.abs(a - line) - Math.abs(b - line))
    .slice(0, 8)
    .toSorted((a, b) => a - b)
    .join(', ')

// What the schema can't say is thrown here so the MODEL corrects it, instead of the runner demoting the finding
// after the fact: an anchor must be a right-side line this diff touches (the only lines GitHub threads on), and
// a convergence verdict carries no findings (parseReview).
const verdictTool = (diff: string, submit: (verdict: ReviewVerdict) => void) => {
  const valid = diffRightLines(diff)
  return tool(
    'review_verdict',
    'Submit the review verdict. Call once, after the second pass.',
    ReviewOutput,
    (data) => {
      for (const f of data.findings) {
        const lines = valid.get(f.path)
        if (lines === undefined) {
          throw new Error(`${f.path} is not in this diff`)
        }
        if (!lines.has(f.line)) {
          throw new Error(
            `${f.path}:${f.line} is not a line this diff touches; nearest touched lines: ${nearest(lines, f.line)}`,
          )
        }
      }
      submit(parseReview(data))
      return Promise.resolve('noted')
    },
  )
}

/** Run Codex over one PR's diff and classify the result. Does NO gh I/O and NO posting — the caller owns those. */
export async function runReview(
  cfg: Config,
  pr: Pr,
  priorThread: string,
  diff: string,
  workDir?: string,
): Promise<ReviewOutcome> {
  const got: { verdict: ReviewVerdict | null } = { verdict: null }
  const session = new AppServerSession(
    {
      cwd: workDir ?? cfg.repoDir,
      title: `#${pr.number}`,
      model: cfg.codexModel || undefined,
      effort: cfg.codexEffort,
      threadSandbox: 'read-only', // a reviewer reads; the prompt's "don't edit code" is enforced, not requested
      turnTimeoutMs: TURN_TIMEOUT_MS,
    },
    [
      verdictTool(diff, (verdict) => {
        got.verdict = verdict
      }),
    ],
    (event) => {
      if (event.log) {
        logRaw(`  codex: ${event.log}\n`)
      }
    },
    { scrubEnv: scrubSecrets },
  )
  const turns = [reviewPrompt(cfg, pr, priorThread, diff), SECOND_PASS_PROMPT]
  try {
    await session.runTurns(() => turns.shift() ?? null)
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    logRaw(`${raw}\n`)
    return callFailed(raw)
  }
  return got.verdict ?? { kind: 'fail', reason: 'codex finished without calling review_verdict' }
}
