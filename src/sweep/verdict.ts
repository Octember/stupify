import { z } from 'zod'

import { type Pr } from './prs'

const BLOCKING = new Set(['high', 'med'])
const Severity = z.enum(['high', 'med', 'low', 'note', 'praise'])
const EMOJI = { high: '🔴', med: '🟠', low: '🟡', note: '🔵', praise: '🟢' } as const
export const ReviewOutput = z.strictObject({
  verdict: z.enum(['findings', 'fixed', 'no_new_issues']),
  opener: z.string(),
  findings: z.array(
    z.strictObject({
      path: z.string(),
      line: z.int().min(1),
      severity: Severity,
      conf: z.number().min(0).max(1),
      body: z.string(),
    }),
  ),
})
export type ReviewOutput = z.infer<typeof ReviewOutput>

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

export function parseReview(data: ReviewOutput): ReviewVerdict {
  if (data.verdict !== 'findings') {
    if (data.findings.length > 0) {
      throw new Error('review parsed but had no usable findings')
    }
    return { kind: data.verdict }
  }
  const findings = data.findings
    .filter((f) => f.path.trim() && f.body.trim())
    .map((f) => ({
      path: f.path.trim(),
      line: f.line,
      blocking: BLOCKING.has(f.severity),
      body: `${heading(f.severity, f.conf, f.path.trim(), f.line)}\n\n${f.body.trim()}`,
    }))
  if (findings.length === 0) {
    throw new Error('review parsed but had no usable findings')
  }
  return { kind: 'findings', opener: data.opener, findings }
}

export const markFor = (pr: Pr): string => `<!-- stupify:${pr.headRefOid} -->`

export const FIXED_NOTE = 'nice, all fixed ✅'

export const STILL_NOTE = 'still ✅'
