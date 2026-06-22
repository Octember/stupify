import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function stableBun(): string {
  const running = Bun.which('bun')
  if (running && !running.includes('/bun-node-') && !running.startsWith('/tmp/')) return running
  for (const c of [join(homedir(), '.bun/bin/bun'), '/opt/homebrew/bin/bun', '/home/linuxbrew/.linuxbrew/bin/bun', '/usr/local/bin/bun', '/usr/bin/bun']) {
    if (existsSync(c)) return c
  }
  return running ?? 'bun'
}

export function validRepo(repo: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(repo)
}

export function normalizeRepo(input: string): string {
  return input
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
}

export function validHost(host: string): boolean {
  return /^[\w.-]+$/.test(host)
}

export function detectRepo(cwd = process.cwd()): string | null {
  const r = spawnSync('git', ['config', '--get', 'remote.origin.url'], { cwd, encoding: 'utf8' })
  if (r.status !== 0) return null
  const slug = (r.stdout ?? '')
    .trim()
    .replace(/^[a-z]+:\/\/[^/]+\//, '')
    .replace(/^git@[^:]+:/, '')
    .replace(/\.git$/, '')
  return validRepo(slug) ? slug : null
}

export interface CronOptions {
  stateDir: string
  engineFile: string
  ghHost?: string
  cadence?: string
  removeMarker?: string
}

export function cronLine(opts: CronOptions): string {
  const prefix = opts.ghHost ? `GH_HOST=${opts.ghHost} ` : ''
  return `${opts.cadence ?? '*/1 * * * *'} ${prefix}${stableBun()} ${opts.engineFile} >> ${opts.stateDir}/cron.log 2>&1`
}

export function installCron(opts: CronOptions): string {
  mkdirSync(opts.stateDir, { recursive: true })
  const line = cronLine(opts)
  const current = spawnSync('crontab', ['-l'], { encoding: 'utf8', timeout: 8_000 }).stdout ?? ''
  const removeMarker = opts.removeMarker ?? opts.engineFile
  const kept = current
    .split('\n')
    .filter((l) => l.trim() && !l.includes(removeMarker))
  const next = [...kept, line].join('\n') + '\n'
  const wrote = spawnSync('crontab', ['-'], { input: next, encoding: 'utf8', timeout: 8_000 })
  if (wrote.status !== 0) {
    const why = (wrote.stderr ?? '').trim() || wrote.error?.message || (wrote.signal ? `timed out (${wrote.signal})` : 'crontab exited non-zero')
    throw new Error(`couldn't install the cron job (${why}). your config is saved. add the line yourself:\n  ${line}`)
  }
  return line
}

export interface ExeResult {
  ok: boolean
  out: string
}

export function exe(args: string[], input = ''): ExeResult {
  const r = spawnSync('ssh', ['-o', 'ConnectTimeout=25', 'exe.dev', ...args], {
    input,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 180_000,
  })
  return { ok: r.status === 0, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

export const vmNameFor = (agentName: string, repo: string): string =>
  `${agentName}-` + repo.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

interface ExeIntegration {
  name: string
  type: string
  config?: {
    repositories?: string[]
    providers?: {
      openai?: {
        enabled?: boolean
      }
    }
  }
}

function isObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
}

function stringArray(raw: unknown): string[] | undefined {
  return Array.isArray(raw) && raw.every((v) => typeof v === 'string') ? raw : undefined
}

function isExeIntegration(raw: unknown): raw is ExeIntegration {
  if (!isObject(raw) || typeof raw.name !== 'string' || typeof raw.type !== 'string') return false
  if (raw.config === undefined) return true
  if (!isObject(raw.config)) return false
  if (raw.config.repositories !== undefined && stringArray(raw.config.repositories) === undefined) return false
  if (raw.config.providers === undefined) return true
  if (!isObject(raw.config.providers)) return false
  if (raw.config.providers.openai === undefined) return true
  if (!isObject(raw.config.providers.openai)) return false
  const enabled = raw.config.providers.openai.enabled
  return enabled === undefined || typeof enabled === 'boolean'
}

function parseExeIntegrations(json: string): ExeIntegration[] {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return []
  }
  return Array.isArray(raw) ? raw.filter(isExeIntegration) : []
}

export function githubIntegrationFor(repo: string, runExe: (args: string[]) => ExeResult = exe): string | null {
  const r = runExe(['int', 'list', '--json'])
  if (!r.ok) return null
  return parseExeIntegrations(r.out).find((i) => i.type === 'github' && (i.config?.repositories ?? []).includes(repo))?.name ?? null
}

export function llmIntegrationFor(runExe: (args: string[]) => ExeResult = exe): string | null {
  const r = runExe(['int', 'list', '--json'])
  if (!r.ok) return null
  return parseExeIntegrations(r.out).find((i) => i.type === 'llm' && i.config?.providers?.openai?.enabled === true)?.name ?? null
}

export interface CodexGatewayOptions {
  home: string
  gatewayHost?: string
  codexHome?: string
}

export function writeCodexGatewayConfig(opts: CodexGatewayOptions): void {
  const dir = opts.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')
  const file = join(dir, 'config.toml')
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (existing.includes('model_provider')) return
  mkdirSync(dir, { recursive: true })
  const gatewayHost = opts.gatewayHost ?? 'llm.int.exe.xyz'
  const block = `model_provider = "exe-llm"

[model_providers.exe-llm]
name = "exe-llm"
base_url = "https://${gatewayHost}/v1"
requires_openai_auth = false

[projects."${join(opts.home, 'repo')}"]
trust_level = "trusted"
`
  writeFileSync(file, existing ? `${block}\n${existing}` : block)
}

export function exeSetupScript(command: string, codexHost?: string): string {
  return [
    'export PATH="$HOME/.bun/bin:/usr/local/bin:$PATH"',
    'command -v bun >/dev/null 2>&1 || curl -fsSL https://bun.sh/install | bash',
    'export PATH="$HOME/.bun/bin:$PATH"',
    codexHost ? `${command} --codex-host ${codexHost}` : command,
  ].join('\n')
}
