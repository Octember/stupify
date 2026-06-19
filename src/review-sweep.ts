#!/usr/bin/env bun
/**
 * stupify (review sweep) — auto-review open GitHub PRs with Codex against a corpus of code YOU picked.
 * The engine the `stupify` CLI deploys to ~/.stupify and runs on a cron (or `stupify run`); config.env sits
 * next to it.
 *
 * OPT-IN by default (SCOPE=label): only PRs tagged REVIEW_LABEL are reviewed, so spend tracks exactly what
 * you tag. SCOPE=auto reviews all non-draft, non-bot PRs under DIFF_LINE_CAP.
 * The "taste" — REVIEW-PROMPT.md, RUBRIC.md, CORPUS.md — lives in the TARGET repo under REVIEW_DIR (default
 * `.review/`), so it's version-controlled with the code it judges and edited via a normal PR.
 * Idempotent: skips a PR already reviewed — or already reported as failed — at its current head SHA, via a
 * hidden marker comment. A new push moves the SHA, clears the markers, and re-arms the review.
 * Per-PR memory: each review is fed the PR's existing review thread, so it won't re-raise resolved/declined
 * items and converges ("no new blocking issues") instead of nagging forever.
 *
 * Single-flight: the sweep takes its own lockfile (state/sweep.lock) so two cron ticks never overlap — no
 * `flock` dependency. Every knob lives in config.env next to this file (read fresh each run). Run: `bun review-sweep.ts`.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KIT_DIR = dirname(fileURLToPath(import.meta.url))

interface Config {
  repoDir: string // dedicated checkout we hard-reset — never a working checkout you care about
  remote: string
  slug: string
  defaultBranch: string
  reviewDir: string // resolved review dir holding REVIEW-PROMPT.md / RUBRIC.md / CORPUS.md — the repo's .review/ if it has one, else homeReviewDir (set in main)
  homeReviewDir: string // fallback taste the CLI assembled under STUPIFY_HOME/.review (packs or bring-your-own)
  scope: 'label' | 'auto'
  reviewLabel: string
  diffLineCap: number
  dryRun: boolean
  maxPrs: number
  stateDir: string
  codexEffort: string
  codexProvider: string // optional `-c model_provider=...`; empty = codex's own default/auth
  codexModel: string // optional `-c model=...`; empty = codex's default model
}

function loadConfig(): Config {
  const file = parseEnvFile(join(KIT_DIR, 'config.env'))
  // A one-shot env override wins over the persisted config.env, so `DRY_RUN=1 bun review-sweep.ts` actually
  // previews even when the deployed file says DRY_RUN=0. Cron sets none of these keys, so it falls to the file.
  const pick = (key: string, fallback: string): string => process.env[key] ?? file[key] ?? fallback
  const int = (key: string, fallback: number, min: number): number => {
    const set = process.env[key] ?? file[key]
    if (set === undefined) return fallback
    const trimmed = set.trim()
    const n = Number(trimmed)
    if (/^\d+$/.test(trimmed) && n >= min) return n
    log(`config: ${key}='${set}' is not an integer ≥ ${min} — using ${fallback}`)
    return fallback
  }
  const bool = (key: string, unset: boolean, onInvalid: boolean): boolean => {
    const set = process.env[key] ?? file[key]
    if (set === undefined) return unset
    const v = set.trim().toLowerCase()
    if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true
    if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false
    log(`config: ${key}='${set}' is not a boolean (1/0/true/false/yes/no/on/off) — using ${onInvalid} (fail-safe)`)
    return onInvalid
  }

  // Home is where the CLI deployed us (~/.stupify) — config.env, state, and the dedicated checkout all live here.
  const stupifyHome = pick('STUPIFY_HOME', KIT_DIR)
  const stateDir = join(stupifyHome, 'state')
  mkdirSync(stateDir, { recursive: true })
  LOG = join(stateDir, 'sweep.log') // set before parsing knobs so config warnings reach sweep.log, not just cron.log

  const slug = pick('REPO_SLUG', '').trim()
  if (!slug) {
    log('config: REPO_SLUG is required (owner/repo) — aborting. Run `stupify` to set up.')
    process.exit(1)
  }
  const scopeRaw = pick('SCOPE', 'label').trim().toLowerCase()
  if (scopeRaw !== 'label' && scopeRaw !== 'auto') log(`config: SCOPE='${scopeRaw}' is not 'label' or 'auto' — using label`)

  return {
    repoDir: join(stupifyHome, 'repo'), // HARD-PINNED under STUPIFY_HOME: refreshRepo runs `git reset --hard` here
    remote: pick('REMOTE', `https://github.com/${slug}.git`),
    slug,
    defaultBranch: pick('DEFAULT_BRANCH', 'main'),
    reviewDir: pick('REVIEW_DIR', '.review'), // relative name here; main() resolves it to an absolute path (repo's or home's)
    homeReviewDir: join(stupifyHome, '.review'),
    scope: scopeRaw === 'auto' ? 'auto' : 'label',
    reviewLabel: pick('REVIEW_LABEL', 'codex-review'),
    diffLineCap: int('DIFF_LINE_CAP', 800, 1),
    dryRun: bool('DRY_RUN', false, true), // unset = live (cron's normal mode); garbage = preview (never post on a typo)
    maxPrs: int('MAX_PRS', 15, 1),
    stateDir,
    codexEffort: pick('CODEX_EFFORT', 'high'),
    codexProvider: pick('CODEX_PROVIDER', ''),
    codexModel: pick('CODEX_MODEL', ''),
  }
}

/** Minimal KEY=VALUE reader for config.env: strips `# inline comments` and matching surrounding quotes, so a
 *  value reads the same here as it does when bash sources the file (`KEY='https://…'` → `https://…`). */
function parseEnvFile(path: string): Record<string, string> {
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

interface ProcResult {
  ok: boolean
  stdout: string
  combined: string
}

function exec(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): ProcResult {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    input: '', // close stdin (codex would otherwise read from the terminal)
    timeout: opts.timeoutMs,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const stdout = r.stdout ?? ''
  // spawnSync reports a timeout via signal (SIGTERM) and a spawn failure (ENOENT etc.) via `error`, both with
  // EMPTY stdout/stderr. Fold them into combined so the failure path surfaces the real cause, not "no output".
  let combined = stdout + (r.stderr ?? '')
  if (r.signal) combined += `\n${cmd}: process killed by ${r.signal}${opts.timeoutMs ? ` (timeout ${opts.timeoutMs}ms)` : ''}`
  if (r.error) combined += `\n${cmd}: ${r.error.message}`
  return { ok: r.status === 0 && r.error === undefined, stdout, combined }
}

let LOG = ''
function log(message: string): void {
  const line = `${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')} ${message}`
  if (LOG) appendFileSync(LOG, `${line}\n`)
  console.log(line)
}

/** Refresh the dedicated checkout to origin/main. Returns false on any git failure. */
function refreshRepo(cfg: Config): boolean {
  mkdirSync(dirname(cfg.repoDir), { recursive: true })
  if (!existsSync(join(cfg.repoDir, '.git'))) {
    log(`cloning ${cfg.remote} -> ${cfg.repoDir}`)
    if (!exec('git', ['clone', '-q', cfg.remote, cfg.repoDir]).ok) return logFail('clone failed')
  }
  const branch = cfg.defaultBranch
  const ok =
    exec('git', ['fetch', '-q', 'origin', branch], { cwd: cfg.repoDir }).ok &&
    exec('git', ['checkout', '-q', branch], { cwd: cfg.repoDir }).ok &&
    exec('git', ['reset', '-q', '--hard', `origin/${branch}`], { cwd: cfg.repoDir }).ok
  return ok || logFail(`refresh failed (is the default branch '${branch}'? set DEFAULT_BRANCH if not)`)
}

function logFail(message: string): false {
  log(message)
  return false
}

interface Pr {
  number: number
  headRefOid: string
  isDraft: boolean
  author: { login: string } | null
  labels: { name: string }[]
}

function listPrs(cfg: Config): Pr[] | null {
  // Filter the PR list directly rather than `gh pr list --label` — that search index lags behind labelling.
  const fields = 'number,headRefOid,isDraft,author,labels'
  const r = exec('gh', ['pr', 'list', '--repo', cfg.slug, '--state', 'open', '--json', fields])
  if (!r.ok) {
    log('gh pr list failed (auth/network down?) — aborting sweep')
    return null
  }
  let raw: unknown
  try {
    raw = JSON.parse(r.stdout)
  } catch {
    log('gh pr list returned unparseable JSON — aborting sweep')
    return null
  }
  if (!Array.isArray(raw)) {
    log('gh pr list returned a non-array — aborting sweep')
    return null
  }
  const prs = raw.filter(isPr)
  if (prs.length < raw.length) log(`gh pr list: ${raw.length - prs.length} entries failed shape check — skipped`)
  return prs
}

// Fully validate the gh boundary. gh guarantees the --json shape, but an auth-error page or schema drift
// would otherwise throw (or silently mis-scope) mid-loop instead of skipping cleanly. `in`-narrowing, no
// assertions. This is a complete `is Pr` — every field inScope/the loop trust is checked here.
function isPr(raw: unknown): raw is Pr {
  if (typeof raw !== 'object' || raw === null) return false
  if (!('number' in raw) || typeof raw.number !== 'number') return false
  if (!('headRefOid' in raw) || typeof raw.headRefOid !== 'string') return false
  if (!('isDraft' in raw) || typeof raw.isDraft !== 'boolean') return false
  if (!('labels' in raw) || !Array.isArray(raw.labels) || !raw.labels.every(isLabel)) return false
  return 'author' in raw && isAuthor(raw.author)
}

function isLabel(raw: unknown): raw is { name: string } {
  return typeof raw === 'object' && raw !== null && 'name' in raw && typeof raw.name === 'string'
}

function isAuthor(raw: unknown): raw is { login: string } | null {
  return raw === null || (typeof raw === 'object' && 'login' in raw && typeof raw.login === 'string')
}

function hasReviewLabel(pr: Pr, cfg: Config): boolean {
  return pr.labels.some((l) => l.name === cfg.reviewLabel)
}

function inScope(pr: Pr, cfg: Config): boolean {
  if (pr.isDraft) return false
  if ((pr.author?.login ?? '').endsWith('[bot]')) return false // never review bot PRs, in EITHER scope
  if (cfg.scope === 'label') return hasReviewLabel(pr, cfg)
  return true // auto: any non-draft, non-bot PR
}

interface Comment {
  login: string
  body: string
}

// null = couldn't read the PR (gh failed or returned junk). The caller SKIPS such a PR rather than treating
// it as unreviewed — manufacturing empty comments here would let a GitHub blip duplicate-post a review.
function prComments(cfg: Config, number: number): Comment[] | null {
  const r = exec('gh', ['pr', 'view', String(number), '--repo', cfg.slug, '--json', 'comments'])
  if (!r.ok) return null
  let raw: unknown
  try {
    raw = JSON.parse(r.stdout)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || !('comments' in raw) || !Array.isArray(raw.comments)) return null
  return raw.comments.map(toComment)
}

function toComment(c: unknown): Comment {
  if (typeof c !== 'object' || c === null) return { login: '', body: '' }
  const body = 'body' in c && typeof c.body === 'string' ? c.body : ''
  const author = 'author' in c ? c.author : null
  const login =
    typeof author === 'object' && author !== null && 'login' in author && typeof author.login === 'string'
      ? author.login
      : ''
  return { login, body }
}

// The per-PR MEMORY: the existing review conversation — the reviewer's past reviews + the author's replies —
// fed back into the prompt so it stops re-litigating settled points and knows when to converge. The GitHub
// thread IS the durable store (survives restarts, already holds the replies); we just read it back.
const MEMORY_COMMENTS = 20 // recent thread context, bounded so the prompt can't balloon on a chatty PR

function priorReviewThread(comments: Comment[]): string {
  return comments
    .filter((c) => !c.login.endsWith('[bot]')) // drop CI bots; keep prior reviews + human/agent replies
    .slice(-MEMORY_COMMENTS)
    .map((c) => `@${c.login}:\n${c.body.replace(/<!--[\s\S]*?-->/g, '').trim()}`) // strip hidden markers
    .filter((entry) => entry.length > 0)
    .join('\n\n---\n\n')
}

// null = couldn't read the diff. The caller skips (auto) or notes it (dry-run) rather than treating an
// unreadable diff as "0 lines" — a silent under-cap that would auto-review something it never measured.
function diffLineCount(cfg: Config, number: number): number | null {
  const r = exec('gh', ['pr', 'diff', String(number), '--repo', cfg.slug])
  if (!r.ok) return null
  if (!r.stdout) return 0
  return r.stdout.split('\n').length - (r.stdout.endsWith('\n') ? 1 : 0)
}

function markersFor(pr: Pr): { mark: string; failMark: string } {
  return {
    mark: `<!-- stupify:${pr.headRefOid} -->`,
    failMark: `<!-- stupify-failed:${pr.headRefOid} -->`,
  }
}

function reviewPrompt(cfg: Config, pr: Pr, priorThread: string): string {
  const { mark } = markersFor(pr)
  const outPath = `/tmp/review-${pr.number}.md`
  const dir = cfg.reviewDir
  const memory = priorThread
    ? `\n\n## Prior reviews on this PR (your memory)
This is the existing review conversation — your past reviews and the author's replies. You are CONTINUING it,
not starting fresh. Apply ${dir}/REVIEW-PROMPT.md's "Prior reviews on this PR" rules: don't re-raise resolved or
reasoned-declined items, report only what's genuinely new, and converge (post the one-line "no new issues"
and stop) if nothing new remains.

${priorThread}`
    : ''
  return `You are a code reviewer running in an automated sweep (you have gh + git; no token needed). DO NOT modify any code.
Read ${dir}/REVIEW-PROMPT.md and ${dir}/RUBRIC.md (the spec + rubric) and ${dir}/CORPUS.md (the curated good-code reference; open the live files it points at as needed). Then:
1. Get the diff:  gh pr diff ${pr.number} --repo ${cfg.slug}
2. Review it per the spec — catch bugs / type-lies / dead-code / footguns AND reinvents-primitive / slop, each citing the corpus primitive it should reuse; sort worst-first.
3. Write the review to ${outPath}, formatted EXACTLY per ${dir}/REVIEW-PROMPT.md's 'Comment format' section (it owns the format — opener, finding blocks, attribution). END the file with exactly this line: ${mark}
4. Post it:  gh pr comment ${pr.number} --repo ${cfg.slug} --body-file ${outPath}
Keep it terse; no preamble.${memory}`
}

/** Run one review. Returns tokens used on success, or null when codex couldn't run (a failure was posted). */
function reviewPr(cfg: Config, pr: Pr, priorThread: string): number | null {
  const { failMark } = markersFor(pr)
  const outPath = `/tmp/review-${pr.number}.md`
  log(`reviewing PR #${pr.number} @ ${pr.headRefOid.slice(0, 8)}`)
  const codexArgs = [
    'exec',
    '--cd',
    cfg.repoDir,
    '--sandbox',
    'workspace-write',
    '-c',
    `model_reasoning_effort=${cfg.codexEffort}`,
    '-c',
    'sandbox_workspace_write.network_access=true',
    '-c',
    'sandbox_workspace_write.writable_roots=["/tmp"]',
  ]
  if (cfg.codexProvider) codexArgs.push('-c', `model_provider=${cfg.codexProvider}`)
  if (cfg.codexModel) codexArgs.push('-c', `model=${cfg.codexModel}`)
  codexArgs.push(reviewPrompt(cfg, pr, priorThread))

  const cx = exec('codex', codexArgs, { cwd: cfg.repoDir, timeoutMs: 1_200_000 })
  appendFileSync(LOG, `${cx.combined}\n`)

  if (cx.ok) {
    const tokens = parseTokens(cx.combined)
    log(`  #${pr.number} done (${tokens ?? '?'} tokens)`)
    return tokens ?? 0
  }

  // Codex couldn't run (provider down, out of credits, timeout, bad diff). Don't fail silently — post a short
  // error on the PR and stamp FAIL_MARK so the next sweep skips this head instead of re-hammering every minute.
  const reason = failureReason(cx.combined)
  log(`  review FAILED for #${pr.number} — ${reason}`)
  const body = [
    "uhh — i couldn't review this one. codex didn't run:",
    '',
    `> ${reason}`,
    '',
    "_— stupify (auto-reviewer). i'll retry on your next push._",
    failMark,
  ].join('\n')
  writeFileSync(outPath, `${body}\n`)
  if (!exec('gh', ['pr', 'comment', String(pr.number), '--repo', cfg.slug, '--body-file', outPath]).ok) {
    log(`    (couldn't post failure comment for #${pr.number} either — gh down?)`)
  }
  return null
}

/** codex prints `tokens used` then the count on the next line — read the last such pair. */
function parseTokens(out: string): number | null {
  const lines = out.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line !== undefined && /tokens used/i.test(line)) {
      const digits = (lines[i + 1] ?? '').replace(/\D/g, '')
      return digits ? Number(digits) : null
    }
  }
  return null
}

function failureReason(out: string): string {
  const signal = /payment required|credits|quota|rate.?limit|429|5\d\d |timeout|killed|enoent|spawn|error/i
  const noise = /no error|0 error/i
  const hit = out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => signal.test(l) && !noise.test(l))
    .at(-1)
  const cleaned = (hit ?? '').replace(/`/g, ' ').slice(0, 220).trim()
  return cleaned || 'codex run failed (no output captured — check the sweep log)'
}

// Single-flight without flock: O_EXCL create wins atomically; a lock older than 30 min (longer than any
// possible sweep — codex is capped at 20) is treated as stale from a crashed run and stolen.
function acquireLock(path: string): boolean {
  try {
    writeFileSync(path, String(process.pid), { flag: 'wx' })
    return true
  } catch {
    try {
      if (Date.now() - statSync(path).mtimeMs > 30 * 60_000) {
        writeFileSync(path, String(process.pid))
        return true
      }
    } catch {
      /* lock vanished between calls — let the next sweep retry */
    }
    return false
  }
}

function main(): void {
  const cfg = loadConfig() // also mkdirs stateDir and sets LOG, so config warnings are already captured

  const lockPath = join(cfg.stateDir, 'sweep.lock')
  if (!acquireLock(lockPath)) {
    log('another sweep already running — skip')
    return
  }
  process.on('exit', () => {
    try {
      rmSync(lockPath, { force: true })
    } catch {
      /* best-effort */
    }
  })

  if (!refreshRepo(cfg)) process.exit(1)
  // Resolve the taste: the target repo's own .review/ wins (a repo can override); otherwise fall back to the
  // home taste the CLI assembled from packs (~/.stupify/.review). Either way cfg.reviewDir becomes ABSOLUTE.
  const repoReview = join(cfg.repoDir, cfg.reviewDir)
  cfg.reviewDir = existsSync(join(repoReview, 'CORPUS.md')) ? repoReview : cfg.homeReviewDir
  const haveMachinery =
    existsSync(join(cfg.reviewDir, 'CORPUS.md')) &&
    existsSync(join(cfg.reviewDir, 'REVIEW-PROMPT.md')) &&
    existsSync(join(cfg.reviewDir, 'RUBRIC.md'))
  if (!haveMachinery) {
    log(`no review machinery at ${cfg.reviewDir}/ (need REVIEW-PROMPT.md + RUBRIC.md + CORPUS.md) — no-op. Run \`stupify setup\` to assemble taste, or add a .review/ to ${cfg.slug}.`)
    return
  }

  const prs = listPrs(cfg)
  if (prs === null) process.exit(1)
  const queue = prs.filter((pr) => inScope(pr, cfg)) // MAX_PRS is applied to PRs actually HANDLED, not iterated (below)

  let reviewed = 0
  let tokens = 0
  // Count PRs we do real (costly) work on, and cap THAT at MAX_PRS — so a backlog of already-reviewed PRs at
  // the front of the list can't consume the budget and starve later ones.
  let handled = 0
  for (const pr of queue) {
    const { mark, failMark } = markersFor(pr)
    const comments = prComments(cfg, pr.number)
    if (comments === null) {
      log(`skip #${pr.number} — couldn't read it from gh (failed/malformed); will retry next sweep`)
      continue
    }
    const bodies = comments.map((c) => c.body).join('\n')
    if (bodies.includes(mark) || bodies.includes(failMark)) continue

    // Past the cheap dedup skip — this PR is a real candidate. Enforce MAX_PRS here, not on the
    // iterated list, and defer the rest to the next sweep.
    if (handled >= cfg.maxPrs) {
      log(`reached MAX_PRS=${cfg.maxPrs} this sweep — deferring remaining candidates to the next sweep`)
      break
    }
    handled += 1

    let lines = 0
    if (cfg.scope === 'auto' || cfg.dryRun) {
      const counted = diffLineCount(cfg, pr.number)
      if (counted === null) {
        log(`skip #${pr.number} — couldn't read its diff from gh; will retry next sweep`)
        continue
      }
      lines = counted
    }
    // auto-scope only: skip oversized diffs UNLESS the PR carries the review label (the documented force-include).
    // (label-scope means you already opted in, so size never gates there.)
    if (cfg.scope === 'auto' && lines > cfg.diffLineCap && !hasReviewLabel(pr, cfg)) {
      log(`skip #${pr.number} — diff ${lines} lines > cap ${cfg.diffLineCap} (add '${cfg.reviewLabel}' to force)`)
      continue
    }
    if (cfg.dryRun) {
      log(`DRY_RUN would review #${pr.number} @ ${pr.headRefOid.slice(0, 8)} (diff ${lines} lines)`)
      continue
    }

    const used = reviewPr(cfg, pr, priorReviewThread(comments))
    if (used !== null) {
      reviewed += 1
      tokens += used
    }
  }

  log(`sweep done — scope=${cfg.scope} reviewed=${reviewed} tokens~${tokens}`)
}

main()
