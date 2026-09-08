#!/usr/bin/env bun
// stupify — one review sweep, top to bottom. A cron runs this file every minute on the reviewer box, with
// config.env beside it (DEPLOY.md). Every non-draft, non-bot open PR under DIFF_LINE_CAP is reviewed against the
// target repo's .review/ (REVIEW-PROMPT.md + RUBRIC.md + CORPUS.md), once per head: a posted review carries a
// hidden `<!-- stupify:<sha> -->` marker, and a push moves the sha. Each review is fed the PR's existing review
// thread, so it converges instead of repeating.
import { join } from 'node:path'

import { acquireLock, releaseLock } from '@bevyl-ai/agent-tools'

import { loadConfig, log, refreshRepo } from './sweep/config'
import { type PriorState, prReviews } from './sweep/github'
import { runCandidatePool } from './sweep/pool'
import { hasMachinery } from './sweep/prompt'
import { inScope, listPrs } from './sweep/prs'
import { collectCandidates, loadSweepState } from './sweep/sweep'

const cfg = loadConfig()
const lockPath = join(cfg.stateDir, 'sweep.lock')
if (!acquireLock(lockPath)) {
  log('another sweep already running — skip')
  process.exit(0)
}
process.on('exit', () => {
  releaseLock(lockPath) // only if still ours: a later sweep that judged us crashed and stole it now owns it
})

if (!refreshRepo(cfg)) {
  process.exit(1)
}
// The target repo's own .review/ wins; otherwise the global taste under STUPIFY_HOME/.review. Select on the full
// three-file set, so a partial repo .review/ falls back instead of dead-ending at "no machinery".
const repoReview = join(cfg.repoDir, cfg.reviewDir)
cfg.reviewDir = hasMachinery(repoReview) ? repoReview : cfg.homeReviewDir
if (!hasMachinery(cfg.reviewDir)) {
  log(
    `no review machinery at ${cfg.reviewDir}/ (need REVIEW-PROMPT.md + RUBRIC.md + CORPUS.md) — no-op. Add a .review/ to ${cfg.slug}.`,
  )
  process.exit(0)
}

const prs = listPrs(cfg)
if (prs === null) {
  process.exit(1)
}
const queue = prs.filter((pr) => inScope(pr, cfg))
const state = loadSweepState(cfg)
const priorByPr = new Map<number, PriorState | null>()
for (const pr of queue) {
  priorByPr.set(pr.number, prReviews(cfg, pr))
}
const candidates = collectCandidates(cfg, queue, priorByPr, state)
const reviewed = await runCandidatePool(cfg, candidates, state)
log(`sweep done — scope=${cfg.scope} reviewed=${reviewed}`)
