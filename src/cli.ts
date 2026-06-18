#!/usr/bin/env bun
/**
 * stupify — a code reviewer that talks like an idiot and catches real bugs.
 *
 * `stupify` (no args)  → the interactive setup wizard: checks your tools, finds your repo, asks for your
 *                        exe.dev integration, and installs the cron sweep. On exe.dev there are no creds to
 *                        manage (Codex → exe-llm gateway, gh → your GitHub integration).
 * `stupify run [--dry]` → run one review sweep right now.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cancel, confirm, intro, isCancel, log, note, outro, spinner, text } from '@clack/prompts'
import pc from 'picocolors'

const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const HOME = process.env.STUPIFY_HOME ?? join(homedir(), '.stupify')
const STATE = join(HOME, 'state')
const REQUIRED = ['bun', 'gh', 'codex', 'git', 'flock'] as const

function bail<T>(value: T | symbol): asserts value is T {
  if (isCancel(value)) {
    cancel('aborted.')
    process.exit(0)
  }
}

function which(bin: string): string | null {
  return Bun.which(bin)
}

function detectRepo(): string | null {
  const r = spawnSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8' })
  if (r.status !== 0) return null
  const slug = (r.stdout ?? '')
    .trim()
    .replace(/^[a-z]+:\/\/[^/]+\//, '')
    .replace(/^git@[^:]+:/, '')
    .replace(/\.git$/, '')
  return /^[^/]+\/[^/]+$/.test(slug) ? slug : null
}

function installCron(opts: { ghHost: string }): string {
  const bun = which('bun')!
  const flock = which('flock')!
  const prefix = opts.ghHost ? `GH_HOST=${opts.ghHost} ` : ''
  const line = `*/1 * * * * ${prefix}${flock} -n ${STATE}/sweep.lock ${bun} ${join(HOME, 'review-sweep.ts')} >> ${STATE}/cron.log 2>&1`
  const current = spawnSync('crontab', ['-l'], { encoding: 'utf8' }).stdout ?? ''
  const kept = current
    .split('\n')
    .filter((l) => l.trim() && !l.includes('review-sweep.ts'))
  const next = [...kept, line].join('\n') + '\n'
  const wrote = spawnSync('crontab', ['-'], { input: next })
  if (wrote.status !== 0) throw new Error('could not write crontab')
  return line
}

async function setup(argv: { repo?: string; host?: string; yes: boolean }): Promise<void> {
  console.clear()
  intro(pc.bgMagenta(pc.black(' stupify ')) + pc.dim(' — sounds dumb, reviews sharp'))

  // 1. tools
  const s = spinner()
  s.start('checking your tools')
  const missing = REQUIRED.filter((b) => !which(b))
  if (missing.length) {
    s.stop(pc.red(`missing: ${missing.join(', ')}`))
    note(
      `install them first:\n  bun    → ${pc.cyan('bun.sh')}\n  gh     → ${pc.cyan('cli.github.com')}\n  codex  → ${pc.cyan('github.com/openai/codex')}\n  flock  → Linux/util-linux`,
      'missing tools',
    )
    process.exit(1)
  }
  s.stop(pc.green('bun, gh, codex, git, flock') + pc.dim(' — all here'))

  // 2. repo (auto-detect, else ask)
  let repo = argv.repo ?? ''
  if (!repo) {
    const detected = detectRepo()
    if (detected) {
      if (argv.yes) {
        repo = detected
        log.success(`repo ${pc.bold(detected)} ${pc.dim('(from this checkout)')}`)
      } else {
        const keep = await confirm({ message: `Review ${pc.bold(detected)}? ${pc.dim('(detected from git remote)')}` })
        bail(keep)
        if (keep) repo = detected
      }
    }
  }
  if (!repo) {
    const answer = await text({
      message: 'GitHub repo to review',
      placeholder: 'owner/repo',
      validate: (v) => (/^[^/]+\/[^/]+$/.test((v ?? '').trim()) ? undefined : 'expected owner/repo'),
    })
    bail(answer)
    repo = answer.trim()
  }

  // 3. integration host (exe.dev) — can't be detected
  let host = argv.host ?? process.env.GH_HOST ?? ''
  if (!host && !argv.yes) {
    const answer = await text({
      message: 'exe.dev integration host',
      placeholder: 'your-integration.int.exe.xyz',
      defaultValue: '',
    })
    bail(answer)
    host = answer.trim()
  }

  // 4. plan + confirm
  note(
    [
      `${pc.dim('repo  ')} ${pc.bold(repo)}`,
      host
        ? `${pc.dim('auth  ')} exe.dev integration ${pc.bold(host)} ${pc.dim('— exe-llm gateway, no keys')}`
        : `${pc.dim('auth  ')} your own gh + codex ${pc.dim('(run `gh auth login` first)')}`,
      `${pc.dim('cadence')} every ~60s via cron`,
      `${pc.dim('home  ')} ${HOME}`,
    ].join('\n'),
    'plan',
  )
  if (!argv.yes) {
    const go = await confirm({ message: 'Set it up?' })
    bail(go)
    if (!go) {
      cancel('aborted.')
      process.exit(0)
    }
  }

  // 5. install
  const s2 = spinner()
  s2.start('installing')
  mkdirSync(STATE, { recursive: true })
  copyFileSync(join(PKG_DIR, 'review-sweep.ts'), join(HOME, 'review-sweep.ts'))
  const cfg = [`REPO_SLUG=${repo}`, host ? `GH_HOST=${host}` : '', '# tune anything else here — see the README']
    .filter(Boolean)
    .join('\n')
  writeFileSync(join(HOME, 'config.env'), cfg + '\n')
  installCron({ ghHost: host })
  s2.stop(pc.green('installed') + pc.dim(` → ${HOME}`))

  // 6. success + the two steps to a first review
  note(
    [
      `${pc.bold('1.')} give it your taste — add a ${pc.cyan('.review/')} dir to ${pc.bold(repo)}`,
      `   (copy this repo's ${pc.cyan('.review/')} and point ${pc.cyan('CORPUS.md')} at YOUR best files)`,
      `${pc.bold('2.')} label any open PR ${pc.cyan('codex-review')} ${pc.dim('(or add .github/workflows/autolabel.yml)')}`,
      ``,
      `${pc.dim('→ a review lands within ~60s. preview anytime:')} ${pc.cyan(`DRY_RUN=1 bun ${join(HOME, 'review-sweep.ts')}`)}`,
    ].join('\n'),
    'two steps to your first review',
  )
  outro(pc.green('stupify is watching ') + pc.bold(repo) + pc.green(' 👀'))
}

function run(dry: boolean): void {
  const sweep = join(HOME, 'review-sweep.ts')
  if (!Bun.file(sweep).size) {
    log.error(`not set up yet — run ${pc.cyan('stupify')} first`)
    process.exit(1)
  }
  const env = { ...process.env, ...(dry ? { DRY_RUN: '1' } : {}) }
  const r = spawnSync('bun', [sweep], { stdio: 'inherit', env })
  process.exit(r.status ?? 1)
}

function help(): void {
  console.log(`${pc.bold('stupify')} — a code reviewer that talks like an idiot and catches real bugs

${pc.dim('Usage')}
  stupify                 interactive setup wizard
  stupify <owner/repo>    set up for a repo (skips the repo prompt)
  stupify run [--dry]     run one review sweep now
  stupify --help

${pc.dim('Flags')}
  --host <h.int.exe.xyz>  exe.dev integration host (skips that prompt)
  --yes, -y               accept detected/blank defaults, no prompts (for CI)

${pc.dim('On exe.dev there are no credentials to set up.')} https://stupif.ai`)
}

const args = process.argv.slice(2)
if (args.includes('-h') || args.includes('--help')) {
  help()
} else if (args[0] === 'run') {
  run(args.includes('--dry'))
} else {
  const repo = args.find((a) => !a.startsWith('-') && a !== 'setup')
  const hostFlag = args.indexOf('--host')
  const host = hostFlag >= 0 ? args[hostFlag + 1] : undefined
  await setup({ repo, host, yes: args.includes('--yes') || args.includes('-y') })
}
