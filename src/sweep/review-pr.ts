import { runReview } from './codex'
import { type Config, log } from './config'
import { postNote, postReview, type PriorState, resolveThreads } from './github'
import { type Pr } from './prs'
import { FIXED_NOTE, STILL_NOTE } from './verdict'
import { prepareHeadWorktree, removeHeadWorktree } from './worktree'

export type SweepReviewResult = { blocking: number } | 'limit' | 'clean' | 'fixed' | 'open' | null

export async function reviewPr(cfg: Config, pr: Pr, prior: PriorState, diff: string): Promise<SweepReviewResult> {
  log(`reviewing PR #${pr.number} @ ${pr.headRefOid.slice(0, 8)} (base ${pr.baseRefName})`)
  const workDir = prepareHeadWorktree(cfg.repoDir, pr)
  if (workDir === null) {
    log(`  review FAILED for #${pr.number} — couldn't checkout head for file context`)
    return null
  }
  let r
  try {
    r = await runReview(cfg, pr, prior.memory, diff, workDir)
  } finally {
    removeHeadWorktree(cfg.repoDir, pr)
  }
  if (r.kind === 'limit' || r.kind === 'fail') {
    log(`  review FAILED for #${pr.number} — ${r.reason}`)
    return r.kind === 'limit' ? 'limit' : null
  }
  const note = (text: string, why: string): SweepReviewResult => {
    if (!postNote(cfg, pr, text)) {
      log(`  couldn't post #${pr.number} ${text} (gh down?) — will retry next sweep`)
      return null
    }
    log(`  #${pr.number} ${why} — posted ${text}`)
    return 'clean'
  }
  const { openThreadIds } = prior
  if (r.kind === 'fixed' && openThreadIds.length > 0) {
    if (!resolveThreads(openThreadIds)) {
      log(`  couldn't resolve #${pr.number} fixed thread(s) (gh down?) — will retry next sweep`)
      return null
    }
    if (!postNote(cfg, pr, FIXED_NOTE)) {
      log(`  #${pr.number} fixed threads resolved, but posting ${FIXED_NOTE} failed`)
    }
    log(`  #${pr.number} prior findings resolved — posted ${FIXED_NOTE}; resolved ${openThreadIds.length} thread(s)`)
    return 'fixed'
  }
  if (r.kind !== 'findings') {
    if (!prior.everReviewed) {
      if (r.kind === 'fixed') {
        log(`  #${pr.number} fixed-signal but never flagged — staying silent`)
        return 'clean'
      }
      return note('LGTM ✅', 'clean first pass')
    }
    if (openThreadIds.length > 0) {
      log(`  #${pr.number} nothing new, prior findings still open — staying silent`)
      return 'open'
    }
    return note(STILL_NOTE, 'nothing new')
  }
  if (!postReview(cfg, pr, r.opener, r.findings)) {
    log(`  couldn't post #${pr.number} review (gh down?) — next sweep retries`)
    return null
  }
  const blocking = r.findings.filter((f) => f.blocking).length
  log(`  #${pr.number} done (${r.findings.length} inline, ${blocking} blocking)`)
  return { blocking }
}
