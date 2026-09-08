import { type Config, log } from './config'
import { reviewPr } from './review-pr'
import { type SweepState } from './state'
import { type Candidate } from './sweep'

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
      const used = await reviewPr(cfg, c.pr, c.prior, c.diff)
      if (used === 'limit' || used === null) {
        state.failed(c.pr)
        if (used === 'limit') {
          limitHit = true
          log(
            'codex plan is rate-limited — no new reviews this sweep (the rest would fail the same way); retries next sweep',
          )
        }
        continue
      }
      state.reviewedHead(c.pr)
      if (typeof used === 'object') {
        reviewed += 1
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(cfg.codexJobs, candidates.length) }, () => worker()))
  return reviewed
}
