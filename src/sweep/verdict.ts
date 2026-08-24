// The review VERDICT contract: codex returns ONE JSON object matching ReviewOutput (enforced at the provider via
// `codex exec --output-schema`), and parseReview is the boundary guard behind that enforcement. Also the marker /
// convergence-note vocabulary every posted review carries.
import { z } from 'zod'

import { parseJson } from '../parse-json'
import { type Pr } from './prs'

// The output carries only what the runner acts on — path/line (the thread anchor) and severity (→ blocking);
// `body` is the model's own markdown, posted verbatim. Only high/med block; low/note/praise are non-blocking.
const BLOCKING = new Set(['high', 'med'])
const ReviewOutput = z.strictObject({
  verdict: z.enum(['findings', 'fixed', 'no_new_issues']),
  opener: z.string(),
  findings: z.array(
    z.strictObject({
      path: z.string(),
      line: z.int().min(1),
      severity: z.enum(['high', 'med', 'low', 'note', 'praise']),
      body: z.string(),
    }),
  ),
})
export const REVIEW_SCHEMA = z.toJSONSchema(ReviewOutput)

export const ParsedFinding = z.object({
  path: z.string(),
  line: z.number(),
  body: z.string(),
  blocking: z.boolean(),
})
export type ParsedFinding = z.infer<typeof ParsedFinding>

export const ReviewVerdict = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('no_new_issues') }),
  z.object({ kind: z.literal('fixed') }),
  z.object({ kind: z.literal('findings'), opener: z.string(), findings: z.array(ParsedFinding) }),
])
export type ReviewVerdict = z.infer<typeof ReviewVerdict>

const stripMarkers = (s: string): string => s.replaceAll(/<!--[\s\S]*?-->/g, '').trim() // drop any marker codex tacked on

/** Boundary guard behind the enforced schema: a provider that ignores response_format degrades to a loud,
 *  retryable null — never a guessed or partially-posted review. */
export function parseReview(raw: string): ReviewVerdict | null {
  const data = parseJson(ReviewOutput, raw)
  if (data === undefined) {
    return null
  }
  if (data.verdict !== 'findings') {
    // A convergence verdict that ALSO carries findings is contradictory — fail loud rather than resolve threads
    // and post a ✅ while silently dropping what the model found.
    return data.findings.length === 0 ? { kind: data.verdict } : null
  }
  if (data.findings.length === 0) {
    return null
  }
  const findings: ParsedFinding[] = []
  for (const f of data.findings) {
    const path = f.path.trim()
    const body = stripMarkers(f.body)
    if (!path || !body) {
      return null
    }
    findings.push({ path, line: f.line, blocking: BLOCKING.has(f.severity), body })
  }
  return { kind: 'findings', opener: stripMarkers(data.opener), findings }
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

// codex sometimes SAYS its output as the final message instead of writing it to the review file (observed on
// #7528/#7537/#7627 — the run then read as FAILED and the head got throttled for an hour). Recover the final
// message from the transcript: it's the text between the last bare `codex` line and its `tokens used` footer.
// Only that message — never the whole transcript, which inlines the untrusted diff — may stand in for the file.
export const finalCodexMessage = (out: string): string => {
  const lines = out.split('\n')
  const end = lines.findLastIndex((l) => /^tokens used\b/i.test(l.trim()))
  const start = lines.slice(0, end === -1 ? lines.length : end).findLastIndex((l) => l.trim() === 'codex')
  if (start === -1 || end === -1) {
    return ''
  }
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim()
}
