// Running Codex over one PR's diff through the kit's app-server session, and classifying the result. The verdict
// is a `review_verdict` TOOL CALL the kit validates against ReviewOutput mid-turn (a bad shape goes back to the
// model as the tool error); the model's text is never read.
import {
  AppServerSession,
  isQuotaWall,
  isRateLimited,
  maybeRotateGateway,
  scrubSecrets,
  tool,
} from '@bevyl-ai/agent-tools'

import { SECOND_PASS_PROMPT } from '../hand-written-prompts'
import { type Config, log, logRaw } from './config'
import { diffRightLines } from './diff'
import { reviewPrompt } from './prompt'
import { type Pr } from './prs'
import { parseReview, ReviewOutput, type ReviewVerdict } from './verdict'

/** The outcome of running Codex over one PR — classified but NOT acted on; review-pr.ts posts/converges from it. */
export type ReviewOutcome =
  | { kind: 'limit'; reason: string } // plan/credit exhaustion — the caller launches no more reviews this sweep
  | { kind: 'fail'; reason: string } // Codex couldn't produce a review (down, timeout, stalled, never submitted)
  | ReviewVerdict

const TURN_TIMEOUT_MS = 1_200_000

function callFailed(raw: string): ReviewOutcome {
  const reason = raw.replaceAll('`', ' ').replaceAll(/\s+/g, ' ').trim().slice(0, 220) || 'codex turn failed'
  // isQuotaWall covers a 502 'ChatGPT account unavailable' (dead login) — the pool must walk past it too.
  if (isRateLimited(raw) || isQuotaWall(raw)) {
    return { kind: 'limit', reason }
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
// after the fact: the verdict is only accepted once the second pass is running (a first-turn call would skip
// the ownership challenge), an anchor must be a right-side line this diff touches (the only lines GitHub
// threads on), and a convergence verdict carries no findings (parseReview).
const verdictTool = (diff: string, secondPass: () => boolean, submit: (verdict: ReviewVerdict) => void) => {
  const valid = diffRightLines(diff)
  return tool(
    'review_verdict',
    'Submit the review verdict. Call once, after the second pass.',
    ReviewOutput,
    (data) => {
      if (!secondPass()) {
        throw new Error('not yet: finish the review, do the second pass when asked, then call review_verdict')
      }
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
  const turns = [reviewPrompt(cfg, pr, priorThread, diff), SECOND_PASS_PROMPT]
  const session = new AppServerSession(
    {
      cwd: workDir ?? cfg.repoDir,
      title: `#${pr.number}`,
      model: cfg.codexModel || undefined,
      effort: cfg.codexEffort,
      // A reviewer reads. The per-TURN policy is what codex enforces; the kit's turn default is full access, so
      // the thread-level string alone would leave both attacker-controlled turns able to write and reach the network.
      threadSandbox: 'read-only',
      turnSandboxPolicy: { type: 'readOnly' },
      turnTimeoutMs: TURN_TIMEOUT_MS,
    },
    [
      verdictTool(
        diff,
        () => turns.length === 0, // both prompts handed out → the second pass is the running turn
        (verdict) => {
          got.verdict = verdict
        },
      ),
    ],
    (event) => {
      if (event.log) {
        logRaw(`  codex: ${event.log}\n`)
      }
    },
    {
      scrubEnv: scrubSecrets,
      // Self-heal a quota wall: advance ~/.codex/config.toml to the next CODEX_GATEWAY_POOL account (the ring
      // bunion and earshot rotate on too). Codex re-reads the file per session, so the next review lands on it.
      // The kit walks the ring only on a real wall, never a transient 429.
      onTurnError: (error) => {
        const rot = maybeRotateGateway({
          reason: String(error),
          pool: cfg.gatewayPool,
          cooldownMs: cfg.rotateCooldownMs,
        })
        if (rot.rotated) {
          log(`  codex gateway rotated: ${rot.from} → ${rot.to}`)
        }
      },
    },
  )
  try {
    await session.runTurns(() => turns.shift() ?? null)
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    logRaw(`${raw}\n`)
    return callFailed(raw)
  }
  return got.verdict ?? { kind: 'fail', reason: 'codex finished without calling review_verdict' }
}
