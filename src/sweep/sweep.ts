// The sweep's front half: load the per-box state, then collect the PRs that pass the cheap serial gates
// (dedup, failure throttle, daily/MAX_PRS caps, diff fetch + size cap) into review candidates.
import { type Config, log } from './config'
import { diffLineCount, getDiff, GH_DIFF_LIMITS } from './diff'
import { type PriorState } from './github'
import { hasReviewLabel, type Pr } from './prs'
import {
  type DailyCounter,
  dailyPath,
  failuresPath,
  type HeadAttempt,
  loadDailyCounter,
  loadHeadAttempts,
  loadReviewedHeads,
  reviewedPath,
} from './state'

export interface Candidate {
  pr: Pr
  prior: PriorState
  diff: string
  firstReview: boolean
}

// The three per-box state files every sweep loads up front (see state.ts).
export interface SweepState {
  failures: Record<string, HeadAttempt> // PR -> failed head + when; throttles retries without a PR comment
  reviewedLocal: Record<string, string> // PR -> head already run; catches suppressed no-ops
  daily: DailyCounter // today's review count vs MAX_REVIEWS_PER_DAY
}

export function loadSweepState(cfg: Config): SweepState {
  return {
    failures: loadHeadAttempts(failuresPath(cfg)),
    reviewedLocal: loadReviewedHeads(reviewedPath(cfg)),
    daily: loadDailyCounter(dailyPath(cfg)),
  }
}

// Count PRs we do real (costly) work on, and cap THAT at MAX_PRS — so a backlog of already-reviewed PRs at
// the front of the list can't consume the budget and starve later ones. Candidates are collected here (all the
// cheap serial gates) and reviewed by pool.ts's CODEX_JOBS concurrent codex sessions.
export function collectCandidates(
  cfg: Config,
  queue: Pr[],
  priorByPr: Map<number, PriorState | null>,
  state: SweepState,
): Candidate[] {
  let handled = 0
  // Each candidate is one review session, so the daily ceiling gates collection up front.
  const dailyBudget =
    cfg.maxReviewsPerDay > 0 && !cfg.dryRun ? cfg.maxReviewsPerDay - state.daily.count : Number.POSITIVE_INFINITY
  const candidates: Candidate[] = []
  for (const pr of queue) {
    if (handled >= dailyBudget) {
      log(`daily cap hit (MAX_REVIEWS_PER_DAY=${cfg.maxReviewsPerDay}) — no more reviews today; resumes tomorrow`)
      break
    }
    // What stupify has already said here — read from the reviews/threads connection (findings are inline threads).
    const prior = priorByPr.get(pr.number) ?? null
    if (prior === null) {
      log(`skip #${pr.number} — couldn't read its reviews from gh (failed/malformed); will retry next sweep`)
      continue
    }
    const firstReview = !prior.everReviewed // stupify has never reviewed here → a clean verdict earns a one-time LGTM
    // Already reviewed THIS head? A posted review's body carries the head marker (durable, survives VM recreation);
    // a SUPPRESSED no-op posts nothing, so it's caught by local state instead. Either way, don't re-run codex.
    const reviewedHead = prior.reviewedHead || state.reviewedLocal[String(pr.number)] === pr.headRefOid
    // Failures aren't posted, so suppression is local: skip a head we already tried within the retry window.
    const f = state.failures[String(pr.number)]
    const recentlyFailed = f !== undefined && f.head === pr.headRefOid && Date.now() - f.at < cfg.failRetryMs
    if (reviewedHead || recentlyFailed) {
      continue
    }
    // Past the cheap dedup skip — this PR is a real candidate. Enforce MAX_PRS here, not on the iterated list.
    if (handled >= cfg.maxPrs) {
      log(`reached MAX_PRS=${cfg.maxPrs} this sweep — deferring remaining candidates to the next sweep`)
      break
    }

    // Fetch the diff once, here in the runner — codex reviews it from the prompt with no network/gh of its own.
    const read = getDiff(cfg, pr)
    if (!read.ok) {
      // too-large is terminal: gh will never hand us this diff, so there is nothing to retry and nothing to measure.
      log(
        read.reason === 'too-large'
          ? `skip #${pr.number} — diff over GitHub's ${GH_DIFF_LIMITS} API limit — gh can't return it, so it can't be reviewed; split the PR`
          : `skip #${pr.number} — couldn't read its diff from gh; will retry next sweep`,
      )
      continue
    }
    const { diff } = read
    const lines = diffLineCount(diff)
    // auto-scope only: skip oversized diffs UNLESS the PR carries the review label (the documented force-include).
    if (cfg.scope === 'auto' && lines > cfg.diffLineCap && !hasReviewLabel(pr, cfg)) {
      log(`skip #${pr.number} — diff ${lines} lines > cap ${cfg.diffLineCap} (add '${cfg.reviewLabel}' to force)`)
      continue
    }
    handled += 1 // count only PRs that pass the gates and actually get a review slot
    if (cfg.dryRun) {
      log(`DRY_RUN would review #${pr.number} @ ${pr.headRefOid.slice(0, 8)} (diff ${lines} lines)`)
      continue
    }
    candidates.push({ pr, prior, diff, firstReview })
  }
  return candidates
}
