// Listing and scoping open PRs (the gh pr list boundary), plus the per-PR MEMORY: the existing review
// conversation read back and defanged so it can be fed to codex as untrusted data.
import { exec } from '@bevyl-ai/agent-tools'
import { z } from 'zod'

import { type Config, log } from './config'

// The gh pr list --json boundary. z.object (not strictObject) STRIPS extra keys gh adds. A non-array or
// unshaped entry throws — no silent skip.
export const Pr = z.object({
  number: z.number(),
  headRefOid: z.string(),
  baseRefOid: z.string(),
  baseRefName: z.string(),
  isDraft: z.boolean(),
  author: z.object({ login: z.string(), is_bot: z.boolean() }).nullable(), // is_bot flags GitHub App bots (app/dependabot) the [bot] suffix misses
  labels: z.array(z.object({ name: z.string() })),
  title: z.string(), // title + body carry the author's STATED INTENT — fed (untrusted) into the prompt so the reviewer can weigh "I did this on purpose, here's why" instead of flagging a deliberate call as a mistake
  body: z.string(), // gh returns "" for an empty description, never absent
})
export type Pr = z.infer<typeof Pr>

// gh's default --limit is 30, NEWEST-first — on a repo with more open PRs than that, the older ones silently
// fall off the sweep's radar entirely: never re-reviewed, no log line, no skip status. (Observed on a 129-open-PR
// repo: a PR at list position 57 got fresh pushes for two days and the sweep never saw them.) 500 keeps the sweep
// exhaustive on any realistically-sized backlog; per-head dedup keeps the extra listings cheap.
const PR_LIST_LIMIT = 500

const ListedPr = Pr.omit({ baseRefOid: true })
const RestPull = z.object({ number: z.number(), base: z.object({ sha: z.string() }) })

// `gh pr list --json` on Ubuntu's 2.45 gh has headRefOid but not baseRefOid — unknown field → empty
// stdout, which the sweep used to log as "auth/network down". Pull base SHAs from REST instead.
function pullBaseOids(slug: string): Map<number, string> | null {
  const r = exec('gh', ['api', `repos/${slug}/pulls?state=open&per_page=100`, '--paginate'])
  if (!r.ok) {
    return null
  }
  const pulls = z.array(RestPull).parse(JSON.parse(r.stdout))
  return new Map(pulls.map((p) => [p.number, p.base.sha]))
}

export function listPrs(cfg: Config): Pr[] | null {
  // Filter the PR list directly rather than `gh pr list --label` — that search index lags behind labelling.
  const fields = 'number,headRefOid,baseRefName,isDraft,author,labels,title,body'
  const r = exec('gh', [
    'pr',
    'list',
    '--repo',
    cfg.slug,
    '--state',
    'open',
    '--limit',
    String(PR_LIST_LIMIT),
    '--json',
    fields,
  ])
  if (!r.ok) {
    log(`gh pr list failed — aborting sweep: ${r.combined.trim().split('\n')[0] ?? 'unknown error'}`)
    return null
  }
  const listed = z.array(ListedPr).parse(JSON.parse(r.stdout))
  const bases = pullBaseOids(cfg.slug)
  if (bases === null) {
    log('gh api pulls failed (auth/network down?) — aborting sweep')
    return null
  }
  const out: Pr[] = []
  for (const pr of listed) {
    const baseRefOid = bases.get(pr.number)
    if (!baseRefOid) {
      throw new Error(`open PR #${pr.number} missing from REST pulls list`)
    }
    out.push({ ...pr, baseRefOid })
  }
  return out
}

export function hasReviewLabel(pr: Pr, cfg: Config): boolean {
  return pr.labels.some((l) => l.name === cfg.reviewLabel)
}

export function inScope(pr: Pr, cfg: Config): boolean {
  if (pr.isDraft) {
    return false
  }
  // Never review bot PRs, in EITHER scope — UNLESS the PR carries REVIEW_LABEL, the explicit force-include: a
  // bot-authored PR you deliberately label is opted in (e.g. a factory that authors PRs as a GitHub App and wants
  // them reviewed). gh's is_bot catches GitHub App bots (login `app/dependabot`) that the `[bot]` suffix misses;
  // keep the suffix check as a belt-and-suspenders fallback.
  if ((pr.author?.is_bot === true || (pr.author?.login ?? '').endsWith('[bot]')) && !hasReviewLabel(pr, cfg)) {
    return false
  }
  if (cfg.scope === 'label') {
    return hasReviewLabel(pr, cfg)
  }
  return true // auto: any non-draft, non-bot PR
}

export interface Comment {
  login: string
  body: string
}

// The per-PR MEMORY: the existing review conversation — the reviewer's past reviews + the author's replies —
// fed back into the prompt so it stops re-litigating settled points and knows when to converge. The GitHub
// thread IS the durable store (survives restarts, already holds the replies); we just read it back.
const MEMORY_COMMENTS = 20 // recent thread context, bounded so the prompt can't balloon on a chatty PR
const MEMORY_BYTE_CAP = 16_000 // hard backstop: even 20 essays can't blow the prompt (and cached prefix) past this

// The thread is UNTRUSTED PR-comment content that gets inlined inside a <prior_reviews> fence. Strip hidden
// markers AND neutralize any literal fence tag in the body, so a comment can't CLOSE the fence early and smuggle
// instructions in as if they were the runner's. This is the HARD boundary; the prompt's SECURITY note is the soft
// one — relying on the model to be obedient is not a security control.
export function defang(body: string): string {
  return body
    .replaceAll(/<!--[\s\S]*?-->/g, '') // hidden markers (incl. our own stupify: markers)
    .replaceAll(/<(?<slash>\/?)\s*(?<tag>prior_reviews|pr_description|dismissed)\s*>/gi, '‹$<slash>$<tag>›') // can't break out of any untrusted fence
    .trim()
}

export function priorReviewThread(comments: Comment[]): string {
  const thread = comments
    .filter((c) => !c.login.endsWith('[bot]')) // drop CI bots; keep prior reviews + human/agent replies
    .slice(-MEMORY_COMMENTS)
    .map((c) => ({ login: c.login, body: defang(c.body) }))
    .filter((c) => c.body.length > 0)
    .map((c) => `@${c.login}:\n${c.body}`)
    .join('\n\n---\n\n')
  return thread.length > MEMORY_BYTE_CAP ? thread.slice(-MEMORY_BYTE_CAP) : thread // keep the most recent context
}
