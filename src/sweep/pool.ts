// The review pool: up to CODEX_JOBS candidates in flight at once. Workers share a cursor; a quota `limit` from
// any worker stops NEW launches (the rest would fail the same way) while in-flight runs drain. All the
// shared-state mutation happens between awaits on the one JS thread, so it needs no locks.
import { type Config, log } from './config'
import { reviewPr } from './review-pr'
import { bumpDailyCounter, dailyPath, failuresPath, recordHeadAttempt, recordReviewedHead, reviewedPath } from './state'
import { type Candidate, type SweepState } from './sweep'

/** Review the candidates; returns how many reviews were posted. */
export async function runCandidatePool(cfg: Config, candidates: Candidate[], state: SweepState): Promise<number> {
  let reviewed = 0
  let next = 0
  let limitHit = false
  const worker = async (): Promise<void> => {
    while (!limitHit) {
      const c = candidates[next++]
      if (c === undefined) {
        return
      }
      // oxlint-disable-next-line no-await-in-loop -- each worker awaits serially BY DESIGN; the parallelism is across workers
      const used = await reviewPr(cfg, c.pr, c.prior.memory, c.diff, c.firstReview, c.prior.openThreadIds)
      if (used === 'limit' || used === null) {
        // Logged, not posted — throttle this head until the window lapses or the head moves.
        recordHeadAttempt(failuresPath(cfg), state.failures, String(c.pr.number), c.pr.headRefOid)
        if (used === 'limit') {
          limitHit = true
          log(
            'codex plan is rate-limited — no new reviews this sweep (the rest would fail the same way); retries next sweep',
          )
        }
        continue
      }
      // codex reached a verdict (findings posted, or a no-op). Record this head so the next sweep doesn't re-run
      // codex on it — a SUPPRESSED no-op posts no marker, so local state is what catches it. A no-op still spent
      // the tokens, so it counts toward the daily ceiling either way.
      recordReviewedHead(reviewedPath(cfg), state.reviewedLocal, String(c.pr.number), c.pr.headRefOid)
      bumpDailyCounter(dailyPath(cfg), state.daily)
      if (typeof used === 'object') {
        reviewed += 1
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(cfg.codexJobs, candidates.length) }, () => worker()))
  return reviewed
}
