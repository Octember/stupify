// --- Per-VM sweep state: tiny best-effort JSON files (a parse error or fresh VM just re-attempts once). ---
// These lived in @stupify/exe-host, but they are review-sweep domain vocabulary (heads, reviews/day) with
// exactly one consumer, so they live here rather than in the shared kit.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { type Config } from './config'

export const HeadAttempt = z.strictObject({ head: z.string(), at: z.number() })
export type HeadAttempt = z.infer<typeof HeadAttempt>

export const DailyCounter = z.strictObject({ date: z.string(), count: z.number() })
export type DailyCounter = z.infer<typeof DailyCounter>

// Whole-file parse-or-{}: these are best-effort caches the sweep itself wrote, so one corrupt entry means the
// file is suspect — re-attempting everything once is the documented failure mode anyway.
const HeadAttempts = z.record(z.string(), HeadAttempt)

export function loadHeadAttempts(path: string): Record<string, HeadAttempt> {
  try {
    return HeadAttempts.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return {}
  }
}

export function recordHeadAttempt(
  path: string,
  attempts: Record<string, HeadAttempt>,
  key: string,
  head: string,
  at = Date.now(),
): void {
  attempts[key] = { head, at }
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(attempts))
  } catch {
    /* best-effort */
  }
}

const ReviewedHeads = z.record(z.string(), z.string())

export function loadReviewedHeads(path: string): Record<string, string> {
  try {
    return ReviewedHeads.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return {}
  }
}

export function recordReviewedHead(path: string, reviewed: Record<string, string>, key: string, head: string): void {
  reviewed[key] = head
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(reviewed))
  } catch {
    /* best-effort */
  }
}

export function loadDailyCounter(path: string, now = new Date()): DailyCounter {
  const today = now.toISOString().slice(0, 10)
  try {
    const parsed = DailyCounter.parse(JSON.parse(readFileSync(path, 'utf8')))
    if (parsed.date === today) {
      return parsed
    }
  } catch {
    /* missing or corrupt — a new day */
  }
  return { date: today, count: 0 }
}

export function bumpDailyCounter(path: string, daily: DailyCounter): void {
  daily.count += 1
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(daily))
  } catch {
    /* best-effort */
  }
}

export const failuresPath = (cfg: Config): string => join(cfg.stateDir, 'failures.json')
export const reviewedPath = (cfg: Config): string => join(cfg.stateDir, 'reviewed.json')
export const dailyPath = (cfg: Config): string => join(cfg.stateDir, 'daily.json')
export const statusPath = (cfg: Config): string => join(cfg.stateDir, 'status.json')
export const commitStatusPath = (cfg: Config): string => join(cfg.stateDir, 'commit-statuses.json')
