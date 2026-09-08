#!/usr/bin/env bun

import { join } from 'node:path'

import { acquireLock, releaseLock } from '@bevyl-ai/agent-tools'

import { loadConfig, log, refreshRepo } from './sweep/config'
import { runCandidatePool } from './sweep/pool'
import { hasMachinery } from './sweep/prompt'
import { inScope, listPrs } from './sweep/prs'
import { sweepState } from './sweep/state'
import { collectCandidates } from './sweep/sweep'

const cfg = loadConfig()
const lockPath = join(cfg.stateDir, 'sweep.lock')
if (!acquireLock(lockPath)) {
  log('another sweep already running — skip')
  process.exit(0)
}
process.on('exit', () => {
  releaseLock(lockPath)
})

if (!refreshRepo(cfg)) {
  process.exit(1)
}

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
const state = sweepState(cfg)
const candidates = collectCandidates(cfg, queue, state)
const reviewed = await runCandidatePool(cfg, candidates, state)
log(`sweep done — scope=${cfg.scope} reviewed=${reviewed}`)
