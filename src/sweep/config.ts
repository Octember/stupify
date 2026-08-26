// Sweep configuration: every knob lives in config.env next to the deployed engine (read fresh each run), and a
// one-shot env override wins over the persisted file. Also owns the sweep log, set up before knob parsing so
// config warnings reach sweep.log, not just cron.log.
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseEnvFile, refreshCheckout } from '@bevyl-ai/agent-tools'
import { z } from 'zod'

// The deployed engine is a single-file bun bundle, so import.meta.url collapses to the bundle's own location
// (~/.stupify) no matter which source module evaluates it — config.env sits next to the bundle.
const KIT_DIR = dirname(fileURLToPath(import.meta.url))

export const Scope = z.enum(['label', 'auto'])
export type Scope = z.infer<typeof Scope>

export const Config = z.object({
  repoDir: z.string(), // dedicated checkout we hard-reset — never a working checkout you care about
  slug: z.string(),
  defaultBranch: z.string(),
  reviewDir: z.string(), // resolved later to an absolute path (repo .review/ or homeReviewDir)
  homeReviewDir: z.string(), // fallback taste the CLI assembled under STUPIFY_HOME/.review
  scope: Scope,
  reviewLabel: z.string(),
  diffLineCap: z.number(),
  dryRun: z.boolean(),
  maxPrs: z.number(),
  maxReviewsPerDay: z.number(),
  failRetryMs: z.number(),
  stateDir: z.string(),
  codexEffort: z.string(),
  codexProvider: z.string(), // optional `-c model_provider=...`; empty = codex's default
  codexModel: z.string(), // optional `-c model=...`; empty = codex's default
  githubStatus: z.boolean(),
  statusAppId: z.string(),
  statusAppKeyPath: z.string(),
  githubStatusContext: z.string(),
  gatewayPool: z.string(),
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

/** Append raw text (codex transcripts, gh error excerpts) to the sweep log WITHOUT a timestamp or stdout echo. */
export function logRaw(text: string): void {
  if (LOG.path) {
    appendFileSync(LOG.path, text)
  }
}

export function loadConfig(): Config {
  const file = parseEnvFile(join(KIT_DIR, 'config.env'))
  // A one-shot env override wins over the persisted config.env, so `DRY_RUN=1 bun review-sweep.ts` actually
  // previews even when the deployed file says DRY_RUN=0. Cron sets none of these keys, so it falls to the file.
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

  // Home is where the CLI deployed us (~/.stupify) — config.env, state, and the dedicated checkout all live here.
  const stupifyHome = pick('STUPIFY_HOME', KIT_DIR)
  const stateDir = join(stupifyHome, 'state')
  mkdirSync(stateDir, { recursive: true })
  LOG.path = join(stateDir, 'sweep.log') // set before parsing knobs so config warnings reach sweep.log, not just cron.log

  const slug = pick('REPO_SLUG', '').trim()
  if (!slug && !process.env.REVIEW_PR) {
    // `stupify review <pr>` carries the repo in the PR ref, so it doesn't need a configured REPO_SLUG; the sweep does.
    log('config: REPO_SLUG is required (owner/repo) — aborting. Run `stupify setup` to install locally.')
    process.exit(1)
  }
  const scopeRaw = pick('SCOPE', 'auto').trim().toLowerCase()
  if (scopeRaw !== 'label' && scopeRaw !== 'auto') {
    log(`config: SCOPE='${scopeRaw}' is not 'label' or 'auto' — using auto`)
  }

  return Config.parse({
    repoDir: join(stupifyHome, 'repo'), // HARD-PINNED under STUPIFY_HOME: refreshRepo runs `git reset --hard` here
    slug,
    defaultBranch: pick('DEFAULT_BRANCH', 'main'),
    reviewDir: pick('REVIEW_DIR', '.review'), // relative name here; main() resolves it to an absolute path (repo's or home's)
    homeReviewDir: join(stupifyHome, '.review'),
    scope: scopeRaw === 'label' ? 'label' : 'auto', // auto is the default; only the explicit string 'label' opts into per-PR tagging
    reviewLabel: pick('REVIEW_LABEL', 'codex-review'),
    diffLineCap: int('DIFF_LINE_CAP', 20_000, 1), // generous by design — only skips genuinely huge PRs; override via config.env
    dryRun: bool('DRY_RUN', false, true), // unset = live (cron's normal mode); garbage = preview (never post on a typo)
    maxPrs: int('MAX_PRS', 15, 1),
    maxReviewsPerDay: int('MAX_REVIEWS_PER_DAY', 0, 0), // daily cap; 0 = OFF (default). Per-head dedup + MAX_PRS/sweep + the rate-limit early-exit already bound spend; set a number for a hard daily ceiling.
    failRetryMs: int('FAIL_RETRY_MIN', 60, 1) * 60_000, // after a failed review, don't re-attempt that head for this long
    stateDir,
    codexEffort: pick('CODEX_EFFORT', 'high'),
    codexProvider: pick('CODEX_PROVIDER', ''),
    codexModel: pick('CODEX_MODEL', ''),
    githubStatus: bool('GITHUB_STATUS', true, false), // default visible in GitHub; typo disables instead of surprise-posting
    githubStatusContext: pick('GITHUB_STATUS_CONTEXT', 'stupify/review').trim() || 'stupify/review',
    statusAppId: pick('GITHUB_STATUS_APP_ID', '').trim(),
    statusAppKeyPath: pick('GITHUB_STATUS_APP_KEY', '').trim(),
    gatewayPool: pick('CODEX_GATEWAY_POOL', ''),
    rotateCooldownMs: int('CODEX_ROTATE_COOLDOWN_MIN', 10, 0) * 60_000,
    codexJobs: int('CODEX_JOBS', 3, 1), // a review session takes minutes; a small pool keeps a busy sweep from serializing them
  })
}

function logFail(message: string): false {
  log(message)
  return false
}

/** Refresh the dedicated checkout to origin/main. Returns false on any git failure. */
export function refreshRepo(cfg: Config): boolean {
  const existed = existsSync(join(cfg.repoDir, '.git'))
  const ok = refreshCheckout({ repoDir: cfg.repoDir, slug: cfg.slug, defaultBranch: cfg.defaultBranch, log })
  if (!ok && !existed) {
    return logFail('clone failed — is `gh` authed for this repo? (private repos need a gh login / exe.dev integration)')
  }
  return ok || logFail(`refresh failed (is the default branch '${cfg.defaultBranch}'? set DEFAULT_BRANCH if not)`)
}
