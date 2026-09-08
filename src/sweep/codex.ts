import {
  AppServerSession,
  isQuotaWall,
  isRateLimited,
  maybeRotateGateway,
  scrubSecrets,
  tool,
  untilDone,
} from '@bevyl-ai/agent-tools'

import { SECOND_PASS_PROMPT } from '../hand-written-prompts'
import { type Config, log, logRaw } from './config'
import { diffRightLines } from './diff'
import { reviewPrompt } from './prompt'
import { type Pr } from './prs'
import { parseReview, ReviewOutput, type ReviewVerdict } from './verdict'

export type ReviewOutcome = { kind: 'limit'; reason: string } | { kind: 'fail'; reason: string } | ReviewVerdict

const TURN_TIMEOUT_MS = 1_200_000

function callFailed(raw: string): ReviewOutcome {
  const reason = raw.replaceAll('`', ' ').replaceAll(/\s+/g, ' ').trim().slice(0, 220) || 'codex turn failed'

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

const verdictTool = (diff: string, submit: (verdict: ReviewVerdict) => void) => {
  const valid = diffRightLines(diff)
  return tool(
    'review_verdict',
    'Submit your verdict. You may call it again to revise; the last call wins.',
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

      threadSandbox: 'read-only',
      turnSandboxPolicy: { type: 'readOnly' },
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
    {
      scrubEnv: scrubSecrets,

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
    let secondPass = false
    await session.runTurns(
      untilDone({
        prompt: reviewPrompt(cfg, pr, priorThread, diff),
        done: () => secondPass && got.verdict !== null,
        maxTurns: cfg.maxTurns,
        continuation: (turn, max) => {
          if (turn === 2) {
            secondPass = true
            got.verdict = null
            return SECOND_PASS_PROMPT
          }
          return `Continuation, turn ${turn} of ${max}, same thread. Resume from where you left off; finish by calling review_verdict.`
        },
      }),
    )
  } catch (error) {
    session.stop()
    const raw = error instanceof Error ? error.message : String(error)
    logRaw(`${raw}\n`)
    return callFailed(raw)
  }
  return got.verdict ?? { kind: 'fail', reason: `no verdict after ${cfg.maxTurns} turns` }
}
