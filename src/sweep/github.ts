// Posting to GitHub and reading back what stupify has already said. Findings land as ONE COMMENT review with
// inline threads; the reviews/threads connection drives dedup, thread-resolution, and the reviewer's memory.
import { exec } from '@bevyl-ai/agent-tools'
import { z } from 'zod'
import { parseJson } from '../parse-json'
import { type Config, logRaw } from './config'
import { diffRightLines } from './diff'
import { type Comment, type Pr, priorReviewThread } from './prs'
import { markFor, type ParsedFinding } from './verdict'

// A hidden tag stamped in every inline finding comment, so a later sweep can find stupify's OWN review threads
// (to resolve them) without knowing the bot login — `gh api user` 403s for GitHub-App integrations, so we identify
// our content by marker, not author (same trick as the head marker).
const STUPIFY_TAG = '<!-- stupify -->'

// Non-blocking findings carry a tag that does NOT contain STUPIFY_TAG as a substring, so prReviews/
// dismissedFindings never match them: they don't hold the ✅ and are never re-raised on a silent resolve.
const STUPIFY_NOTE_TAG = '<!-- stupify:note -->'

// One non-blocking COMMENT review: `comments` are inline, each anchored to a diff line (a resolvable thread).
function submitReview(
  cfg: Config,
  pr: Pr,
  body: string,
  comments: { path: string; line: number; side: 'RIGHT'; body: string }[],
): { ok: boolean; combined: string } {
  const payload = JSON.stringify({ event: 'COMMENT', commit_id: pr.headRefOid, body, comments })
  return exec('gh', ['api', `repos/${cfg.slug}/pulls/${pr.number}/reviews`, '--method', 'POST', '--input', '-'], {
    input: payload,
  })
}

// Post findings as ONE COMMENT review: each finding becomes an inline comment anchored to its diff line (a
// resolvable thread); the body carries the opener + the head marker (dedup). Findings on a line the diff doesn't
// touch can't be anchored, so they're demoted into the body rather than 422-ing the whole review.
export function postReview(cfg: Config, pr: Pr, opener: string, findings: ParsedFinding[], diff: string): boolean {
  const valid = diffRightLines(diff)
  const inline: { path: string; line: number; side: 'RIGHT'; body: string }[] = []
  const demoted: string[] = []
  for (const f of findings) {
    if (valid.get(f.path)?.has(f.line))
      inline.push({
        path: f.path,
        line: f.line,
        side: 'RIGHT',
        body: `${f.body}\n${f.blocking ? STUPIFY_TAG : STUPIFY_NOTE_TAG}`,
      })
    else demoted.push(f.body)
  }
  const head = opener || '👀 a couple things'
  if (inline.length === 0) return submitReview(cfg, pr, [head, ...demoted, markFor(pr)].join('\n\n'), []).ok
  const body =
    demoted.length > 0
      ? [head, `couldn't anchor these to a changed line:\n\n${demoted.join('\n\n')}`, markFor(pr)]
      : [head, markFor(pr)]
  const r = submitReview(cfg, pr, body.join('\n\n'), inline)
  if (r.ok) return true
  // GitHub rejects the WHOLE review if any single inline anchor is a line it won't accept (a diff edge
  // diffRightLines didn't catch). Don't lose the findings to one bad line: retry body-only so they still land
  // (visible, just not inline) instead of failing — and re-failing — every sweep.
  logRaw(`  postReview #${pr.number} inline rejected, body-only fallback: ${r.combined.slice(0, 200)}\n`)
  return submitReview(cfg, pr, [head, ...findings.map((f) => f.body), markFor(pr)].join('\n\n'), []).ok
}

// A bodied-only COMMENT review (no inline comments) — for the one-time `LGTM ✅` on a clean first pass, or to carry
// a review codex wrote without parseable per-line findings. Body still ends with the head marker for dedup.
export function postNote(cfg: Config, pr: Pr, note: string): boolean {
  return submitReview(cfg, pr, `${note}\n\n${markFor(pr)}`, []).ok
}

// Resolve stupify's open threads when its findings are fixed — the native "this is handled" signal.
export function resolveThreads(threadIds: string[]): boolean {
  // Resolve every thread even if one fails — a partial resolve still leaves work for the next sweep.
  return threadIds
    .map(
      (id) =>
        exec('gh', [
          'api',
          'graphql',
          '-f',
          `query=mutation { resolveReviewThread(input: { threadId: "${id}" }) { thread { id } } }`,
        ]).ok,
    )
    .every(Boolean)
}

// What stupify has already said on a PR — read from the REVIEWS/THREADS connection (findings are inline threads now,
// not issue comments). Drives dedup (a review body carries the head marker), firstReview, thread-resolution, and the
// memory fed back to codex. gh's GraphQL shape is trusted; navigate leniently and default on anything missing.
export interface PriorState {
  memory: string // prior findings + the author's replies, fenced for codex (priorReviewThread output)
  reviewedHead: boolean // a stupify review for THIS head exists — durable dedup, survives VM recreation
  everReviewed: boolean // stupify has reviewed this PR at all → firstReview = !everReviewed
  openThreadIds: string[] // stupify's UNRESOLVED threads — resolve these when the findings are fixed
  dismissed: string[] // findings the author RESOLVED without a reply — re-raise if still present (see dismissedFindings)
}
const GqlAuthor = z.object({ login: z.string().optional() }).nullable()
const GqlComment = z.object({
  body: z.string().optional(),
  author: GqlAuthor.optional(),
  path: z.string().optional(),
  line: z.number().nullable().optional(),
})
const GqlThread = z.object({
  id: z.string().optional(),
  isResolved: z.boolean().optional(),
  comments: z.object({ nodes: z.array(GqlComment).optional() }).optional(),
})
type GqlThread = z.infer<typeof GqlThread>
const GqlReview = z.object({ body: z.string().optional(), author: GqlAuthor.optional() })
const GqlPull = z.object({
  data: z
    .object({
      repository: z
        .object({
          pullRequest: z
            .object({
              reviews: z.object({ nodes: z.array(GqlReview).optional() }).optional(),
              reviewThreads: z.object({ nodes: z.array(GqlThread).optional() }).optional(),
            })
            .nullable()
            .optional(),
        })
        .nullable()
        .optional(),
    })
    .optional(),
})

// A RESOLVED stupify thread with no human reply = a finding the author dismissed without saying why. Every stupify
// finding carries STUPIFY_TAG and a human reply doesn't, so "has a tagged comment, has no untagged one" is the
// signal — no author-login lookup needed. Returns each such finding's body (tag stripped) so the next review can
// re-raise it IF the issue is still in the diff. A resolve WITH a reply is a reasoned decline and is left alone.
export function dismissedFindings(threads: GqlThread[]): string[] {
  const out: string[] = []
  for (const t of threads) {
    if (t.isResolved !== true) continue
    const tc = (t.comments?.nodes ?? []).filter((c) => (c.body ?? '').trim())
    const ours = tc.filter((c) => (c.body ?? '').includes(STUPIFY_TAG))
    const human = tc.filter((c) => !(c.body ?? '').includes(STUPIFY_TAG))
    if (ours.length > 0 && human.length === 0) {
      const body = (ours[0]?.body ?? '').replaceAll(STUPIFY_TAG, '').trim()
      if (body) out.push(body)
    }
  }
  return out
}

export function prReviews(cfg: Config, pr: Pr): PriorState | null {
  const [owner, name] = cfg.slug.split('/')
  if (!owner || !name) return null
  const query = `query { repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${pr.number}) {
    reviews(last: 30) { nodes { body author { login } } }
    reviewThreads(first: 100) { nodes { id isResolved comments(first: 8) { nodes { body author { login } path line } } } }
  } } }`
  const r = exec('gh', ['api', 'graphql', '-f', `query=${query}`])
  if (!r.ok) return null
  const parsed = parseJson(GqlPull, r.stdout)
  if (parsed === undefined) return null
  const pull = parsed.data?.repository?.pullRequest
  if (!pull) return null
  const mark = markFor(pr)
  const reviews = pull.reviews?.nodes ?? []
  const threads = pull.reviewThreads?.nodes ?? []
  const everReviewed = reviews.some((rv) => (rv.body ?? '').includes('<!-- stupify:'))
  const reviewedHead = reviews.some((rv) => (rv.body ?? '').includes(mark))
  const comments: Comment[] = []
  for (const rv of reviews) if (rv.body?.trim()) comments.push({ login: rv.author?.login ?? '', body: rv.body })
  const openThreadIds: string[] = []
  for (const t of threads) {
    const tc = t.comments?.nodes ?? []
    if (t.isResolved === false && t.id && tc.some((c) => (c.body ?? '').includes(STUPIFY_TAG))) openThreadIds.push(t.id)
    for (const c of tc)
      if (c.body) comments.push({ login: c.author?.login ?? '', body: `${c.path ?? ''}:${c.line ?? ''} ${c.body}` })
  }
  return {
    memory: priorReviewThread(comments),
    reviewedHead,
    everReviewed,
    openThreadIds,
    dismissed: dismissedFindings(threads),
  }
}
