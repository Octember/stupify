// The review VERDICT contract: Codex returns ONE JSON object matching ReviewOutput (SDK `outputSchema` on the
// second turn), and parseReview is the boundary guard behind that enforcement. Also the marker /
// convergence-note vocabulary every posted review carries.
import { z } from 'zod'

import { type Pr } from './prs'

// The output carries path/line (thread anchor), severity (→ blocking), and conf. The runner stamps
// emoji + conf + file pointer onto `body`. Only high/med block; low/note/praise are non-blocking.
const BLOCKING = new Set(['high', 'med'])
const Severity = z.enum(['high', 'med', 'low', 'note', 'praise'])
const EMOJI = { high: '🔴', med: '🟠', low: '🟡', note: '🔵', praise: '🟢' } as const
export const ReviewOutput = z.strictObject({
  verdict: z.enum(['findings', 'fixed', 'no_new_issues']),
  opener: z
    .string()
    .describe(
      'Optional. Recommended for more detailed reviews. The main message, prefix of any inline messages. Ought to be terse.'
    ),
  findings: z.array(
    z.strictObject({
      path: z.string('repo-relative path to the file'),
      line: z.int().min(1).describe('line number'),
      severity: Severity.required().describe('severity: blocking or non-blocking'),
      blocking: z.boolean().describe('whether the finding should block merge'),
      conf: z.number().min(0).max(100).describe('confidence score: bias low'),
      body: z.string().describe(),
    }),
  ),
})
export type ReviewOutput = z.infer<typeof ReviewOutput>
const { $schema: _schema, ...reviewSchema } = z.toJSONSchema(ReviewOutput)
export const REVIEW_SCHEMA = reviewSchema

export interface ParsedFinding {
  path: string
  line: number
  body: string
  blocking: boolean
}
export type ReviewVerdict =
  | { kind: 'no_new_issues' }
  | { kind: 'fixed' }
  | { kind: 'findings'; opener: string; findings: ParsedFinding[] }

const heading = (severity: z.infer<typeof Severity>, conf: number, path: string, line: number): string =>
  `${EMOJI[severity]} · conf ${Number(conf.toFixed(2))} · **\`${path}:${line}\`**`

const postedBody = (head: string, body: string): string => `${head}

${body}`

/** Stamp headings and split verdicts. Caller already `ReviewOutput.parse`d the model JSON. */
export function parseReview(data: ReviewOutput): ReviewVerdict {
  if (data.verdict !== 'findings') {
    // A convergence verdict that ALSO carries findings is contradictory — fail loud rather than resolve threads
    // and post a ✅ while silently dropping what the model found.
    if (data.findings.length > 0) {
      throw new Error('review parsed but had no usable findings')
    }
    return { kind: data.verdict }
  }
  const findings = data.findings
    .map((f): ParsedFinding | null => {
      const path = f.path.trim()
      const body = f.body.trim()
      if (!path || !body) {
        return null
      }
      return {
        path,
        line: f.line,
        blocking: BLOCKING.has(f.severity),
        body: postedBody(heading(f.severity, f.conf, path, f.line), body),
      }
    })
    .filter((f) => f !== null)
  if (findings.length === 0) {
    throw new Error('review parsed but had no usable findings')
  }
  return { kind: 'findings', opener: data.opener, findings }
}

export function parseReviewJson(raw: string): ReviewVerdict {
  return parseReview(ReviewOutput.parse(JSON.parse(raw)))
}

// The hidden marker stupify ends every posted review with, keyed to the head SHA — how a later sweep recognizes a
// PR it already reviewed AT THIS HEAD (durable dedup, survives VM recreation). Failures aren't posted, so there's
// no fail marker; they're throttled via local state instead.
export const markFor = (pr: Pr): string => `<!-- stupify:${pr.headRefOid} -->`

// "fixed" is gated on there actually being open findings, so a stray fixed-signal on a never-flagged PR can't
// manufacture approval. Detection is strict parse-or-fail — never infer "clean" from anything looser: a reviewer
// fails toward SURFACING findings (loud, retryable), never toward hiding them behind a silent ✅.
export const FIXED_NOTE = 'nice, all fixed ✅'
// The one-line re-approval a clean re-reviewed head gets when nothing is outstanding. Every posted note carries
// the `<!-- stupify:sha -->` marker, so every reviewed head keeps a durable on-PR verdict. Pure silence here made
// the latest push look unreviewed to anything that asks "does a review cover HEAD?" (merge gates, the bunion
// factory's `wait` tool — which timed out and shipped with STUPIFY_FLAKED), and to a sweep whose local
// reviewed-state was lost (VM recreation → codex re-runs on an already-clean head).
export const STILL_NOTE = 'still ✅'
