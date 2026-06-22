import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface ProcResult {
  ok: boolean
  stdout: string
  combined: string
}

export interface ExecOptions {
  cwd?: string
  timeoutMs?: number
  input?: string
}

export function exec(cmd: string, args: string[], opts: ExecOptions = {}): ProcResult {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    input: opts.input ?? '',
    timeout: opts.timeoutMs,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const stdout = r.stdout ?? ''
  let combined = stdout + (r.stderr ?? '')
  if (r.signal) combined += `\n${cmd}: process killed by ${r.signal}${opts.timeoutMs ? ` (timeout ${opts.timeoutMs}ms)` : ''}`
  if (r.error) combined += `\n${cmd}: ${r.error.message}`
  return { ok: r.status === 0 && r.error === undefined, stdout, combined }
}

export function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1)
    const comment = value.indexOf(' #')
    let v = (comment < 0 ? value : value.slice(0, comment)).trim()
    if (v.length >= 2 && (v[0] === "'" || v[0] === '"') && v.at(-1) === v[0]) v = v.slice(1, -1)
    out[key] = v
  }
  return out
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function acquireLock(path: string, opts: { staleMs?: number } = {}): boolean {
  const staleMs = opts.staleMs ?? 6 * 60 * 60_000
  try {
    writeFileSync(path, String(process.pid), { flag: 'wx' })
    return true
  } catch {
    try {
      const holder = Number(readFileSync(path, 'utf8').trim())
      if (!pidAlive(holder) || Date.now() - statSync(path).mtimeMs > staleMs) {
        writeFileSync(path, String(process.pid))
        return true
      }
    } catch {
      /* lock vanished or became unreadable; let the next tick retry */
    }
    return false
  }
}

export function releaseLock(path: string): void {
  try {
    if (Number(readFileSync(path, 'utf8').trim()) === process.pid) rmSync(path, { force: true })
  } catch {
    /* best-effort */
  }
}

export function refreshCheckout(opts: { repoDir: string; slug: string; defaultBranch: string; log?: (message: string) => void }): boolean {
  mkdirSync(dirname(opts.repoDir), { recursive: true })
  if (!existsSync(join(opts.repoDir, '.git'))) {
    opts.log?.(`cloning ${opts.slug} -> ${opts.repoDir}`)
    if (!exec('gh', ['repo', 'clone', opts.slug, opts.repoDir, '--', '-q']).ok) return false
  }
  const branch = opts.defaultBranch
  return (
    exec('git', ['fetch', '-q', 'origin', branch], { cwd: opts.repoDir }).ok &&
    exec('git', ['checkout', '-q', branch], { cwd: opts.repoDir }).ok &&
    exec('git', ['reset', '-q', '--hard', `origin/${branch}`], { cwd: opts.repoDir }).ok
  )
}

export interface HeadAttempt {
  head: string
  at: number
}

export interface DailyCounter {
  date: string
  count: number
}

const isObject = (raw: unknown): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null && !Array.isArray(raw)

function readJson(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

export function loadHeadAttempts(path: string): Record<string, HeadAttempt> {
  try {
    const raw = readJson(path)
    if (!isObject(raw)) return {}
    const out: Record<string, HeadAttempt> = {}
    for (const [key, value] of Object.entries(raw)) {
      if (!isObject(value)) continue
      if (typeof value.head === 'string' && typeof value.at === 'number') out[key] = { head: value.head, at: value.at }
    }
    return out
  } catch {
    return {}
  }
}

export function recordHeadAttempt(path: string, attempts: Record<string, HeadAttempt>, key: string, head: string, at = Date.now()): void {
  attempts[key] = { head, at }
  try {
    writeJson(path, attempts)
  } catch {
    /* best-effort */
  }
}

export function loadReviewedHeads(path: string): Record<string, string> {
  try {
    const raw = readJson(path)
    if (!isObject(raw)) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(raw)) if (typeof value === 'string') out[key] = value
    return out
  } catch {
    return {}
  }
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
  try {
    const raw = readJson(path)
    if (!isObject(raw) || raw.date !== today || typeof raw.count !== 'number') return { date: today, count: 0 }
    return { date: today, count: raw.count }
  } catch {
    return { date: today, count: 0 }
  }
}

export function bumpDailyCounter(path: string, daily: DailyCounter): void {
  daily.count += 1
  try {
    writeJson(path, daily)
  } catch {
    /* best-effort */
  }
}

export const isRateLimited = (out: string): boolean =>
  /payment required|credits?\s+exhausted|insufficient\s+(?:credit|quota|balance)|usage limit|rate.?limit|too many requests|\b(?:402|429)\b|quota/i.test(out)
