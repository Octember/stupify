import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseEnvFile, refreshCheckout } from '@bevyl-ai/agent-tools'
import { z } from 'zod'

const KIT_DIR = dirname(fileURLToPath(import.meta.url))

export const Scope = z.enum(['label', 'auto'])
export type Scope = z.infer<typeof Scope>

export const Config = z.object({
  repoDir: z.string(),
  slug: z.string(),
  defaultBranch: z.string(),
  reviewDir: z.string(),
  homeReviewDir: z.string(),
  scope: Scope,
  reviewLabel: z.string(),
  diffLineCap: z.number(),
  dryRun: z.boolean(),
  maxPrs: z.number(),
  maxTurns: z.number(),
  maxReviewsPerDay: z.number(),
  failRetryMs: z.number(),
  stateDir: z.string(),
  codexEffort: z.string(),
  codexModel: z.string(),
  gatewayPool: z.array(z.string()),
  rotateCooldownMs: z.number(),
  codexJobs: z.number(),
})
export type Config = z.infer<typeof Config>

const LOG = { path: '' }

export function log(message: string): void {
  const line = `${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')} ${message}`
  if (LOG.path) {
    appendFileSync(LOG.path, `${line}\n`)
  }
  console.log(line)
}

export function logRaw(text: string): void {
  if (LOG.path) {
    appendFileSync(LOG.path, text)
  }
}

export function loadConfig(): Config {
  const file = parseEnvFile(join(KIT_DIR, 'config.env'))

  const pick = (key: string, fallback: string): string => process.env[key] ?? file[key] ?? fallback
  const int = (key: string, fallback: number, min: number): number => {
    const set = process.env[key] ?? file[key]
    if (set === undefined) {
      return fallback
    }
    const trimmed = set.trim()
    const n = Number(trimmed)
    if (/^\d+$/.test(trimmed) && n >= min) {
      return n
    }
    log(`config: ${key}='${set}' is not an integer ≥ ${min} — using ${fallback}`)
    return fallback
  }
  const bool = (key: string, unset: boolean, onInvalid: boolean): boolean => {
    const set = process.env[key] ?? file[key]
    if (set === undefined) {
      return unset
    }
    const v = set.trim().toLowerCase()
    if (v === '1' || v === 'true' || v === 'yes' || v === 'on') {
      return true
    }
    if (v === '0' || v === 'false' || v === 'no' || v === 'off') {
      return false
    }
    log(`config: ${key}='${set}' is not a boolean (1/0/true/false/yes/no/on/off) — using ${onInvalid} (fail-safe)`)
    return onInvalid
  }

  const stupifyHome = pick('STUPIFY_HOME', KIT_DIR)
  const stateDir = join(stupifyHome, 'state')
  mkdirSync(stateDir, { recursive: true })
  LOG.path = join(stateDir, 'sweep.log')

  const slug = pick('REPO_SLUG', '').trim()
  if (!slug) {
    log('config: REPO_SLUG is required (owner/repo) — aborting. See DEPLOY.md.')
    process.exit(1)
  }
  const scopeRaw = pick('SCOPE', 'auto').trim().toLowerCase()
  if (scopeRaw !== 'label' && scopeRaw !== 'auto') {
    log(`config: SCOPE='${scopeRaw}' is not 'label' or 'auto' — using auto`)
  }

  return Config.parse({
    repoDir: join(stupifyHome, 'repo'),
    slug,
    defaultBranch: pick('DEFAULT_BRANCH', 'main'),
    reviewDir: pick('REVIEW_DIR', '.review'),
    homeReviewDir: join(stupifyHome, '.review'),
    scope: scopeRaw === 'label' ? 'label' : 'auto',
    reviewLabel: pick('REVIEW_LABEL', 'codex-review'),
    diffLineCap: int('DIFF_LINE_CAP', 20_000, 1),
    dryRun: bool('DRY_RUN', false, true),
    maxPrs: int('MAX_PRS', 15, 1),
    maxTurns: int('MAX_TURNS', 6, 1),
    maxReviewsPerDay: int('MAX_REVIEWS_PER_DAY', 0, 0),
    failRetryMs: int('FAIL_RETRY_MIN', 60, 1) * 60_000,
    stateDir,
    codexEffort: pick('CODEX_EFFORT', 'high'),
    codexModel: pick('CODEX_MODEL', ''),
    gatewayPool: pick('CODEX_GATEWAY_POOL', '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
    rotateCooldownMs: int('CODEX_ROTATE_COOLDOWN_MIN', 10, 0) * 60_000,
    codexJobs: int('CODEX_JOBS', 3, 1),
  })
}

function logFail(message: string): false {
  log(message)
  return false
}

export function refreshRepo(cfg: Config): boolean {
  const existed = existsSync(join(cfg.repoDir, '.git'))
  const ok = refreshCheckout({ repoDir: cfg.repoDir, slug: cfg.slug, defaultBranch: cfg.defaultBranch, log })
  if (!ok && !existed) {
    return logFail('clone failed — is `gh` authed for this repo? (private repos need a gh login / exe.dev integration)')
  }
  return ok || logFail(`refresh failed (is the default branch '${cfg.defaultBranch}'? set DEFAULT_BRANCH if not)`)
}
