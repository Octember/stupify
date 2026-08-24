// The sweep's status file (state/status.json) — what `stupify status` renders as a workflow. Best-effort:
// writing it must never break the reviewer.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import type { Config } from './config'
import type { Pr } from './prs'
import { statusPath } from './state'

type PrStatusState = 'queued' | 'reviewing' | 'posted' | 'clean' | 'dry_run' | 'skipped' | 'deferred' | 'failed'
interface PrStatus {
  number: number
  title: string
  head: string
  state: PrStatusState
  detail: string
  lines?: number
  updatedAt: string
}
export interface SweepStatus {
  version: 1
  repo: string
  scope: Config['scope']
  dryRun: boolean
  stage: 'starting' | 'refreshing' | 'loading_taste' | 'listing_prs' | 'reviewing' | 'done' | 'blocked'
  startedAt: string
  updatedAt: string
  finishedAt?: string
  message: string
  totals: {
    openPrs: number
    inScope: number
    handled: number
    reviewed: number
    skipped: number
    tokens: number
    maxPrs: number
  }
  prs: PrStatus[]
}

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

export function setStatusPr(cfg: Config, status: SweepStatus, pr: Pr, state: PrStatusState, detail: string, lines?: number): void {
  const next: PrStatus = { number: pr.number, title: pr.title, head: pr.headRefOid, state, detail, updatedAt: isoNow() }
  if (lines !== undefined) next.lines = lines
  const i = status.prs.findIndex((p) => p.number === pr.number)
  if (i >= 0) status.prs[i] = next
  else status.prs.push(next)
  writeStatus(cfg, status)
}

export function skipStatusPr(cfg: Config, status: SweepStatus, pr: Pr, state: 'skipped' | 'deferred', detail: string, lines?: number): void {
  status.totals.skipped += 1
  setStatusPr(cfg, status, pr, state, detail, lines)
}

export function deferQueuedStatusPrs(cfg: Config, status: SweepStatus, prs: Pr[], start: number, detail: string): void {
  for (let i = start; i < prs.length; i++) {
    const pr = prs[i]
    if (pr === undefined) continue
    const existing = status.prs.find((p) => p.number === pr.number)
    if (existing?.state === 'queued') skipStatusPr(cfg, status, pr, 'deferred', detail)
  }
}
