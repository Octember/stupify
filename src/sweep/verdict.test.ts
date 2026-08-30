import { expect, test } from 'bun:test'

import { parseReview } from './verdict'

test('parseReview stamps emoji, conf, and file pointer', () => {
  const parsed = parseReview(
    JSON.stringify({
      verdict: 'findings',
      opener: '',
      findings: [{ path: 'src/x.ts', line: 30, severity: 'high', conf: 0.9, body: 'breaks on empty' }],
    }),
  )
  if (parsed?.kind !== 'findings') {
    throw new Error('expected findings')
  }
  expect(parsed.findings[0]?.body).toBe(`🔴 · conf 0.9 · **\`src/x.ts:30\`**

breaks on empty`)
})
