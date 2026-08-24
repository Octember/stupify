// Listing and scoping open PRs (the gh pr list boundary), plus the per-PR MEMORY: the existing review
// conversation read back and defanged so it can be fed to codex as untrusted data.
import { exec } from '@bevyl-ai/agent-tools'
import { z } from 'zod'

import { parseJson } from '../parse-json'
import { type Config, log } from './config'

// The gh pr list --json boundary. gh guarantees the --json shape, but an auth-error page or schema drift would
// otherwise throw (or silently mis-scope) mid-loop instead of skipping cleanly. z.object (not strictObject)
// STRIPS any extra keys gh adds — same leniency as the old `in`-narrowing, no assertions.
export const Pr = z.object({
  number: z.number(),
  headRefOid: z.string(),
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

export function listPrs(cfg: Config): Pr[] | null {
  // Filter the PR list directly rather than `gh pr list --label` — that search index lags behind labelling.
  const fields = 'number,headRefOid,isDraft,author,labels,title,body'
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
    log('gh pr list failed (auth/network down?) — aborting sweep')
    return null
  }
  const raw = parseJson(z.array(z.unknown()), r.stdout)
  if (raw === undefined) {
    log('gh pr list returned unparseable JSON — aborting sweep')
    return null
  }
  const prs: Pr[] = []
  for (const entry of raw) {
    const parsed = Pr.safeParse(entry)
    if (parsed.success) {
      prs.push(parsed.data)
    }
  }
  if (prs.length < raw.length) {
    log(`gh pr list: ${raw.length - prs.length} entries failed shape check — skipped`)
  }
  return prs
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
