import { exec } from '@bevyl-ai/agent-tools'
import { z } from 'zod'

import { type Config, log } from './config'

export const Pr = z.object({
  number: z.number(),
  headRefOid: z.string(),
  baseRefOid: z.string(),
  baseRefName: z.string(),
  isDraft: z.boolean(),
  author: z.object({ login: z.string(), is_bot: z.boolean() }).nullable(),
  labels: z.array(z.object({ name: z.string() })),
  title: z.string(),
  body: z.string(),
})
export type Pr = z.infer<typeof Pr>

const PR_LIST_LIMIT = 500

const ListedPr = Pr.omit({ baseRefOid: true })
const RestPull = z.object({ number: z.number(), base: z.object({ sha: z.string() }) })

const REST_PAGE = 100

function pullBaseOids(slug: string): Map<number, string> | null {
  const bases = new Map<number, string>()
  for (let page = 1; ; page++) {
    const r = exec('gh', ['api', `repos/${slug}/pulls?state=open&per_page=${REST_PAGE}&page=${page}`])
    if (!r.ok) {
      log(`gh api pulls failed — aborting sweep: ${r.combined.trim().split('\n')[0] ?? 'unknown error'}`)
      return null
    }
    const pulls = z.array(RestPull).parse(JSON.parse(r.stdout))
    for (const p of pulls) {
      bases.set(p.number, p.base.sha)
    }
    if (pulls.length < REST_PAGE) {
      return bases
    }
  }
}

export function listPrs(cfg: Config): Pr[] | null {
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
    return null
  }
  return listed.map((pr) => {
    const baseRefOid = bases.get(pr.number)
    if (!baseRefOid) {
      throw new Error(`open PR #${pr.number} missing from REST pulls list`)
    }
    return Object.assign(pr, { baseRefOid })
  })
}

export function hasReviewLabel(pr: Pr, cfg: Config): boolean {
  return pr.labels.some((l) => l.name === cfg.reviewLabel)
}

export function inScope(pr: Pr, cfg: Config): boolean {
  if (pr.isDraft) {
    return false
  }

  if ((pr.author?.is_bot === true || (pr.author?.login ?? '').endsWith('[bot]')) && !hasReviewLabel(pr, cfg)) {
    return false
  }
  if (cfg.scope === 'label') {
    return hasReviewLabel(pr, cfg)
  }
  return true
}

export interface Comment {
  login: string
  body: string
}

const MEMORY_COMMENTS = 20
const MEMORY_BYTE_CAP = 16_000

export function defang(body: string): string {
  return body
    .replaceAll(/<!--[\s\S]*?-->/g, '')
    .replaceAll(/<(?<slash>\/?)\s*(?<tag>prior_reviews|pr_description|dismissed)\s*>/gi, '‹$<slash>$<tag>›')
    .trim()
}

export function priorReviewThread(comments: Comment[]): string {
  const thread = comments
    .filter((c) => !c.login.endsWith('[bot]'))
    .slice(-MEMORY_COMMENTS)
    .map((c) => ({ login: c.login, body: defang(c.body) }))
    .filter((c) => c.body.length > 0)
    .map((c) => `@${c.login}:\n${c.body}`)
    .join('\n\n---\n\n')
  return thread.length > MEMORY_BYTE_CAP ? thread.slice(-MEMORY_BYTE_CAP) : thread
}
