// Guards `stupify init` (bring-your-own scaffold). The invariants the user-sim found blockers in: CORPUS paths
// are repo-root-relative (portable + correct from a subdir), real code is inlined, and a --force rebuild
// PRESERVES the user's hand-written "why" lines. Driven through the real CLI subprocess in throwaway git repos.
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = join(import.meta.dir, 'cli.ts')

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'stupify-init-'))
  spawnSync('git', ['init', '-q'], { cwd: root })
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/a.ts'), 'export const QueueName = (s: string) => s\n')
  writeFileSync(join(root, 'src/b.ts'), 'export const b = 2\n')
  return root
}
const initIn = (cwd: string, sub: string[]) => spawnSync('bun', [CLI, 'init', ...sub], { cwd, encoding: 'utf8' })
const corpus = (root: string) => readFileSync(join(root, '.review', 'CORPUS.md'), 'utf8')
const clean = (root: string) => rmSync(root, { recursive: true, force: true })

test('init writes repo-root-relative paths + inlines real code, even run from a subdir', () => {
  const root = repo()
  mkdirSync(join(root, 'src/deep'), { recursive: true })
  initIn(join(root, 'src/deep'), ['../a.ts']) // from a subdir, with a cwd-relative path
  const c = corpus(root)
  expect(c).toContain('### `src/a.ts`') // repo-root-relative, NOT ../a.ts
  expect(c).not.toContain('../a.ts')
  expect(c).toContain('QueueName') // real code inlined
  clean(root)
})

test('init --force preserves filled-in "why" lines and adds new files', () => {
  const root = repo()
  initIn(root, ['src/a.ts'])
  const p = join(root, '.review', 'CORPUS.md')
  writeFileSync(p, readFileSync(p, 'utf8').replace(/^(### `src\/a\.ts` — ).*$/m, '$1branded value, fails fast'))
  initIn(root, ['src/a.ts', 'src/b.ts', '--force'])
  const c = corpus(root)
  expect(c).toContain('### `src/a.ts` — branded value, fails fast') // kept
  expect(c).toContain('### `src/b.ts`') // added
  clean(root)
})

test('init refuses to overwrite an existing CORPUS without --force', () => {
  const root = repo()
  initIn(root, ['src/a.ts'])
  const before = corpus(root)
  initIn(root, ['src/b.ts']) // no --force
  expect(corpus(root)).toBe(before) // untouched
  clean(root)
})

test('init writes all three files (RUBRIC + REVIEW-PROMPT + CORPUS) for a consistent .review/', () => {
  const root = repo()
  initIn(root, ['src/a.ts'])
  for (const f of ['RUBRIC.md', 'REVIEW-PROMPT.md', 'CORPUS.md']) {
    expect(readFileSync(join(root, '.review', f), 'utf8').length).toBeGreaterThan(0)
  }
  clean(root)
})
