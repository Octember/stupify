// Proof of the cache invariant: the review prompt's PREFIX (instructions + spec + rubric + corpus index) is
// byte-identical for every PR in a repo, and ONLY the tail (diff target, marker, memory) changes. That stable
// prefix is what the provider caches across diff threads — if a per-PR token ever leaked into it, the cache
// would thrash and this test would go red. We render against the repo's own real .review/ (no mocks).
import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { type Config, type Pr, reviewPrompt, stablePrefix } from './review-sweep'

const REVIEW_DIR = join(import.meta.dir, '..', '.review') // the real spec/rubric/corpus shipped in this repo
const THIS_PR = '===== THIS PR' // the boundary between the cached prefix and the per-PR tail

const cfg = (): Config => ({
  repoDir: '/tmp/x',
  remote: 'https://github.com/acme/widgets.git',
  slug: 'acme/widgets',
  defaultBranch: 'main',
  reviewDir: REVIEW_DIR,
  homeReviewDir: REVIEW_DIR,
  scope: 'label',
  reviewLabel: 'codex-review',
  diffLineCap: 800,
  dryRun: false,
  maxPrs: 15,
  stateDir: '/tmp/x/state',
  codexEffort: 'high',
  codexProvider: '',
  codexModel: '',
})

const pr = (number: number, sha: string): Pr => ({
  number,
  headRefOid: sha,
  isDraft: false,
  author: { login: 'someone' },
  labels: [{ name: 'codex-review' }],
})

const sha256 = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex')
const prefixOf = (prompt: string) => prompt.slice(0, prompt.indexOf(THIS_PR))

// Three different PRs: different numbers, different head SHAs, and (crucially) one mid-thread with memory —
// the hardest case, since "continuing a review" must STILL not perturb the prefix.
const prompts = [
  reviewPrompt(cfg(), pr(1, 'a'.repeat(40)), ''),
  reviewPrompt(cfg(), pr(42, 'b'.repeat(40)), ''),
  reviewPrompt(cfg(), pr(987, 'c'.repeat(40)), 'PRIOR-THREAD: a past review and the author reply'),
]
const prefixes = prompts.map(prefixOf)

test('the cached prefix is byte-identical across every PR (incl. mid-thread)', () => {
  const hashes = new Set(prefixes.map(sha256))
  expect(hashes.size).toBe(1) // one and only one prefix hash, no matter the PR
  expect(prefixes[0]).toBe(prefixes[1])
  expect(prefixes[0]).toBe(prefixes[2])
})

test('the prefix equals stablePrefix(cfg) and carries the real taste, not generic weights', () => {
  expect(prefixes[0]?.trimEnd()).toBe(stablePrefix(cfg()).trimEnd())
  expect(prefixes[0]).toContain('===== RUBRIC')
  expect(prefixes[0]).toContain('===== CORPUS')
})

test('NO per-PR token leaks into the cached prefix', () => {
  for (const prefix of prefixes) {
    expect(prefix).not.toContain('gh pr diff') // the diff command lives in the tail
    expect(prefix).not.toContain('a'.repeat(40)) // no head SHA / marker
    expect(prefix).not.toContain('b'.repeat(40))
    expect(prefix).not.toContain('PRIOR-THREAD') // memory lives in the tail
  }
})

test('only the tail changes — per-PR content is present and correct there', () => {
  expect(prompts[0]).not.toBe(prompts[1]) // whole prompts differ...
  expect(prompts[0]).toContain('gh pr diff 1 --repo acme/widgets')
  expect(prompts[1]).toContain('gh pr diff 42 --repo acme/widgets')
  expect(prompts[2]).toContain('gh pr diff 987 --repo acme/widgets')
  expect(prompts[2]).toContain('PRIOR-THREAD') // memory threaded into the tail
})

test('the prefix is large enough to be cache-eligible (well past the ~1024-token floor)', () => {
  const bytes = prefixes[0]?.length ?? 0
  const approxTokens = Math.round(bytes / 4) // ~4 chars/token, the standard rough estimate
  expect(approxTokens).toBeGreaterThan(1024)

  // Receipt: print the proof so a human sees it, plus the per-100-PR cost model the prefix-cache buys.
  const reads = 100
  const naive = reads // full-price prefix on every run
  const cached = 1 + (reads - 1) * 0.1 // full once, then ~10% cache-read on the rest
  console.log(
    [
      '',
      '  ── cache invariant proof ─────────────────────────────',
      `  prefix sha256 (all PRs):  ${sha256(prefixes[0] ?? '')}`,
      `  prefix size:              ${bytes} bytes  (~${approxTokens} tokens)`,
      `  prefix identical across:  ${prefixes.length} distinct PRs (incl. one mid-thread)`,
      `  prefix cost over ${reads} PRs:   naive ${naive.toFixed(1)}× vs cached ${cached.toFixed(1)}× → ${Math.round((1 - cached / naive) * 100)}% off the prefix`,
      '  ──────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  )
})
