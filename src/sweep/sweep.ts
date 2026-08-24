// The sweep's front half: load the per-VM state, then collect the PRs that pass the cheap serial gates
// (dedup, failure throttle, daily/MAX_PRS caps, diff fetch + size cap) into review candidates.
import { loadCommitStatuses, type PostedCommitStatus, setCommitStatus } from './commit-status'
import { type Config, log } from './config'
import { diffLineCount, getDiff, GH_DIFF_LIMITS } from './diff'
import { type PriorState } from './github'
import { hasReviewLabel, type Pr } from './prs'
import { commitStatusForSweepResult } from './review-pr'
import {
  commitStatusPath,
  type DailyCounter,
  dailyPath,
  failuresPath,
  type HeadAttempt,
  loadDailyCounter,
  loadHeadAttempts,
  loadReviewedHeads,
  reviewedPath,
} from './state'
import { deferQueuedStatusPrs, setStatusPr, skipStatusPr, type SweepStatus } from './status'

export interface Candidate {
  pr: Pr
  prior: PriorState
  diff: string
  lines: number
  firstReview: boolean
}

// The four per-VM state files every sweep loads up front (see state.ts).
export interface SweepState {
  failures: Record<string, HeadAttempt> // PR -> failed head + when; throttles retries without a PR comment
  reviewedLocal: Record<string, string> // PR -> head already run; catches suppressed no-ops
  daily: DailyCounter // today's review count vs MAX_REVIEWS_PER_DAY
  commitStatuses: Record<string, PostedCommitStatus> // head+context -> last posted payload; avoids append-only status spam
}

export function loadSweepState(cfg: Config): SweepState {
  return {
    failures: loadHeadAttempts(failuresPath(cfg)),
    reviewedLocal: loadReviewedHeads(reviewedPath(cfg)),
    daily: loadDailyCounter(dailyPath(cfg)),
    commitStatuses: loadCommitStatuses(commitStatusPath(cfg)),
  }
}

// Count PRs we do real (costly) work on, and cap THAT at MAX_PRS — so a backlog of already-reviewed PRs at
// the front of the list can't consume the budget and starve later ones. Candidates are collected here (all the
// cheap serial gates) and reviewed by pool.ts's CODEX_JOBS concurrent codex runs — the sweep's wall-clock
// was dominated by running those multi-minute reviews strictly one after another.
export function collectCandidates(
  cfg: Config,
  status: SweepStatus,
  queue: Pr[],
  priorByPr: Map<number, PriorState | null>,
  state: SweepState,
): { candidates: Candidate[]; handled: number } {
  let handled = 0
  // Each candidate is one codex run, so the daily ceiling gates collection up front.
  const dailyBudget =
    cfg.maxReviewsPerDay > 0 && !cfg.dryRun ? cfg.maxReviewsPerDay - state.daily.count : Number.POSITIVE_INFINITY
  const candidates: Candidate[] = []
  for (let i = 0; i < queue.length; i++) {
    const pr = queue[i]
    if (pr === undefined) {
      continue
    }
    if (handled >= dailyBudget) {
      log(`daily cap hit (MAX_REVIEWS_PER_DAY=${cfg.maxReviewsPerDay}) — no more reviews today; resumes tomorrow`)
      deferQueuedStatusPrs(
        cfg,
        status,
        queue,
        i,
        `daily cap hit (MAX_REVIEWS_PER_DAY=${cfg.maxReviewsPerDay}); resumes tomorrow`,
      )
      break
    }
    // What stupify has already said here — read from the reviews/threads connection (findings are inline threads now).
    const prior = priorByPr.get(pr.number) ?? null
    if (prior === null) {
      log(`skip #${pr.number} — couldn't read its reviews from gh (failed/malformed); will retry next sweep`)
      skipStatusPr(cfg, status, pr, 'skipped', "couldn't read reviews from gh; will retry next sweep")
      setCommitStatus(cfg, state.commitStatuses, pr, 'error', "couldn't read PR review state; retrying next sweep")
      continue
    }
    const firstReview = !prior.everReviewed // stupify has never reviewed here → a clean verdict earns a one-time LGTM
    // Already reviewed THIS head? A posted review's body carries the head marker (durable, survives VM recreation);
    // a SUPPRESSED no-op posts nothing, so it's caught by local state instead. Either skip — don't re-run codex.
    const reviewedHead = prior.reviewedHead || state.reviewedLocal[String(pr.number)] === pr.headRefOid
    // Failures aren't posted, so suppression is local: skip a PR we already tried at THIS head within the retry
    // window (so a persistently-failing PR isn't re-run every sweep, but a transient failure retries once it lapses).
    const f = state.failures[String(pr.number)]
    const recentlyFailed = f !== undefined && f.head === pr.headRefOid && Date.now() - f.at < cfg.failRetryMs
    if (reviewedHead) {
      skipStatusPr(cfg, status, pr, 'skipped', 'already reviewed this head')
      const reviewedStatus = commitStatusForSweepResult(prior.openThreadIds.length > 0 ? 'open' : 'clean')
      setCommitStatus(cfg, state.commitStatuses, pr, reviewedStatus.state, reviewedStatus.description)
      continue
    }
    if (recentlyFailed) {
      skipStatusPr(cfg, status, pr, 'skipped', 'recently failed; retry window has not elapsed')
      continue
    }
    // Past the cheap dedup skip — this PR is a real candidate. Enforce MAX_PRS here, not on the
    // iterated list, and defer the rest to the next sweep.
    if (handled >= cfg.maxPrs) {
      log(`reached MAX_PRS=${cfg.maxPrs} this sweep — deferring remaining candidates to the next sweep`)
      deferQueuedStatusPrs(cfg, status, queue, i, `reached MAX_PRS=${cfg.maxPrs}; deferring to next sweep`)
      setCommitStatus(
        cfg,
        state.commitStatuses,
        pr,
        'pending',
        `reached MAX_PRS=${cfg.maxPrs}; deferring to next sweep`,
      )
      break
    }

    // Fetch the diff once, here in the runner — codex reviews it from the prompt with no network/gh of its own.
    const read = getDiff(cfg, pr.number)
    if (!read.ok && read.reason === 'too-large') {
      // Terminal: gh will never hand us this diff, so there is nothing to retry and nothing to measure. Say so
      // plainly — the old wording promised a retry that could not possibly succeed.
      const why = `diff over GitHub's ${GH_DIFF_LIMITS} API limit — gh can't return it, so it can't be reviewed; split the PR`
      log(`skip #${pr.number} — ${why}`)
      skipStatusPr(cfg, status, pr, 'skipped', why)
      setCommitStatus(
        cfg,
        state.commitStatuses,
        pr,
        'success',
        `diff over GitHub's ${GH_DIFF_LIMITS} API limit; split the PR to get a review`,
      )
      continue
    }
    if (!read.ok) {
      log(`skip #${pr.number} — couldn't read its diff from gh; will retry next sweep`)
      skipStatusPr(cfg, status, pr, 'skipped', "couldn't read diff from gh; will retry next sweep")
      setCommitStatus(cfg, state.commitStatuses, pr, 'error', "couldn't read PR diff; retrying next sweep")
      continue
    }
    const { diff } = read
    const lines = diffLineCount(diff)
    // auto-scope only: skip oversized diffs UNLESS the PR carries the review label (the documented force-include).
    // (label-scope means you already opted in, so size never gates there.)
    if (cfg.scope === 'auto' && lines > cfg.diffLineCap && !hasReviewLabel(pr, cfg)) {
      log(`skip #${pr.number} — diff ${lines} lines > cap ${cfg.diffLineCap} (add '${cfg.reviewLabel}' to force)`)
      skipStatusPr(
        cfg,
        status,
        pr,
        'skipped',
        `diff ${lines} lines > cap ${cfg.diffLineCap} (add '${cfg.reviewLabel}' to force)`,
        lines,
      )
      setCommitStatus(
        cfg,
        state.commitStatuses,
        pr,
        'success',
        `diff ${lines} lines > cap ${cfg.diffLineCap}; add '${cfg.reviewLabel}' to force`,
      )
      continue
    }
    handled += 1 // count only PRs that pass the gates and actually get a review slot — size/read skips above don't burn it
    status.totals.handled = handled
    if (cfg.dryRun) {
      log(`DRY_RUN would review #${pr.number} @ ${pr.headRefOid.slice(0, 8)} (diff ${lines} lines)`)
      setStatusPr(cfg, status, pr, 'dry_run', `would review ${lines} diff lines`, lines)
      continue
    }
    candidates.push({ pr, prior, diff, lines, firstReview })
  }
  return { candidates, handled }
}
