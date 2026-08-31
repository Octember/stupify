import { expect, test } from 'bun:test'

import { parseReview, parseReviewJson } from './verdict'

test('parseReview stamps emoji, conf, and file pointer', () => {
  const parsed = parseReview({
    verdict: 'findings',
    opener: '',
    findings: [{ path: 'src/x.ts', line: 30, severity: 'high', blocking: true, conf: 0.9, body: 'breaks on empty' }],
  })
  if (parsed.kind !== 'findings') {
    throw new Error('expected findings')
  }
  expect(parsed.findings[0]?.body).toBe(`🔴 · conf 0.9 · **\`src/x.ts:30\`**

breaks on empty`)
})

test('parseReview keeps fixed and no_new_issues when findings are empty', () => {
  expect(parseReview({ verdict: 'fixed', opener: '', findings: [] })).toEqual({ kind: 'fixed' })
  expect(parseReview({ verdict: 'no_new_issues', opener: '', findings: [] })).toEqual({ kind: 'no_new_issues' })
})

test('parseReview rejects empty or contradictory findings', () => {
  expect(() => parseReview({ verdict: 'findings', opener: '', findings: [] })).toThrow()
  expect(() =>
    parseReview({
      verdict: 'fixed',
      opener: '',
      findings: [{ path: 'src/x.ts', line: 1, severity: 'low', blocking: false, conf: 0.1, body: 'leftover' }],
    }),
  ).toThrow()
})

test('parseReviewJson reads the second-pass message', () => {
  const verdict = parseReviewJson(
    JSON.stringify({
      verdict: 'findings',
      opener: 'ok',
      findings: [{ path: 'a.ts', line: 2, severity: 'med', blocking: true, conf: 1, body: 'dup' }],
    }),
  )
  if (verdict.kind !== 'findings') {
    throw new Error('expected findings')
  }
  expect(verdict.opener).toBe('ok')
  expect(verdict.findings[0]?.blocking).toBe(true)
})
