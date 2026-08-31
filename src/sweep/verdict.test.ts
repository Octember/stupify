import { expect, test } from 'bun:test'

import { parseReview } from './verdict'

const review = (data: unknown) => parseReview(JSON.stringify(data))

test('parseReview stamps emoji, conf, and file pointer', () => {
  const parsed = review({
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
  expect(review({ verdict: 'fixed', opener: '', findings: [] })).toEqual({ kind: 'fixed' })
  expect(review({ verdict: 'no_new_issues', opener: '', findings: [] })).toEqual({ kind: 'no_new_issues' })
})

test('parseReview rejects empty or contradictory findings', () => {
  expect(() => review({ verdict: 'findings', opener: '', findings: [] })).toThrow()
  expect(() =>
    review({
      verdict: 'fixed',
      opener: '',
      findings: [{ path: 'src/x.ts', line: 1, severity: 'low', blocking: false, conf: 0.1, body: 'leftover' }],
    }),
  ).toThrow()
})

test('parseReview reads the second-pass message', () => {
  const verdict = review({
    verdict: 'findings',
    opener: 'ok',
    findings: [{ path: 'a.ts', line: 2, severity: 'med', blocking: true, conf: 1, body: 'dup' }],
  })
  if (verdict.kind !== 'findings') {
    throw new Error('expected findings')
  }
  expect(verdict.opener).toBe('ok')
  expect(verdict.findings[0]?.blocking).toBe(true)
})
