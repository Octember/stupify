// --- Per-VM sweep state: tiny best-effort JSON files (a parse error or fresh VM just re-attempts once). ---
// These lived in @stupify/exe-host, but they are review-sweep domain vocabulary (heads, reviews/day) with
// exactly one consumer, so they live here rather than in the shared kit.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { readJsonFile } from '../parse-json'
import { type Config } from './config'

export const HeadAttempt = z.strictObject({ head: z.string(), at: z.number() })
export type HeadAttempt = z.infer<typeof HeadAttempt>

export const DailyCounter = z.strictObject({ date: z.string(), count: z.number() })
export type DailyCounter = z.infer<typeof DailyCounter>

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

// Whole-file parse-or-{}: these are best-effort caches the sweep itself wrote, so one corrupt entry means the
// file is suspect — re-attempting everything once is the documented failure mode anyway.
const HeadAttempts = z.record(z.string(), HeadAttempt)

export function loadHeadAttempts(path: string): Record<string, HeadAttempt> {
  return readJsonFile(HeadAttempts, path) ?? {}
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
    writeJson(path, attempts)
  } catch {
    /* best-effort */
  }
}

const ReviewedHeads = z.record(z.string(), z.string())

export function loadReviewedHeads(path: string): Record<string, string> {
  return readJsonFile(ReviewedHeads, path) ?? {}
}

export function recordReviewedHead(path: string, reviewed: Record<string, string>, key: string, head: string): void {
  reviewed[key] = head
  try {
    writeJson(path, reviewed)
  } catch {
    /* best-effort */
  }
}

export function loadDailyCounter(path: string, now = new Date()): DailyCounter {
  const today = now.toISOString().slice(0, 10)
  const parsed = readJsonFile(DailyCounter, path)
  if (parsed === undefined || parsed.date !== today) {
    return { date: today, count: 0 }
  } // stale = a new day, not corruption
  return parsed
}

export function bumpDailyCounter(path: string, daily: DailyCounter): void {
  daily.count += 1
  try {
    writeJson(path, daily)
  } catch {
    /* best-effort */
  }
}

export const failuresPath = (cfg: Config): string => join(cfg.stateDir, 'failures.json')
export const reviewedPath = (cfg: Config): string => join(cfg.stateDir, 'reviewed.json')
export const dailyPath = (cfg: Config): string => join(cfg.stateDir, 'daily.json')
export const statusPath = (cfg: Config): string => join(cfg.stateDir, 'status.json')
export const commitStatusPath = (cfg: Config): string => join(cfg.stateDir, 'commit-statuses.json')
