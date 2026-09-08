import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { type Config } from './config'
import { type Pr } from './prs'

const HeadAttempts = z.record(z.string(), z.strictObject({ head: z.string(), at: z.number() }))
const ReviewedHeads = z.record(z.string(), z.string())
const DailyCounter = z.strictObject({ date: z.string(), count: z.number() })

function load<T>(path: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    return schema.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return fallback
  }
}

export interface SweepState {
  reviewsToday: () => number
  isReviewed: (pr: Pr) => boolean
  recentlyFailed: (pr: Pr, withinMs: number) => boolean
  failed: (pr: Pr) => void
  reviewedHead: (pr: Pr) => void
}

export function sweepState(cfg: Config): SweepState {
  const today = new Date().toISOString().slice(0, 10)
  const failuresPath = join(cfg.stateDir, 'failures.json')
  const reviewedPath = join(cfg.stateDir, 'reviewed.json')
  const dailyPath = join(cfg.stateDir, 'daily.json')
  const failures = load(failuresPath, HeadAttempts, {})
  const reviewed = load(reviewedPath, ReviewedHeads, {})
  let daily = load(dailyPath, DailyCounter, { date: today, count: 0 })
  if (daily.date !== today) {
    daily = { date: today, count: 0 }
  }
  return {
    reviewsToday: () => daily.count,
    isReviewed: (pr) => reviewed[String(pr.number)] === pr.headRefOid,
    recentlyFailed: (pr, withinMs) => {
      const f = failures[String(pr.number)]
      return f !== undefined && f.head === pr.headRefOid && Date.now() - f.at < withinMs
    },
    failed: (pr) => {
      failures[String(pr.number)] = { head: pr.headRefOid, at: Date.now() }
      writeFileSync(failuresPath, JSON.stringify(failures))
    },
    reviewedHead: (pr) => {
      reviewed[String(pr.number)] = pr.headRefOid
      writeFileSync(reviewedPath, JSON.stringify(reviewed))
      daily.count += 1
      writeFileSync(dailyPath, JSON.stringify(daily))
    },
  }
}
