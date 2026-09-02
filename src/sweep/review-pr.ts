// Acting on one sweep review: post findings as an inline-threaded COMMENT review, resolve stupify's open
// threads when its findings are fixed, post the convergence notes, or stay silent while findings stand.
import { maybeRotateGateway } from '@bevyl-ai/agent-tools'

import { runReview } from './codex'
import { type CommitStatusState } from './commit-status'
import { type Config, log } from './config'
import { postNote, postReview, resolveThreads } from './github'
import { type Pr } from './prs'
import { FIXED_NOTE, STILL_NOTE } from './verdict'
import { prepareHeadWorktree, removeHeadWorktree } from './worktree'

// A posted review carries its blocking-finding count — zero blocking reads as a green status.
export type SweepReviewResult = { blocking: number } | 'limit' | 'clean' | 'fixed' | 'open' | null

export function commitStatusForSweepResult(result: number | 'clean' | 'fixed' | 'open'): {
  state: CommitStatusState
  description: string
} {
  if (typeof result === 'number') {
    if (result > 0) {
      return { state: 'failure', description: 'stupify found issues; see review' }
    }
    return { state: 'success', description: 'no blocking issues; stupify left notes' }
  }
  if (result === 'open') {
    return { state: 'failure', description: 'prior stupify findings are still open' }
  }
  if (result === 'fixed') {
    return { state: 'success', description: 'prior stupify findings resolved' }
  }
  return { state: 'success', description: 'stupify review complete; no new issues' }
}

export async function reviewPr(
  cfg: Config,
  pr: Pr,
  priorThread: string,
  diff: string,
  firstReview: boolean,
  openThreadIds: string[],
): Promise<SweepReviewResult> {
  log(`reviewing PR #${pr.number} @ ${pr.headRefOid.slice(0, 8)} (base ${pr.baseRefName})`)
  const workDir = prepareHeadWorktree(cfg.repoDir, pr)
  if (workDir === null) {
    log(`  review FAILED for #${pr.number} — couldn't checkout head for file context`)
    return null
  }
  let r
  try {
    r = await runReview(cfg, pr, priorThread, diff, workDir)
  } finally {
    removeHeadWorktree(cfg.repoDir, pr)
  }
  if (r.kind === 'limit' || r.kind === 'fail') {
    log(`  review FAILED for #${pr.number} — ${r.reason}`)
    if (r.kind === 'limit') {
      // Self-heal: advance ~/.codex/config.toml to the next CODEX_GATEWAY_POOL account (the shared ring —
      // same kit + env contract bunion/earshot rotate on). Codex re-reads the file each sweep, so the next
      // sweep lands on the fresh account. The kit's signature match is tighter than isRateLimited by design:
      // a transient 429 ends this sweep but doesn't walk the ring.
      const rot = maybeRotateGateway({
        reason: r.raw,
        pool: cfg.gatewayPool
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean),
        cooldownMs: cfg.rotateCooldownMs,
      })
      if (rot.rotated) {
        log(`  codex gateway rotated: ${rot.from} → ${rot.to}`)
      }
      return 'limit'
    }
    return null
  }
  if (r.kind === 'no_new_issues') {
    // Clean. A one-time LGTM on a PR stupify has never flagged (so "reviewed + good" is visible). On a PR it HAS
    // reviewed: while its own findings are still open, a clean head stays silent (the open threads already say it
    // all, and a fresh non-✅ note would fight a reasoned inline pushback) — but with NOTHING outstanding it posts
    // the one-line marker-bearing re-approval, so the new head never reads as "unreviewed" to per-head consumers.
    if (!firstReview) {
      if (openThreadIds.length > 0) {
        log(`  #${pr.number} nothing new, prior findings still open — staying silent`)
        return 'open'
      }
      if (!postNote(cfg, pr, STILL_NOTE)) {
        log(`  couldn't post #${pr.number} ${STILL_NOTE} (gh down?) — will retry next sweep`)
        return null
      }
      log(`  #${pr.number} nothing new — posted ${STILL_NOTE} for this head`)
      return 'clean'
    }
    if (!postNote(cfg, pr, 'LGTM ✅')) {
      log(`  couldn't post #${pr.number} LGTM (gh down?) — will retry next sweep`)
      return null
    }
    log(`  #${pr.number} clean first pass — posted LGTM ✅`)
    return 'clean'
  }
  // Prior findings resolved → resolve the open threads, then post the visible fixed note with the head marker.
  // Keep that order: a marker before resolution could make a later sweep skip a still-open thread. Gated on
  // actually having open stupify threads, so a stray fixed-signal can't manufacture approval.
  if (r.kind === 'fixed') {
    if (openThreadIds.length === 0) {
      // Nothing left to resolve. On a PR stupify never flagged, a stray fixed-signal must stay silent — it can't
      // manufacture an approval. On a PR it HAS reviewed (threads already resolved on an earlier pass), this is
      // just "clean at a new head": post the marker-bearing re-approval, same as the no-op path above.
      if (firstReview) {
        log(`  #${pr.number} fixed-signal but never flagged — staying silent`)
        return 'clean'
      }
      if (!postNote(cfg, pr, STILL_NOTE)) {
        log(`  couldn't post #${pr.number} ${STILL_NOTE} (gh down?) — will retry next sweep`)
        return null
      }
      log(`  #${pr.number} prior findings already resolved — posted ${STILL_NOTE} for this head`)
      return 'clean'
    }
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
  // A real review: post the validated findings as inline, resolvable threads. (parseReview guarantees ≥1 finding.)
  if (!postReview(cfg, pr, r.opener, r.findings, diff)) {
    log(`  couldn't post #${pr.number} review (gh down?) — next sweep retries`)
    return null
  }
  const blocking = r.findings.filter((f) => f.blocking).length
  log(`  #${pr.number} done (${r.findings.length} inline, ${blocking} blocking)`)
  return { blocking }
}
