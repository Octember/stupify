import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exeSetupScript, githubIntegrationFor, llmIntegrationFor, normalizeRepo, validHost, validRepo, vmNameFor } from '@stupify/exe-cli'
import { bumpDailyCounter, loadDailyCounter, loadHeadAttempts, loadReviewedHeads, parseEnvFile, recordHeadAttempt, recordReviewedHead } from '@stupify/exe-host'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'stupify-kit-'))
const clean = (dir: string): void => rmSync(dir, { recursive: true, force: true })

test('repo and host helpers keep shell-interpolated values tight', () => {
  expect(normalizeRepo('https://github.com/Octember/stupify.git/')).toBe('Octember/stupify')
  expect(normalizeRepo('git@github.com:Octember/stupify.git')).toBe('Octember/stupify')
  expect(validRepo('Octember/stupify')).toBe(true)
  expect(validRepo('Octember/stupify;curl bad')).toBe(false)
  expect(validHost('llm.int.exe.xyz')).toBe(true)
  expect(validHost('llm.int.exe.xyz && curl bad')).toBe(false)
  expect(vmNameFor('stupify', 'Octember/stupify')).toBe('stupify-octember-stupify')
})

test('exeSetupScript preserves the stable bun PATH bootstrap and appends codex host last', () => {
  expect(exeSetupScript('exec bunx @stupify/cli setup acme/widgets --yes', 'llm.int.exe.xyz')).toBe(
    [
      'export PATH="$HOME/.bun/bin:/usr/local/bin:$PATH"',
      'command -v bun >/dev/null 2>&1 || curl -fsSL https://bun.sh/install | bash',
      'export PATH="$HOME/.bun/bin:$PATH"',
      'exec bunx @stupify/cli setup acme/widgets --yes --codex-host llm.int.exe.xyz',
    ].join('\n'),
  )
})

test('exe.dev integration discovery ignores malformed optional config fields', () => {
  const runExe = (): { ok: boolean; out: string } => ({
    ok: true,
    out: JSON.stringify([
      { name: 'bad-mixed', type: 'github', config: { repositories: 123, providers: { openai: { enabled: true } } } },
      { name: 'bad-llm', type: 'llm', config: { providers: { openai: { enabled: 'yes' } } } },
      { name: 'repo-ok', type: 'github', config: { repositories: ['acme/widgets'] } },
      { name: 'llm-ok', type: 'llm', config: { providers: { openai: { enabled: true } } } },
    ]),
  })

  expect(githubIntegrationFor('acme/widgets', runExe)).toBe('repo-ok')
  expect(llmIntegrationFor(runExe)).toBe('llm-ok')
})

test('host env and state helpers parse defensively and persist compact JSON', () => {
  const dir = tmp()
  try {
    const env = join(dir, 'config.env')
    writeFileSync(env, ["REPO_SLUG='acme/widgets' # comment", 'DRY_RUN=true', 'BAD LINE'].join('\n'))
    expect(parseEnvFile(env)).toEqual({ REPO_SLUG: 'acme/widgets', DRY_RUN: 'true' })

    const failures = join(dir, 'failures.json')
    recordHeadAttempt(failures, {}, '7', 'abc', 123)
    expect(loadHeadAttempts(failures)).toEqual({ 7: { head: 'abc', at: 123 } })

    const reviewed = join(dir, 'reviewed.json')
    recordReviewedHead(reviewed, {}, '7', 'def')
    expect(loadReviewedHeads(reviewed)).toEqual({ 7: 'def' })

    const dailyPath = join(dir, 'daily.json')
    const today = loadDailyCounter(dailyPath, new Date('2026-06-21T12:00:00Z'))
    bumpDailyCounter(dailyPath, today)
    expect(JSON.parse(readFileSync(dailyPath, 'utf8'))).toEqual({ date: '2026-06-21', count: 1 })
  } finally {
    clean(dir)
  }
})

test('state helpers ignore malformed persisted JSON instead of throwing mid-sweep', () => {
  const dir = tmp()
  try {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'bad.json')
    writeFileSync(file, '{ nope')
    expect(loadHeadAttempts(file)).toEqual({})
    expect(loadReviewedHeads(file)).toEqual({})
    expect(loadDailyCounter(file, new Date('2026-06-21T12:00:00Z'))).toEqual({ date: '2026-06-21', count: 0 })
  } finally {
    clean(dir)
  }
})
