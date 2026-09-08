import { type Config, log } from './config'
import { diffLineCount, getDiff, GH_DIFF_LIMITS } from './diff'
import { type PriorState, prReviews } from './github'
import { hasReviewLabel, type Pr } from './prs'
import { type SweepState } from './state'

export interface Candidate {
  pr: Pr
  prior: PriorState
  diff: string
}

export function collectCandidates(cfg: Config, queue: Pr[], state: SweepState): Candidate[] {
  let handled = 0
  const dailyBudget =
    cfg.maxReviewsPerDay > 0 && !cfg.dryRun ? cfg.maxReviewsPerDay - state.reviewsToday() : Number.POSITIVE_INFINITY
  const candidates: Candidate[] = []
  for (const pr of queue) {
    if (handled >= dailyBudget) {
      log(`daily cap hit (MAX_REVIEWS_PER_DAY=${cfg.maxReviewsPerDay}) — no more reviews today; resumes tomorrow`)
      break
    }
    const prior = prReviews(cfg, pr)
    if (prior === null) {
      log(`skip #${pr.number} — couldn't read its reviews from gh (failed/malformed); will retry next sweep`)
      continue
    }
    if (prior.reviewedHead || state.isReviewed(pr) || state.recentlyFailed(pr, cfg.failRetryMs)) {
      continue
    }
    if (handled >= cfg.maxPrs) {
      log(`reached MAX_PRS=${cfg.maxPrs} this sweep — deferring remaining candidates to the next sweep`)
      break
    }
    const read = getDiff(cfg, pr)
    if (!read.ok) {
      log(
        read.reason === 'too-large'
          ? `skip #${pr.number} — diff over GitHub's ${GH_DIFF_LIMITS} API limit — gh can't return it, so it can't be reviewed; split the PR`
          : `skip #${pr.number} — couldn't read its diff from gh; will retry next sweep`,
      )
      continue
    }
    const lines = diffLineCount(read.diff)
    if (cfg.scope === 'auto' && lines > cfg.diffLineCap && !hasReviewLabel(pr, cfg)) {
      log(`skip #${pr.number} — diff ${lines} lines > cap ${cfg.diffLineCap} (add '${cfg.reviewLabel}' to force)`)
      continue
    }
    handled += 1
    if (cfg.dryRun) {
      log(`DRY_RUN would review #${pr.number} @ ${pr.headRefOid.slice(0, 8)} (diff ${lines} lines)`)
      continue
    }
    candidates.push({ pr, prior, diff: read.diff })
  }
  return candidates
}
