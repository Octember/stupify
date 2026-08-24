// The sweep's status file (state/status.json) — what `stupify status` renders as a workflow. Best-effort:
// writing it must never break the reviewer.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'

import { z } from 'zod'

import type { Config } from './config'
import type { Pr } from './prs'
import { statusPath } from './state'

const PrStatusState = z.enum(['queued', 'reviewing', 'posted', 'clean', 'dry_run', 'skipped', 'deferred', 'failed'])
type PrStatusState = z.infer<typeof PrStatusState>

export const SweepStatus = z.object({
  version: z.literal(1),
  repo: z.string(),
  scope: z.enum(['label', 'auto']),
  dryRun: z.boolean(),
  stage: z.enum(['starting', 'refreshing', 'loading_taste', 'listing_prs', 'reviewing', 'done', 'blocked']),
  startedAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().optional(),
  message: z.string(),
  totals: z.object({
    openPrs: z.number(),
    inScope: z.number(),
    handled: z.number(),
    reviewed: z.number(),
    skipped: z.number(),
    tokens: z.number(),
    maxPrs: z.number(),
  }),
  prs: z.array(
    z.object({
      number: z.number(),
      title: z.string(),
      head: z.string(),
      state: PrStatusState,
      detail: z.string(),
      lines: z.number().optional(),
      updatedAt: z.string(),
    }),
  ),
})
export type SweepStatus = z.infer<typeof SweepStatus>

export const isoNow = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

export function initialStatus(cfg: Config): SweepStatus {
  const now = isoNow()
  return {
    version: 1,
    repo: cfg.slug,
    scope: cfg.scope,
    dryRun: cfg.dryRun,
    stage: 'starting',
    startedAt: now,
    updatedAt: now,
    message: 'starting sweep',
    totals: { openPrs: 0, inScope: 0, handled: 0, reviewed: 0, skipped: 0, tokens: 0, maxPrs: cfg.maxPrs },
    prs: [],
  }
}

export function writeStatus(cfg: Config, status: SweepStatus): void {
  status.updatedAt = isoNow()
  try {
    mkdirSync(cfg.stateDir, { recursive: true })
    const path = statusPath(cfg)
    const tmp = `${path}.tmp`
    writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`)
    renameSync(tmp, path)
  } catch {
    /* best-effort: status must never break the reviewer */
  }
}

export function setStatusStage(cfg: Config, status: SweepStatus, stage: SweepStatus['stage'], message: string): void {
  status.stage = stage
  status.message = message
  writeStatus(cfg, status)
}

export function seedStatusPrs(cfg: Config, status: SweepStatus, prs: Pr[]): void {
  status.prs = prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    head: pr.headRefOid,
    state: 'queued',
    detail: 'waiting for review slot',
    updatedAt: isoNow(),
  }))
  status.totals.inScope = prs.length
  writeStatus(cfg, status)
}

export function setStatusPr(
  cfg: Config,
  status: SweepStatus,
  pr: Pr,
  state: PrStatusState,
  detail: string,
  lines?: number,
): void {
  const next: SweepStatus['prs'][number] = {
    number: pr.number,
    title: pr.title,
    head: pr.headRefOid,
    state,
    detail,
    updatedAt: isoNow(),
  }
  if (lines !== undefined) {
    next.lines = lines
  }
  const i = status.prs.findIndex((p) => p.number === pr.number)
  if (i !== -1) {
    status.prs[i] = next
  } else {
    status.prs.push(next)
  }
  writeStatus(cfg, status)
}

export function skipStatusPr(
  cfg: Config,
  status: SweepStatus,
  pr: Pr,
  state: 'skipped' | 'deferred',
  detail: string,
  lines?: number,
): void {
  status.totals.skipped += 1
  setStatusPr(cfg, status, pr, state, detail, lines)
}

export function deferQueuedStatusPrs(cfg: Config, status: SweepStatus, prs: Pr[], start: number, detail: string): void {
  for (const pr of prs.slice(start)) {
    const existing = status.prs.find((p) => p.number === pr.number)
    if (existing?.state === 'queued') {
      skipStatusPr(cfg, status, pr, 'deferred', detail)
    }
  }
}
