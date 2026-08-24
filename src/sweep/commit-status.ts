// GitHub commit statuses (`stupify/review`) for PR-head workflow visibility. Posted under our own GitHub App
// when configured (the exe.dev integration's gh token is statuses:read-only); gh is the fallback.
import { createSign } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { exec } from '@bevyl-ai/agent-tools'
import { z } from 'zod'

import { parseJson, readJsonFile } from '../parse-json'
import { log } from './config'
import type { Config } from './config'
import type { Pr } from './prs'
import { commitStatusPath } from './state'

const CommitStatusState = z.enum(['pending', 'success', 'failure', 'error'])
export type CommitStatusState = z.infer<typeof CommitStatusState>

const PostedCommitStatus = z.strictObject({ state: CommitStatusState, description: z.string() })
export type PostedCommitStatus = z.infer<typeof PostedCommitStatus>

const PostedCommitStatuses = z.record(z.string(), PostedCommitStatus)

export function loadCommitStatuses(path: string): Record<string, PostedCommitStatus> {
  return readJsonFile(PostedCommitStatuses, path) ?? {}
}

function writeCommitStatuses(path: string, statuses: Record<string, PostedCommitStatus>): void {
  try {
    writeFileSync(path, JSON.stringify(statuses))
  } catch {
    /* best-effort */
  }
}

export const commitStatusDescription = (description: string): string =>
  description.length <= 140 ? description : `${description.slice(0, 137)}...`

const enc = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url')

// The short-lived JWT that authenticates US as our GitHub App (not yet as an installation). iat is backdated 60s
// for clock skew, exp stays under GitHub's 10-minute cap.
export function appJwt(appId: string, privateKeyPem: string, nowSec: number): string {
  const signed = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iat: nowSec - 60, exp: nowSec + 540, iss: appId })}`
  return `${signed}.${createSign('RSA-SHA256').update(signed).sign(privateKeyPem, 'base64url')}`
}

// curl (not gh) for App-authenticated calls: gh on the VMs is wired to the exe.dev proxy via GH_HOST, and these
// calls must hit api.github.com with OUR credentials. The bearer token goes through curl's stdin config, never argv.
function ghAppApi(method: 'GET' | 'POST', path: string, bearer: string, body?: string): { ok: boolean; raw: string } {
  const args = [
    '-sS',
    '--fail-with-body',
    '--max-time',
    '30',
    '-X',
    method,
    '--config',
    '-',
    `https://api.github.com${path}`,
  ]
  if (body !== undefined) {
    args.push('-d', body)
  }
  const r = exec('curl', args, {
    input: `header = "Authorization: Bearer ${bearer}"\nheader = "Accept: application/vnd.github+json"\n`,
  })
  return { ok: r.ok, raw: r.combined }
}

const CachedAppToken = z.strictObject({ token: z.string(), expiresAtMs: z.number() })
type CachedAppToken = z.infer<typeof CachedAppToken>
const AppJson = z.record(z.string(), z.unknown())

const appTokenPath = (cfg: Config): string => join(cfg.stateDir, 'gh-app-token.json')

// Lenient field read on a ghAppApi response body — any non-JSON/non-object shape reads as absent.
const field = (r: { ok: boolean; raw: string }, key: string): unknown => {
  if (!r.ok) {
    return undefined
  }
  return parseJson(AppJson, r.raw)?.[key]
}

/** Mint (or reuse) an installation token for our commit-status App. Cached on disk so the every-minute cron mints
 *  roughly once an hour, not once a sweep. Returns null (with a log) on any failure — the caller skips the status,
 *  same degraded state as a gh outage. */
function appStatusToken(cfg: Config): string | null {
  try {
    const cached = readJsonFile(CachedAppToken, appTokenPath(cfg))
    if (cached !== undefined && cached.expiresAtMs - Date.now() > 5 * 60_000) {
      return cached.token
    }
  } catch {
    /* no usable cache — mint below */
  }
  const pem = (() => {
    try {
      return readFileSync(cfg.statusAppKeyPath, 'utf8')
    } catch {
      return null
    }
  })()
  if (pem === null) {
    log(`  couldn't read GITHUB_STATUS_APP_KEY at ${cfg.statusAppKeyPath} — skipping commit status`)
    return null
  }
  const jwt = appJwt(cfg.statusAppId, pem, Math.floor(Date.now() / 1000))
  const inst = ghAppApi('GET', `/repos/${cfg.slug}/installation`, jwt)
  const instId = field(inst, 'id')
  if (typeof instId !== 'number') {
    log(
      `  status App isn't installed on ${cfg.slug} (or the key/app id is wrong) — ${inst.raw.slice(0, 180).replaceAll(/\s+/g, ' ').trim()}`,
    )
    return null
  }
  const minted = ghAppApi(
    'POST',
    `/app/installations/${instId}/access_tokens`,
    jwt,
    JSON.stringify({ permissions: { statuses: 'write' } }),
  )
  const token = field(minted, 'token')
  if (typeof token !== 'string') {
    log(`  couldn't mint status App token — ${minted.raw.slice(0, 180).replaceAll(/\s+/g, ' ').trim()}`)
    return null
  }
  // GitHub installation tokens live 1h; we cache 55min (the 5-min freshness floor above trims the rest).
  const cache: CachedAppToken = { token, expiresAtMs: Date.now() + 55 * 60_000 }
  try {
    writeFileSync(appTokenPath(cfg), JSON.stringify(cache))
  } catch {
    /* best-effort — re-minting next sweep is just one extra round-trip */
  }
  return token
}

export function setCommitStatus(
  cfg: Config,
  posted: Record<string, PostedCommitStatus>,
  pr: Pr,
  state: CommitStatusState,
  description: string,
): void {
  if (!cfg.githubStatus || cfg.dryRun) {
    return
  }
  const safeDescription = commitStatusDescription(description)
  const key = `${pr.headRefOid}:${cfg.githubStatusContext}`
  const previous = posted[key]
  if (previous?.state === state && previous.description === safeDescription) {
    return
  }

  const payload = {
    state,
    context: cfg.githubStatusContext,
    description: safeDescription,
    target_url: `https://github.com/${cfg.slug}/pull/${pr.number}`,
  }
  // Our own App (when configured) posts the status so it carries our bot identity and statuses:write; the exe.dev
  // integration's gh token is statuses:read-only. gh remains the fallback for setups without an App.
  const r = ((): { ok: boolean; combined: string } | null => {
    if (cfg.statusAppId && cfg.statusAppKeyPath) {
      const token = appStatusToken(cfg)
      if (token === null) {
        return null
      } // already logged
      const post = ghAppApi('POST', `/repos/${cfg.slug}/statuses/${pr.headRefOid}`, token, JSON.stringify(payload))
      return { ok: post.ok, combined: post.raw }
    }
    return exec('gh', ['api', `repos/${cfg.slug}/statuses/${pr.headRefOid}`, '--method', 'POST', '--input', '-'], {
      input: JSON.stringify(payload),
    })
  })()
  if (r === null) {
    return
  }
  if (!r.ok) {
    log(
      `  couldn't post GitHub status for #${pr.number} (${state}) — ${r.combined.slice(0, 180).replaceAll(/\s+/g, ' ').trim()}`,
    )
    return
  }
  posted[key] = { state, description: safeDescription }
  writeCommitStatuses(commitStatusPath(cfg), posted)
}
