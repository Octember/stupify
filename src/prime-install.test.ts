// Guards the hook installer's contract — it writes a SessionStart hook into each agent's hooks file (Claude
// Code's settings.json, Codex's hooks.json), so the invariants that matter are: MERGE (never clobber other
// hooks/keys), IDEMPOTENT (no duplicate), SURGICAL uninstall (remove only ours), and REFUSE malformed JSON.
// Driven through the real CLI subprocess against throwaway STUPIFY_HOME + CLAUDE_CONFIG_DIR + CODEX_HOME dirs,
// so the real ~/.claude and ~/.codex are never touched.
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = join(import.meta.dir, 'cli.ts')

function env() {
  const home = mkdtempSync(join(tmpdir(), 'stupify-home-'))
  const cfg = mkdtempSync(join(tmpdir(), 'stupify-cc-'))
  const codex = mkdtempSync(join(tmpdir(), 'stupify-cx-'))
  return { home, cfg, codex, settings: join(cfg, 'settings.json'), codexHooks: join(codex, 'hooks.json') }
}
const run = (sub: string[], e: { home: string; cfg: string; codex: string }) =>
  spawnSync('bun', [CLI, ...sub], {
    env: { ...process.env, STUPIFY_HOME: e.home, CLAUDE_CONFIG_DIR: e.cfg, CODEX_HOME: e.codex },
    encoding: 'utf8',
  })
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const clean = (e: { home: string; cfg: string; codex: string }) => {
  for (const d of [e.home, e.cfg, e.codex]) rmSync(d, { recursive: true, force: true })
}
const seeded = JSON.stringify({ theme: 'dark', hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo keep' }] }] } })

test('--install merges into existing settings without clobbering, and is idempotent', () => {
  const e = env()
  writeFileSync(e.settings, seeded)
  run(['prime', '--install', '--agent', 'claude'], e)
  let s = read(e.settings)
  expect(s.theme).toBe('dark') // unrelated key survives
  expect(s.hooks.PostToolUse[0].hooks[0].command).toBe('echo keep') // unrelated hook survives
  expect(s.hooks.SessionStart[0].matcher).toBe('startup')
  expect(s.hooks.SessionStart[0].hooks[0].command).toContain('prime.ts') // points at the copied dep-free engine
  expect(existsSync(join(e.home, 'prime.ts'))).toBe(true) // engine copied

  run(['prime', '--install', '--agent', 'claude'], e) // again
  s = read(e.settings)
  expect(s.hooks.SessionStart).toHaveLength(1) // no duplicate
  clean(e)
})

test('--uninstall removes only our hook + engine, preserving everything else', () => {
  const e = env()
  writeFileSync(e.settings, seeded)
  run(['prime', '--install', '--agent', 'claude'], e)
  run(['prime', '--uninstall'], e)
  const s = read(e.settings)
  expect(s.theme).toBe('dark')
  expect(s.hooks.PostToolUse[0].hooks[0].command).toBe('echo keep')
  expect(s.hooks.SessionStart).toBeUndefined() // ours gone; empty array collapsed
  expect(existsSync(join(e.home, 'prime.ts'))).toBe(false) // engine removed
  clean(e)
})

test('--install refuses to clobber a malformed settings.json', () => {
  const e = env()
  writeFileSync(e.settings, 'NOT JSON {')
  const r = run(['prime', '--install', '--agent', 'claude'], e)
  expect(readFileSync(e.settings, 'utf8')).toContain('NOT JSON') // left untouched
  expect(r.status).not.toBe(0) // died non-zero rather than overwrite
  clean(e)
})

test('--uninstall on a machine with no settings.json is a clean no-op', () => {
  const e = env()
  const r = run(['prime', '--uninstall'], e)
  expect(r.status).toBe(0)
  expect(existsSync(e.settings)).toBe(false)
  clean(e)
})

test('--agent codex wires ~/.codex/hooks.json (startup|resume) and leaves Claude untouched', () => {
  const e = env()
  run(['prime', '--install', '--agent', 'codex', '--pack', 'zod'], e)
  const s = read(e.codexHooks)
  expect(s.hooks.SessionStart[0].matcher).toBe('startup|resume') // codex fires on new + resumed sessions
  expect(s.hooks.SessionStart[0].hooks[0].command).toContain('prime.ts') // same dep-free emitter
  expect(existsSync(e.settings)).toBe(false) // only codex selected → Claude settings not created
  clean(e)
})

test('--agent claude,codex wires both, and --uninstall sweeps both', () => {
  const e = env()
  run(['prime', '--install', '--agent', 'claude,codex', '--pack', 'zod'], e)
  expect(read(e.settings).hooks.SessionStart[0].matcher).toBe('startup')
  expect(read(e.codexHooks).hooks.SessionStart[0].matcher).toBe('startup|resume')
  run(['prime', '--uninstall'], e)
  expect(read(e.settings).hooks?.SessionStart).toBeUndefined() // ours gone; empty hooks object collapsed
  expect(read(e.codexHooks).hooks?.SessionStart).toBeUndefined()
  clean(e)
})

test('--agent codex merges into an existing hooks.json without clobbering', () => {
  const e = env()
  writeFileSync(e.codexHooks, seeded) // a pre-existing user hooks.json with an unrelated PostToolUse hook
  run(['prime', '--install', '--agent', 'codex', '--pack', 'zod'], e)
  const s = read(e.codexHooks)
  expect(s.theme).toBe('dark')
  expect(s.hooks.PostToolUse[0].hooks[0].command).toBe('echo keep') // their hook survives
  expect(s.hooks.SessionStart[0].hooks[0].command).toContain('prime.ts') // ours added alongside
  clean(e)
})

test('--agent with an unknown name errors out instead of silently doing nothing', () => {
  const e = env()
  const r = run(['prime', '--install', '--agent', 'emacs'], e)
  expect(r.status).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('unknown --agent')
  expect(existsSync(e.settings)).toBe(false) // nothing wired
  clean(e)
})

test('taste --pack assembles ~/.stupify/.review and nothing else (no reviewer leaks in)', () => {
  const e = env()
  run(['taste', '--pack', 'devshorts,zod'], e)
  expect(readFileSync(join(e.home, '.review', 'CORPUS.md'), 'utf8')).toContain('devshorts') // packs assembled
  expect(existsSync(join(e.home, 'config.env'))).toBe(false) // no reviewer config
  expect(existsSync(join(e.home, 'review-sweep.ts'))).toBe(false) // no reviewer engine
  clean(e)
})

test('--install refreshes a stale command on re-install (not just the engine file)', () => {
  const e = env()
  run(['prime', '--install', '--agent', 'claude', '--pack', 'zod'], e)
  // simulate bun having moved since first install: rewrite the stored command to a stale path
  // (keep the engine path so the entry is still recognized as ours)
  const s = read(e.settings)
  s.hooks.SessionStart[0].hooks[0].command = `/old/stale/bun ${join(e.home, 'prime.ts')}`
  writeFileSync(e.settings, JSON.stringify(s))
  run(['prime', '--install', '--agent', 'claude', '--pack', 'zod'], e)
  const after = read(e.settings)
  expect(after.hooks.SessionStart).toHaveLength(1) // still no duplicate
  expect(after.hooks.SessionStart[0].hooks[0].command).not.toContain('/old/stale/bun') // stale path corrected
  expect(after.hooks.SessionStart[0].hooks[0].command).toContain('prime.ts')
  clean(e)
})

test('prime --install --pack assembles taste AND wires the hook in one step', () => {
  const e = env()
  run(['prime', '--install', '--agent', 'claude', '--pack', 'zod'], e)
  expect(readFileSync(join(e.home, '.review', 'CORPUS.md'), 'utf8')).toContain('zod') // taste assembled
  const s = read(e.settings)
  expect(s.hooks.SessionStart[0].hooks[0].command).toContain('prime.ts') // and hook wired
  clean(e)
})

test('status renders the latest sweep workflow from state/status.json', () => {
  const e = env()
  const stateDir = join(e.home, 'state')
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(
    join(stateDir, 'status.json'),
    JSON.stringify({
      version: 1,
      repo: 'acme/widgets',
      scope: 'auto',
      dryRun: false,
      stage: 'reviewing',
      startedAt: '2026-06-22T10:00:00Z',
      updatedAt: '2026-06-22T10:00:30Z',
      message: 'reviewing 2 PR(s) in scope',
      totals: { openPrs: 3, inScope: 2, handled: 1, reviewed: 0, skipped: 1, tokens: 0, maxPrs: 15 },
      prs: [
        { number: 7, title: 'tighten parser', head: 'abcdef123456', state: 'reviewing', detail: 'running codex over 91 diff lines', lines: 91, updatedAt: '2026-06-22T10:00:30Z' },
        { number: 8, title: 'huge import', head: '999999999999', state: 'skipped', detail: 'diff 7000 lines > cap 5000', lines: 7000, updatedAt: '2026-06-22T10:00:20Z' },
      ],
    }),
  )

  const r = run(['status'], e)
  expect(r.status).toBe(0)
  expect(r.stdout).toContain('stupify status')
  expect(r.stdout).toContain('acme/widgets')
  expect(r.stdout).toContain('#7 tighten parser')
  expect(r.stdout).toContain('running codex over 91 diff lines')
  expect(r.stdout).toContain('#8 huge import')
  clean(e)
})
