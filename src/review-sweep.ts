#!/usr/bin/env bun
/**
 * stupify (review sweep) — auto-review open GitHub PRs with Codex against a corpus of code YOU picked.
 * The engine the `stupify` CLI deploys to ~/.stupify and runs on a cron (or `stupify run`); config.env sits
 * next to it.
 *
 * Reviews every PR by default (SCOPE=auto): every non-draft, non-bot PR under DIFF_LINE_CAP, no label needed.
 * REVIEW_LABEL is just a force-include override for an oversized diff. Want manual control instead? SCOPE=label
 * flips it to opt-in: only PRs you tag REVIEW_LABEL are reviewed, so spend tracks exactly what you tag.
 * The "taste" — REVIEW-PROMPT.md, RUBRIC.md, CORPUS.md — lives in the TARGET repo under REVIEW_DIR (default
 * `.review/`), so it's version-controlled with the code it judges and edited via a normal PR.
 * Idempotent: skips a PR already reviewed — or already reported as failed — at its current head SHA, via a
 * hidden marker comment. A new push moves the SHA, clears the markers, and re-arms the review.
 * Per-PR memory: each review is fed the PR's existing review thread. The runner posts a one-line `still ✅`
 * when nothing is outstanding (so every reviewed head carries a marker-bearing verdict), and stays silent
 * while its own findings remain open.
 *
 * Single-flight: the sweep takes its own lockfile (state/sweep.lock) so two cron ticks never overlap — no
 * `flock` dependency. Every knob lives in config.env next to this file (read fresh each run). Run: `bun review-sweep.ts`.
 *
 * Layout: this file is the entry (main + the public surface tests import). The engine proper is split into
 * src/sweep/* — config, prs, diff, verdict, github, state, status, commit-status, prompt, codex, review-pr,
 * review-one, sweep (candidate collection), pool (the concurrent review workers). The CLI bundles this entry
 * into one file at install time, so the split costs the deployed artifact nothing.
 */
import { join } from 'node:path'

import { acquireLock, releaseLock } from '@bevyl-ai/agent-tools'

import { setCommitStatus } from './sweep/commit-status'
import { loadConfig, log, refreshRepo } from './sweep/config'
import { type PriorState, prReviews } from './sweep/github'
import { runCandidatePool } from './sweep/pool'
import { hasMachinery } from './sweep/prompt'
import { inScope, listPrs } from './sweep/prs'
import { reviewOne } from './sweep/review-one'
import { initialStatus, isoNow, seedStatusPrs, setStatusStage, writeStatus } from './sweep/status'
import { collectCandidates, loadSweepState } from './sweep/sweep'

export { isRateLimited, pidAlive } from '@bevyl-ai/agent-tools'
export { appJwt, commitStatusDescription } from './sweep/commit-status'
export type { Config } from './sweep/config'
export { diffRightLines, isDiffTooLarge } from './sweep/diff'
export { reviewPrompt } from './sweep/prompt'
export { type Pr, priorReviewThread } from './sweep/prs'
export { commitStatusForSweepResult } from './sweep/review-pr'
export {
  bumpDailyCounter,
  DailyCounter,
  loadDailyCounter,
  loadHeadAttempts,
  loadReviewedHeads,
  recordHeadAttempt,
  recordReviewedHead,
} from './sweep/state'
export { parseReview, REVIEW_SCHEMA, STILL_NOTE } from './sweep/verdict'

async function main(): Promise<void> {
  const cfg = loadConfig() // also mkdirs stateDir and sets LOG, so config warnings are already captured
  const ref = process.env.REVIEW_PR
  if (ref) {
    return reviewOne(cfg, ref, process.env.REVIEW_POST === '1')
  } // `stupify review <pr>` — one-shot, no sweep/lock/checkout

  const lockPath = join(cfg.stateDir, 'sweep.lock')
  if (!acquireLock(lockPath)) {
    log('another sweep already running — skip')
    return
  }
  const status = initialStatus(cfg)
  writeStatus(cfg, status)
  process.on('exit', () => {
    // Only clear the lock if we still hold it. If a later sweep judged us crashed and stole it, deleting it here
    // would free a lock that another run now owns — letting a third sweep overlap it.
    releaseLock(lockPath)
  })

  setStatusStage(cfg, status, 'refreshing', `refreshing ${cfg.defaultBranch}`)
  if (!refreshRepo(cfg)) {
    setStatusStage(cfg, status, 'blocked', 'checkout refresh failed')
    status.finishedAt = isoNow()
    writeStatus(cfg, status)
    process.exit(1)
  }
  // Resolve the taste: the target repo's own .review/ wins (a repo can override); otherwise fall back to the
  // home taste the CLI assembled from packs (~/.stupify/.review). Either way cfg.reviewDir becomes ABSOLUTE.
  // Select on the FULL 3-file set, not just CORPUS.md — a partial repo .review/ (e.g. CORPUS without the spec)
  // then gracefully falls back to the home taste instead of being picked and dead-ending at "no machinery".
  setStatusStage(cfg, status, 'loading_taste', 'loading review taste')
  const repoReview = join(cfg.repoDir, cfg.reviewDir)
  cfg.reviewDir = hasMachinery(repoReview) ? repoReview : cfg.homeReviewDir
  if (!hasMachinery(cfg.reviewDir)) {
    log(
      `no review machinery at ${cfg.reviewDir}/ (need REVIEW-PROMPT.md + RUBRIC.md + CORPUS.md) — no-op. Run \`stupify setup\` to assemble taste, or add a .review/ to ${cfg.slug}.`,
    )
    status.stage = 'done'
    status.message = 'no review machinery found'
    status.finishedAt = isoNow()
    writeStatus(cfg, status)
    return
  }

  setStatusStage(cfg, status, 'listing_prs', 'listing open pull requests')
  const prs = listPrs(cfg)
  if (prs === null) {
    setStatusStage(cfg, status, 'blocked', 'could not list pull requests')
    status.finishedAt = isoNow()
    writeStatus(cfg, status)
    process.exit(1)
  }
  const queue = prs.filter((pr) => inScope(pr, cfg)) // MAX_PRS is applied to PRs actually HANDLED, not iterated (collectCandidates)
  status.totals.openPrs = prs.length
  seedStatusPrs(cfg, status, queue)
  setStatusStage(
    cfg,
    status,
    'reviewing',
    queue.length === 0 ? 'no PRs in scope' : `reviewing ${queue.length} PR(s) in scope`,
  )

  const state = loadSweepState(cfg)
  const priorByPr = new Map<number, PriorState | null>()
  for (const pr of queue) {
    const prior = prReviews(cfg, pr)
    priorByPr.set(pr.number, prior)
    if (prior === null) {
      continue
    }
    const reviewedHead = prior.reviewedHead || state.reviewedLocal[String(pr.number)] === pr.headRefOid
    const f = state.failures[String(pr.number)]
    const recentlyFailed = f !== undefined && f.head === pr.headRefOid && Date.now() - f.at < cfg.failRetryMs
    const dailyBlocked = cfg.maxReviewsPerDay > 0 && !cfg.dryRun && state.daily.count >= cfg.maxReviewsPerDay
    if (!reviewedHead && !recentlyFailed && !dailyBlocked) {
      setCommitStatus(cfg, state.commitStatuses, pr, 'pending', 'queued for stupify review')
    }
  }

  const { candidates, handled } = collectCandidates(cfg, status, queue, priorByPr, state)
  const { reviewed } = await runCandidatePool(cfg, status, candidates, state)

  log(`sweep done — scope=${cfg.scope} reviewed=${reviewed}`)
  if (status.stage !== 'blocked') {
    status.stage = 'done'
    status.message = `sweep done — scope=${cfg.scope} reviewed=${reviewed}`
  }
  status.totals.handled = handled
  status.totals.reviewed = reviewed
  status.finishedAt = isoNow()
  writeStatus(cfg, status)
}

if (import.meta.main) {
  await main()
} // run only when invoked directly (cron / `stupify run`); stays importable for tests
