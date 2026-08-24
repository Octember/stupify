// `stupify review <pr>` — review ONE pull request on demand (no cron, no checkout, no lock) and print it,
// or `--post` it. Always a FRESH perspective: no prior-review memory, so you get the full take.
import { join } from 'node:path'

import { exec } from '@bevyl-ai/agent-tools'

import { runReview } from './codex'
import { type Config } from './config'
import { getDiff, GH_DIFF_LIMITS } from './diff'
import { postReview } from './github'
import { hasMachinery } from './prompt'
import { Pr } from './prs'

/** Accepts a PR URL or `owner/repo#123` (the CLI resolves a bare `#123` against the cwd repo before calling here). */
export async function reviewOne(cfg: Config, ref: string, post: boolean): Promise<void> {
  const url = ref.match(/github\.com\/(?<slug>[^/\s]+\/[^/\s]+)\/(?:pull|issues)\/(?<number>\d+)/i)
  const short = ref.match(/^(?<slug>[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)[#/](?<number>\d+)$/)
  const slug = url?.groups?.slug ?? short?.groups?.slug ?? ''
  const number = Number(url?.groups?.number ?? short?.groups?.number ?? 0)
  if (!slug || !number) {
    console.error(`stupify review: couldn't parse '${ref}'. Pass a PR URL or owner/repo#123.`)
    process.exit(1)
  }
  cfg.slug = slug
  // Taste: this repo's own .review/ if you're standing in it, else the home taste the CLI assembled from packs.
  const cwdReview = join(process.cwd(), '.review')
  cfg.reviewDir = hasMachinery(cwdReview) ? cwdReview : cfg.homeReviewDir
  if (!hasMachinery(cfg.reviewDir)) {
    console.error('stupify review: no taste found. Run `stupify taste` (or add a .review/ to this repo) first.')
    process.exit(1)
  }
  // No checkout for an ad-hoc review — codex reviews from the inlined diff. Run it in the current directory (codex
  // needs a real workspace to operate in); if you're standing in the target repo it gets useful file context for free.
  cfg.repoDir = process.cwd()
  const head = exec('gh', ['pr', 'view', String(number), '--repo', slug, '--json', 'headRefOid,title,body'])
  if (!head.ok) {
    console.error(`stupify review: couldn't read ${slug}#${number} via gh (auth? does it exist?).`)
    process.exit(1)
  }
  const meta = Pr.pick({ headRefOid: true, title: true, body: true }).parse(JSON.parse(head.stdout))
  const pr = {
    number,
    ...meta,
    isDraft: false,
    author: { login: '', is_bot: false },
    labels: [],
  }
  const read = getDiff(cfg, number)
  if (!read.ok) {
    console.error(
      read.reason === 'too-large'
        ? `stupify review: ${slug}#${number} is over GitHub's ${GH_DIFF_LIMITS} diff API limit, so gh can't return it and there's nothing to review. Split the PR.`
        : `stupify review: couldn't fetch the diff for ${slug}#${number}.`,
    )
    process.exit(1)
  }
  const { diff } = read
  console.error(`reviewing ${slug}#${number} …`) // progress on stderr; stdout stays just the review
  const r = await runReview(cfg, pr, '', diff) // no memory: a manual review is always a fresh, full take
  if (r.kind === 'limit' || r.kind === 'fail') {
    console.error(
      `stupify review: ${r.kind === 'limit' ? 'codex is out of credits / rate-limited' : "codex couldn't produce a review"} — ${r.reason}`,
    )
    process.exit(1)
  }
  if (r.kind === 'noop' || r.kind === 'fixed') {
    console.log('LGTM ✅  (no blocking issues)') // a one-shot manual review has no prior findings to "fix" — both read as clean
    return
  }
  if (!post) {
    console.log([r.opener, ...r.findings.map((f) => f.body)].filter(Boolean).join('\n\n')) // default: print to stdout
    return
  }
  if (!postReview(cfg, pr, r.opener, r.findings, diff)) {
    console.error('stupify review: the review ran but posting it failed (gh).')
    process.exit(1)
  }
  console.log(`posted to ${slug}#${number} ✅ (${r.findings.length} inline)`)
}
