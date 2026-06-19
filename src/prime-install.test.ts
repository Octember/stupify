// Guards the hook installer's contract — it writes to the user's Claude Code settings.json, so the invariants
// that matter are: MERGE (never clobber other hooks/keys), IDEMPOTENT (no duplicate), SURGICAL uninstall
// (remove only ours), and REFUSE malformed JSON. Driven through the real CLI subprocess against throwaway
// STUPIFY_HOME + CLAUDE_CONFIG_DIR dirs, so the real ~/.claude is never touched.
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = join(import.meta.dir, 'cli.ts')

function env() {
  const home = mkdtempSync(join(tmpdir(), 'stupify-home-'))
  const cfg = mkdtempSync(join(tmpdir(), 'stupify-cc-'))
  return { home, cfg, settings: join(cfg, 'settings.json') }
}
const run = (sub: string[], e: { home: string; cfg: string }) =>
  spawnSync('bun', [CLI, ...sub], { env: { ...process.env, STUPIFY_HOME: e.home, CLAUDE_CONFIG_DIR: e.cfg }, encoding: 'utf8' })
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const seeded = JSON.stringify({ theme: 'dark', hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo keep' }] }] } })

test('--install merges into existing settings without clobbering, and is idempotent', () => {
  const e = env()
  writeFileSync(e.settings, seeded)
  run(['prime', '--install'], e)
  let s = read(e.settings)
  expect(s.theme).toBe('dark') // unrelated key survives
  expect(s.hooks.PostToolUse[0].hooks[0].command).toBe('echo keep') // unrelated hook survives
  expect(s.hooks.SessionStart[0].matcher).toBe('startup')
  expect(s.hooks.SessionStart[0].hooks[0].command).toContain('prime.ts') // points at the copied dep-free engine
  expect(existsSync(join(e.home, 'prime.ts'))).toBe(true) // engine copied

  run(['prime', '--install'], e) // again
  s = read(e.settings)
  expect(s.hooks.SessionStart).toHaveLength(1) // no duplicate
  rmSync(e.home, { recursive: true, force: true })
  rmSync(e.cfg, { recursive: true, force: true })
})

test('--uninstall removes only our hook + engine, preserving everything else', () => {
  const e = env()
  writeFileSync(e.settings, seeded)
  run(['prime', '--install'], e)
  run(['prime', '--uninstall'], e)
  const s = read(e.settings)
  expect(s.theme).toBe('dark')
  expect(s.hooks.PostToolUse[0].hooks[0].command).toBe('echo keep')
  expect(s.hooks.SessionStart).toBeUndefined() // ours gone; empty array collapsed
  expect(existsSync(join(e.home, 'prime.ts'))).toBe(false) // engine removed
  rmSync(e.home, { recursive: true, force: true })
  rmSync(e.cfg, { recursive: true, force: true })
})

test('--install refuses to clobber a malformed settings.json', () => {
  const e = env()
  writeFileSync(e.settings, 'NOT JSON {')
  const r = run(['prime', '--install'], e)
  expect(readFileSync(e.settings, 'utf8')).toContain('NOT JSON') // left untouched
  expect(r.status).not.toBe(0) // died non-zero rather than overwrite
  rmSync(e.home, { recursive: true, force: true })
  rmSync(e.cfg, { recursive: true, force: true })
})

test('--uninstall on a machine with no settings.json is a clean no-op', () => {
  const e = env()
  const r = run(['prime', '--uninstall'], e)
  expect(r.status).toBe(0)
  expect(existsSync(e.settings)).toBe(false)
  rmSync(e.home, { recursive: true, force: true })
  rmSync(e.cfg, { recursive: true, force: true })
})

test('taste --pack assembles ~/.stupify/.review and nothing else (no reviewer leaks in)', () => {
  const e = env()
  run(['taste', '--pack', 'anton-kropp,zod'], e)
  expect(readFileSync(join(e.home, '.review', 'CORPUS.md'), 'utf8')).toContain('Anton Kropp') // packs assembled
  expect(existsSync(join(e.home, 'config.env'))).toBe(false) // no reviewer config
  expect(existsSync(join(e.home, 'review-sweep.ts'))).toBe(false) // no reviewer engine
  rmSync(e.home, { recursive: true, force: true })
  rmSync(e.cfg, { recursive: true, force: true })
})

test('prime --install --pack assembles taste AND wires the hook in one step', () => {
  const e = env()
  run(['prime', '--install', '--pack', 'zod'], e)
  expect(readFileSync(join(e.home, '.review', 'CORPUS.md'), 'utf8')).toContain('zod') // taste assembled
  const s = read(e.settings)
  expect(s.hooks.SessionStart[0].hooks[0].command).toContain('prime.ts') // and hook wired
  rmSync(e.home, { recursive: true, force: true })
  rmSync(e.cfg, { recursive: true, force: true })
})
