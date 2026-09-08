import { codexThread, isQuotaWall, isRateLimited, maybeRotateGateway, text } from '@bevyl-ai/agent-tools'

import { SECOND_PASS_PROMPT } from '../hand-written-prompts'
import { type Config, log, logRaw } from './config'
import { diffRightLines } from './diff'
import { reviewPrompt } from './prompt'
import { type Pr } from './prs'
import { parseReview, ReviewOutput, type ReviewVerdict } from './verdict'

export type ReviewOutcome = { kind: 'limit'; reason: string } | { kind: 'fail'; reason: string } | ReviewVerdict

const TURN_TIMEOUT_MS = 1_200_000

const nearest = (lines: Set<number>, line: number): string =>
  [...lines]
    .toSorted((a, b) => Math.abs(a - line) - Math.abs(b - line))
    .slice(0, 8)
    .toSorted((a, b) => a - b)
    .join(', ')

export async function runReview(
  cfg: Config,
  pr: Pr,
  priorThread: string,
  diff: string,
  workDir?: string,
): Promise<ReviewOutcome> {
  const valid = diffRightLines(diff)
  const got: { verdict: ReviewVerdict | null } = { verdict: null }
  let session: Awaited<ReturnType<typeof codexThread>> | null = null
  try {
    session = await codexThread({
      workingDirectory: workDir ?? cfg.repoDir,
      codexPath: cfg.codexPath,
      ...(cfg.codexModel ? { model: cfg.codexModel } : {}),
      modelReasoningEffort: cfg.codexEffort,
      tools: (server) =>
        server.registerTool(
          'review_verdict',
          {
            description: 'Submit your verdict. You may call it again to revise; the last call wins.',
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
            inputSchema: ReviewOutput.shape,
          },
          (data) => {
            got.verdict = null
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
            got.verdict = parseReview(data)
            return Promise.resolve(text('noted'))
          },
        ),
    })
    const { thread } = session
    const prompts = [
      reviewPrompt(cfg, pr, priorThread, diff),
      `${SECOND_PASS_PROMPT}\n\nIf that changes your verdict, call review_verdict again. Otherwise you are done.`,
    ]
    for (let turn = 1; turn <= cfg.maxTurns; turn++) {
      const prompt =
        prompts[turn - 1] ??
        `Continuation, turn ${turn} of ${cfg.maxTurns}, same thread. Resume from where you left off; finish by calling review_verdict.`
      // oxlint-disable-next-line no-await-in-loop -- turns are sequential on one thread by definition
      const { items, usage } = await thread.run(prompt, { signal: AbortSignal.timeout(TURN_TIMEOUT_MS) })
      for (const item of items) {
        if (item.type === 'mcp_tool_call') {
          logRaw(`  codex: ⚙ ${item.tool}${item.error ? ` — ${item.error.message}` : ''}\n`)
        }
      }
      if (usage) {
        logRaw(`  codex: turn ${turn} — ${usage.input_tokens + usage.output_tokens} tokens\n`)
      }
      if (turn >= 2 && got.verdict !== null) {
        break
      }
    }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    logRaw(`${raw}\n`)
    const rot = maybeRotateGateway({ reason: raw, pool: cfg.gatewayPool, cooldownMs: cfg.rotateCooldownMs })
    if (rot.rotated) {
      log(`  codex gateway rotated: ${rot.from} → ${rot.to}`)
    }
    const reason = raw.replaceAll('`', ' ').replaceAll(/\s+/g, ' ').trim().slice(0, 220) || 'codex turn failed'
    return isRateLimited(raw) || isQuotaWall(raw) ? { kind: 'limit', reason } : { kind: 'fail', reason }
  } finally {
    session?.close()
  }
  return got.verdict ?? { kind: 'fail', reason: `no verdict after ${cfg.maxTurns} turns` }
}
