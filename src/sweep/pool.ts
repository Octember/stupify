// The review pool: up to CODEX_JOBS candidates in flight at once. Workers share a cursor; a quota `limit` from
// any worker stops NEW launches (the rest would fail the same way) while in-flight runs drain. All the
// shared-state mutation (counters, status, throttle files) happens between awaits on the one JS thread, so it
// needs no locks.
import { setCommitStatus } from './commit-status'
import { type Config, log } from './config'
import { commitStatusForSweepResult, reviewPr } from './review-pr'
import { bumpDailyCounter, dailyPath, failuresPath, recordHeadAttempt, recordReviewedHead, reviewedPath } from './state'
import { setStatusPr, setStatusStage, skipStatusPr, type SweepStatus } from './status'
import { type Candidate, type SweepState } from './sweep'

export async function runCandidatePool(
  cfg: Config,
  status: SweepStatus,
  candidates: Candidate[],
  state: SweepState,
): Promise<{ reviewed: number; tokens: number }> {
  let reviewed = 0
  const tokens = 0
  let next = 0
  let limitHit = false
  const worker = async (): Promise<void> => {
    while (!limitHit) {
      const c = candidates[next++]
      if (c === undefined) {
        return
      }
      const { pr, prior, diff, lines } = c
      setStatusPr(cfg, status, pr, 'reviewing', `running codex over ${lines} diff lines`, lines)
      setCommitStatus(cfg, state.commitStatuses, pr, 'pending', `stupify is reviewing ${lines} diff lines`)
      // oxlint-disable-next-line no-await-in-loop -- each worker awaits serially BY DESIGN; the parallelism is across workers
      const used = await reviewPr(cfg, pr, prior.memory, diff, c.firstReview, prior.openThreadIds)
      if (used === 'limit') {
        limitHit = true
        log(
          'codex plan is rate-limited — no new reviews this sweep (the rest would fail the same way); retries next sweep',
        )
        setStatusPr(cfg, status, pr, 'failed', 'codex plan is rate-limited; ending sweep early', lines)
        setStatusStage(cfg, status, 'blocked', 'codex plan is rate-limited')
        setCommitStatus(cfg, state.commitStatuses, pr, 'error', 'codex plan is rate-limited; retrying later')
        recordHeadAttempt(failuresPath(cfg), state.failures, String(pr.number), pr.headRefOid) // throttle this head too so the next sweep doesn't immediately re-hit the wall
        continue
      }
      if (used === null) {
        recordHeadAttempt(failuresPath(cfg), state.failures, String(pr.number), pr.headRefOid) // logged, not posted — throttle re-attempt until the window lapses or the head moves
        setStatusPr(cfg, status, pr, 'failed', 'review failed; retry will wait for the failure window', lines)
        setCommitStatus(cfg, state.commitStatuses, pr, 'error', 'stupify review failed; retrying later')
        continue
      }
      // codex ran and reached a verdict (findings posted, or a no-op). Record this head so the next sweep doesn't
      // re-run codex on it — without this a SUPPRESSED no-op (no thread marker) would re-run every minute and drain
      // the plan. Count the run toward the daily spend ceiling either way: a no-op still spent the tokens.
      recordReviewedHead(reviewedPath(cfg), state.reviewedLocal, String(pr.number), pr.headRefOid)
      bumpDailyCounter(dailyPath(cfg), state.daily)
      if (typeof used === 'object') {
        reviewed += 1
        setStatusPr(
          cfg,
          status,
          pr,
          'posted',
          `posted review${used.blocking === 0 ? ' (non-blocking only)' : ''}`,
          lines,
        )
      } else if (used === 'open') {
        setStatusPr(cfg, status, pr, 'skipped', 'prior findings still open; no new review posted', lines)
      } else if (used === 'fixed') {
        setStatusPr(cfg, status, pr, 'clean', 'prior findings resolved', lines)
      } else {
        setStatusPr(cfg, status, pr, 'clean', 'no new review needed', lines)
      }
      // A notes-only review must not green a PR whose PRIOR blocking threads are still open — 'open' outranks it.
      let result: number | 'clean' | 'fixed' | 'open'
      if (typeof used === 'object') {
        result = used.blocking === 0 && c.prior.openThreadIds.length > 0 ? 'open' : used.blocking
      } else {
        result = used
      }
      const finalStatus = commitStatusForSweepResult(result)
      setCommitStatus(cfg, state.commitStatuses, pr, finalStatus.state, finalStatus.description)
      status.totals.reviewed = reviewed
      status.totals.tokens = tokens
    }
  }
  await Promise.all(Array.from({ length: Math.min(cfg.codexJobs, candidates.length) }, () => worker()))
  if (limitHit) {
    for (const c of candidates.slice(next)) {
      skipStatusPr(cfg, status, c.pr, 'deferred', 'codex plan is rate-limited; deferred to next sweep')
      setCommitStatus(cfg, state.commitStatuses, c.pr, 'error', 'codex plan is rate-limited; retrying later')
    }
  }
  return { reviewed, tokens }
}
