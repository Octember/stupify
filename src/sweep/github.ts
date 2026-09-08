import { exec } from '@bevyl-ai/agent-tools'
import { z } from 'zod'

import { type Config, logRaw } from './config'
import { type Comment, type Pr, priorReviewThread } from './prs'
import { markFor, type ParsedFinding } from './verdict'

const STUPIFY_TAG = '<!-- stupify -->'

const STUPIFY_NOTE_TAG = '<!-- stupify:note -->'

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

export function postReview(cfg: Config, pr: Pr, opener: string, findings: ParsedFinding[]): boolean {
  const inline = findings.map((f) => ({
    path: f.path,
    line: f.line,
    side: 'RIGHT' as const,
    body: `${f.body}\n${f.blocking ? STUPIFY_TAG : STUPIFY_NOTE_TAG}`,
  }))
  const head = opener.trim()
  const r = submitReview(cfg, pr, [head, markFor(pr)].filter(Boolean).join('\n\n'), inline)
  if (r.ok) {
    return true
  }

  logRaw(`  postReview #${pr.number} inline rejected, body-only fallback: ${r.combined.slice(0, 200)}\n`)
  return submitReview(cfg, pr, [head, ...findings.map((f) => f.body), markFor(pr)].filter(Boolean).join('\n\n'), []).ok
}

export function postNote(cfg: Config, pr: Pr, note: string): boolean {
  return submitReview(cfg, pr, `${note}\n\n${markFor(pr)}`, []).ok
}

export function resolveThreads(threadIds: string[]): boolean {
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

export interface PriorState {
  memory: string
  reviewedHead: boolean
  everReviewed: boolean
  openThreadIds: string[]
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
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        reviews: z.object({ nodes: z.array(GqlReview) }),
        reviewThreads: z.object({ nodes: z.array(GqlThread) }),
      }),
    }),
  }),
})

export function prReviews(cfg: Config, pr: Pr): PriorState | null {
  const [owner, name] = cfg.slug.split('/')
  if (!owner || !name) {
    return null
  }
  const query = `query { repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${pr.number}) {
    reviews(last: 30) { nodes { body author { login } } }
    reviewThreads(first: 100) { nodes { id isResolved comments(first: 8) { nodes { body author { login } path line } } } }
  } } }`
  const r = exec('gh', ['api', 'graphql', '-f', `query=${query}`])
  if (!r.ok) {
    return null
  }
  const pull = GqlPull.parse(JSON.parse(r.stdout)).data.repository.pullRequest
  const mark = markFor(pr)
  const reviews = pull.reviews.nodes
  const threads = pull.reviewThreads.nodes
  const everReviewed = reviews.some((rv) => (rv.body ?? '').includes('<!-- stupify:'))
  const reviewedHead = reviews.some((rv) => (rv.body ?? '').includes(mark))
  const comments: Comment[] = []
  for (const rv of reviews) {
    if (rv.body?.trim()) {
      comments.push({ login: rv.author?.login ?? '', body: rv.body })
    }
  }
  const openThreadIds: string[] = []
  for (const t of threads) {
    const tc = t.comments?.nodes ?? []
    if (t.isResolved === false && t.id && tc.some((c) => (c.body ?? '').includes(STUPIFY_TAG))) {
      openThreadIds.push(t.id)
    }
    for (const c of tc) {
      if (c.body) {
        comments.push({ login: c.author?.login ?? '', body: `${c.path ?? ''}:${c.line ?? ''} ${c.body}` })
      }
    }
  }
  return {
    memory: priorReviewThread(comments),
    reviewedHead,
    everReviewed,
    openThreadIds,
  }
}
