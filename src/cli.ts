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
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cancel, confirm, intro, isCancel, log, multiselect, note, outro, spinner, text } from '@clack/prompts'
import {
  detectRepo,
  exe,
  exeSetupScript,
  githubIntegrationFor,
  installCron,
  llmIntegrationFor,
  normalizeRepo,
  stableBun,
  validHost,
  validRepo,
  vmNameFor as packageVmNameFor,
  writeCodexGatewayConfig,
} from '@stupify/exe-cli'
import pc from 'picocolors'

const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(PKG_DIR, '..') // the published package root: holds .review/ and packs/
const VERSION = (JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')) as { version: string }).version
const HOME = process.env.STUPIFY_HOME ?? join(homedir(), '.stupify')
const STATE = join(HOME, 'state')
const REQUIRED = ['bun', 'gh', 'codex', 'git'] as const
const vmNameFor = (repo: string): string => packageVmNameFor('stupify', repo)

// Taste packs: "code like X". Picking one (or several) seeds the corpus, so you don't start from a blank file.
interface Pack {
  id: string
  label: string
}
const PACKS: Pack[] = [
  { id: 'sindre-sorhus', label: 'Sindre Sorhus · one file, one job' },
  { id: 'zod', label: 'Colin McDonnell / Zod · parse, don’t validate' },
  { id: 'rich-harris', label: 'Rich Harris / Svelte · compiler-grade precision' },
  { id: 'tanner-linsley', label: 'Tanner Linsley / TanStack · types forbid bad states' },
  { id: 'simon-willison', label: 'Simon Willison · one concept per file' },
  { id: 'dtolnay', label: 'David Tolnay · the API that disappears (Rust)' },
  { id: 'antirez', label: 'antirez / Redis · comments that earn their keep (C)' },
  { id: 'dhh', label: 'DHH / Rails · controllers that tell the story (Ruby)' },
  { id: 'mitchell-hashimoto', label: 'Mitchell Hashimoto / Ghostty · documented tradeoffs' },
  { id: 'devshorts', label: 'devshorts · DI + branded types' },
  { id: 'jarred-sumner', label: 'Jarred Sumner / Bun · perf as correctness' },
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

async function installSweepEngine(dest = join(HOME, 'review-sweep.ts')): Promise<void> {
  const built = await Bun.build({
    entrypoints: [join(PKG_DIR, 'review-sweep.ts')],
    target: 'bun',
    format: 'esm',
  })
  if (!built.success) {
    const details = built.logs.map((l) => l.message).join('\n').trim()
    throw new Error(details || 'could not bundle review-sweep.ts')
  }
  const [artifact] = built.outputs
  if (artifact === undefined) throw new Error('could not bundle review-sweep.ts (no output)')
  mkdirSync(dirname(dest), { recursive: true })
  await Bun.write(dest, artifact)
}

// clack's spinner reads stdin and keeps the event loop alive in non-TTY contexts (CI, pipes, scripts) — the
// process never exits. Fall back to plain step logs there so non-interactive runs actually finish.
function progress(start: string): { stop: (msg: string) => void } {
  if (!process.stdin.isTTY) {
    log.step(start)
    return { stop: (msg: string) => log.success(msg) }
  }
  const s = spinner()
  s.start(start)
  return { stop: (msg: string) => s.stop(msg) }
}

// The short human label for a set of picked packs, e.g. "Sindre Sorhus + devshorts" — for plan/success notes.
const tasteLabel = (packs: string[]): string =>
  PACKS.filter((p) => packs.includes(p.id)).map((p) => p.label.split(' · ')[0]).join(' + ')

// Returns the chosen pack ids. `--pack a,b` (or 'own'/'' = your own codebase) skips the prompt; with --yes and
// no flag it defaults to sindre-sorhus (the broadly-applicable TS/JS taste) so a fresh repo reviews immediately.
async function pickPacks(opts: { yes: boolean; packArg?: string }): Promise<string[]> {
  if (opts.packArg !== undefined) {
    const requested = opts.packArg.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    const known = (id: string) => PACKS.some((p) => p.id === id)
    const unknown = requested.filter((id) => id !== 'own' && !known(id))
    if (unknown.length) log.warn(`unknown pack(s): ${pc.bold(unknown.join(', '))}, valid: ${PACKS.map((p) => p.id).join(', ')}`)
    return requested.filter((id) => id !== 'own' && known(id))
  }
  if (opts.yes) return ['sindre-sorhus']
  if (!process.stdin.isTTY) return [] // non-interactive (CI, scripts, the install hook): never block on a picker
  const choice = await multiselect({
    message: 'Whose code should yours look like? (pick any, or your own)',
    options: [
      ...PACKS.map((p) => ({ value: p.id, label: p.label })),
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
  if (packs.length === 0) return // no packs → no global corpus; reviewer/prime honestly no-op until you add taste
  // (the bring-your-own template is scaffolded into a repo by `stupify init`, never written as a usable global corpus)
  const header = `# Good-code reference — taste packs\n\nJudge every diff against the standards below. When you flag slop, name the principle (or the linked file) the change should have followed. Each entry inlines real code from the named programmer, with a commit-pinned source link.\n\n---\n\n`
  const body = packs.map((id) => readFileSync(join(PKG_ROOT, 'packs', `${id}.md`), 'utf8').trim()).join('\n\n---\n\n')
  writeFileSync(join(out, 'CORPUS.md'), `${header}${body}\n`)
}

// `stupify taste [--pack a,b]` — assemble your GLOBAL taste at ~/.stupify/.review from packs, and nothing else.
// This is the shared core both the reviewer and `stupify prime` read when a repo has no .review/ of its own —
// so you can set taste once without installing the cron reviewer.
async function taste(argv: { pack?: string; yes: boolean }): Promise<void> {
  console.clear()
  intro(pc.bgMagenta(pc.black(' stupify ')) + pc.dim(' · pick the code yours should look like'))
  const packs = await pickPacks({ yes: argv.yes, packArg: argv.pack })
  if (packs.length === 0) {
    note(
      [
        `no packs picked. taste packs seed a global corpus at ${pc.cyan(join(HOME, '.review'))}.`,
        `want YOUR OWN code as the standard? ${pc.cyan('stupify init <your-best-files>')} scaffolds a ${pc.cyan('.review/')} in your repo ${pc.dim('(it always wins over a pack)')}.`,
      ].join('\n'),
      'nothing to assemble',
    )
    outro(pc.dim('pass --pack <id> for a pack, or `stupify init` for your own taste.'))
    return
  }
  assembleReview(packs)
  const tasteLine = tasteLabel(packs)
  note(
    [
      `assembled ${pc.cyan(join(HOME, '.review'))} against ${pc.bold(tasteLine)}.`,
      `your global taste, read by the reviewer AND ${pc.cyan('stupify prime')} in any repo without its own .review/.`,
      ``,
      `${pc.bold('next:')} ${pc.cyan('stupify prime --install')} ${pc.dim('· prime Claude Code with it every session')}`,
    ].join('\n'),
    'taste ready',
  )
  outro(pc.green('your taste is set 🎯'))
}

// Fence language tag from a file extension — best-effort, blank when unknown (still renders fine).
const LANG: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js', py: 'python', rb: 'ruby', go: 'go',
  rs: 'rust', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cs: 'csharp', zig: 'zig',
  swift: 'swift', php: 'php', ex: 'elixir', exs: 'elixir', scala: 'scala', sh: 'bash', sql: 'sql',
}
const langOf = (p: string): string => LANG[p.split('.').pop()?.toLowerCase() ?? ''] ?? ''

// The repo root (where the reviewer's checkout keeps .review/), so `init` from a subdir still lands at the top.
function repoRoot(): { root: string; inGit: boolean } {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  const root = r.status === 0 ? (r.stdout ?? '').trim() : ''
  return root ? { root, inGit: true } : { root: process.cwd(), inGit: false }
}

const CORPUS_CAP = 150 // lines: a single exemplar past this gets truncated (a corpus is shapes, not whole files)

// `stupify init [files…]` — scaffold a BYO `.review/` in THIS repo from your own best files (no famous-coder
// pack). Writes the rubric + review spec (defaults, kept if already present) and builds CORPUS.md by inlining
// each file you name with a one-line "why" for you to fill — the only hand-work, and the irreducible taste part.
const WHY_PLACEHOLDER = '⟨why is this good? one line, e.g. "fail-fast at the boundary"⟩'

async function init(argv: { files: string[]; force: boolean }): Promise<void> {
  // validate paths FIRST — before any UI or writes — so a bad path fails clean (no open frame, no partial .review/)
  const missing = argv.files.filter((f) => !existsSync(f))
  if (missing.length) die(`file(s) not found: ${missing.join(', ')} (paths are relative to your current directory)`)

  console.clear()
  intro(pc.bgMagenta(pc.black(' stupify ')) + pc.dim(' · encode your own taste (.review/ in this repo)'))
  const { root, inGit } = repoRoot()
  const dir = join(root, '.review')
  mkdirSync(dir, { recursive: true })

  // rubric + review spec: defaults, written only if missing so we never clobber edits
  for (const f of ['RUBRIC.md', 'REVIEW-PROMPT.md']) {
    if (!existsSync(join(dir, f))) copyFileSync(join(PKG_ROOT, '.review', f), join(dir, f))
  }

  const corpusPath = join(dir, 'CORPUS.md')
  const corpusExists = existsSync(corpusPath)
  if (corpusExists && !argv.force) {
    note(
      argv.files.length
        ? `${pc.cyan(corpusPath)} already exists. ${pc.cyan('--force')} rebuilds it from ${pc.bold(argv.files.join(', '))} ${pc.dim('· your filled-in “why” lines are kept')}.`
        : `${pc.cyan(corpusPath)} already exists. name files + ${pc.cyan('--force')} to rebuild it, or edit it by hand.`,
      'corpus exists',
    )
    outro(pc.dim('nothing overwritten.'))
    return
  }

  if (argv.files.length === 0) {
    copyFileSync(join(PKG_ROOT, '.review', 'CORPUS.template.md'), corpusPath)
    note(
      [
        `scaffolded ${pc.cyan(`${dir}/`)} ${pc.dim('(RUBRIC + REVIEW-PROMPT + a CORPUS template)')}.`,
        `fill it from your best files: ${pc.cyan('stupify init path/to/your-best.ts another.ts')}`,
        `…or edit ${pc.cyan('CORPUS.md')} by hand.`,
      ].join('\n'),
      'next',
    )
    outro(pc.green('your .review/ is ready 🎯'))
    return
  }

  // preserve any "why" lines already filled in, so --force / adding a file never erases the taste work
  const priorWhy = new Map<string, string>()
  if (corpusExists) {
    for (const m of readFileSync(corpusPath, 'utf8').matchAll(/^### `([^`]+)` — (.+)$/gm)) {
      const [, path, why] = m
      if (path && why && !why.startsWith('⟨')) priorWhy.set(path, why)
    }
  }

  const truncated: string[] = []
  const outside: string[] = []
  const picked = argv.files.map((f) => {
    const rel = relative(root, resolve(f)) || f // repo-root-relative, so the path is correct + portable
    if (rel.startsWith('..')) outside.push(rel)
    const content = readFileSync(f, 'utf8').replace(/\n+$/, '')
    const total = content.split('\n').length
    if (total > CORPUS_CAP) truncated.push(rel)
    const body = total > CORPUS_CAP ? content.split('\n').slice(0, CORPUS_CAP).join('\n') : content
    const tail = total > CORPUS_CAP ? `\n\n_(first ${CORPUS_CAP} of ${total} lines — trim to the part that matters)_` : ''
    return `### \`${rel}\` — ${priorWhy.get(rel) ?? WHY_PLACEHOLDER}\n\`\`\`${langOf(f)}\n${body}\n\`\`\`${tail}`
  })
  // a path outside the repo would commit a non-portable ../ reference — reject it rather than write a broken corpus
  if (outside.length) die(`outside the repo root (${root}): ${outside.join(', ')}. name files inside the repo`)
  const header = `# Good-code reference — your corpus\n\nHand-picked from this repo: the code you wish all your code looked like. Replace each ⟨why⟩ with one line on what makes that file the standard — that one line is the taste the reviewer and prime hold every diff to.\n\n---\n\n`
  writeFileSync(corpusPath, `${header}${picked.join('\n\n')}\n`)

  note(
    [
      `built ${pc.cyan(corpusPath)} from ${pc.bold(String(argv.files.length))} file(s)${priorWhy.size ? pc.dim(` (kept ${priorWhy.size} of your “why” lines)`) : ''}.`,
      truncated.length ? pc.yellow(`truncated to ${CORPUS_CAP} lines: ${truncated.join(', ')}, a tighter exemplar reads better`) : '',
      ``,
      `${pc.bold('1.')} edit the ${pc.cyan('⟨why⟩')} line on each block ${pc.dim('(that one line is your taste)')}`,
      inGit ? `${pc.bold('2.')} commit ${pc.cyan('.review/')} ${pc.dim('· version it with your code')}` : '',
      `${pc.bold(inGit ? '3.' : '2.')} ${pc.cyan('stupify prime --install')} ${pc.dim('· prime your agent against it')}`,
    ]
      .filter(Boolean)
      .join('\n'),
    'your taste is scaffolded',
  )
  outro(pc.green("fill in the whys and you're set 🎯"))
}

async function setup(argv: { repo?: string; host?: string; codexHost?: string; yes: boolean; pack?: string }): Promise<void> {
  console.clear()
  intro(pc.bgMagenta(pc.black(' stupify ')) + pc.dim(' · sounds dumb, reviews sharp'))

  // 1. tools
  const s = progress('checking your tools')
  const missing = REQUIRED.filter((b) => !Bun.which(b))
  if (missing.length) {
    s.stop(pc.red(`missing: ${missing.join(', ')}`))
    note(
      `install them first:\n  bun    → ${pc.cyan('bun.sh')}\n  gh     → ${pc.cyan('cli.github.com')}\n  codex  → ${pc.cyan('github.com/openai/codex')}`,
      'missing tools',
    )
    process.exit(1)
  }
  s.stop(pc.green('bun, gh, codex, git') + pc.dim(' · all here'))

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
    if (argv.yes) die('--yes needs a repo when none is detected: stupify setup <owner/repo> --yes')
    const answer = await text({
      message: 'GitHub repo to review',
      placeholder: 'owner/repo',
      validate: (v) => (validRepo(normalizeRepo(v ?? '')) ? undefined : 'expected owner/repo (e.g. acme/widgets)'),
    })
    bail(answer)
    repo = answer
  }
  repo = normalizeRepo(repo)
  if (!validRepo(repo)) die(`'${repo}' is not a valid owner/repo, expected owner/repo (e.g. acme/widgets)`)

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
  if (host && !validHost(host)) die(`'${host}' is not a valid host, hostname characters only (e.g. acme.int.exe.xyz)`)
  if (argv.codexHost && !validHost(argv.codexHost)) die(`'${argv.codexHost}' is not a valid Codex gateway host, hostname characters only`)

  // 3.5 taste — pick a pack (or your own code)
  const packs = await pickPacks({ yes: argv.yes, packArg: argv.pack })
  const tasteLine = packs.length
    ? tasteLabel(packs)
    : 'your own codebase'

  // 4. plan + confirm
  note(
    [
      `${pc.dim('repo  ')} ${pc.bold(repo)}`,
      `${pc.dim('taste ')} ${pc.bold(tasteLine)}`,
      host
        ? `${pc.dim('auth  ')} exe.dev integration ${pc.bold(host)} ${pc.dim('· exe-llm gateway, no keys')}`
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
  const s2 = progress('installing')
  mkdirSync(STATE, { recursive: true })
  await installSweepEngine()
  assembleReview(packs)
  const cfg = [`REPO_SLUG=${repo}`, host ? `GH_HOST=${host}` : '', '# tune anything else here, see the README']
    .filter(Boolean)
    .join('\n')
  writeFileSync(join(HOME, 'config.env'), cfg + '\n')
  if (host) writeCodexGatewayConfig({ home: HOME, gatewayHost: argv.codexHost }) // exe.dev VM: route Codex through the no-key exe-llm gateway
  try {
    installCron({ stateDir: STATE, engineFile: join(HOME, 'review-sweep.ts'), ghHost: host, removeMarker: 'review-sweep.ts' })
  } catch (e) {
    s2.stop(pc.yellow('files installed, but the cron job failed'))
    die((e as Error).message) // friendly: includes the reason + the exact line to add by hand
  }
  s2.stop(pc.green('installed') + pc.dim(` → ${HOME}`))

  // 6. success
  const preview = `${pc.dim('preview anytime:')} ${pc.cyan(`DRY_RUN=1 bun ${join(HOME, 'review-sweep.ts')}`)}`
  if (packs.length) {
    note(
      [
        `reviewing ${pc.bold(repo)} against ${pc.bold(tasteLine)}.`,
        `open a PR (or push to one) → stupify reviews it in ~60s. ${pc.dim('no labels, no setup.')}`,
        ``,
        `want your OWN taste instead? add a ${pc.cyan('.review/')} to ${pc.bold(repo)}, it overrides the pack.`,
        preview,
      ].join('\n'),
      "you're set",
    )
  } else {
    note(
      [
        `${pc.bold('1.')} add a ${pc.cyan('.review/')} to ${pc.bold(repo)} and point ${pc.cyan('CORPUS.md')} at YOUR best files`,
        `${pc.bold('2.')} open a PR → stupify reviews it in ~60s ${pc.dim('(no labels needed)')}`,
        ``,
        preview,
      ].join('\n'),
      'two steps to your first review',
    )
  }
  outro(pc.green('stupify is watching ') + pc.bold(repo) + pc.green(' 👀'))
}

// --- prime: wire `stupify prime` into Claude Code as a SessionStart hook (self-contained, install ⇄ uninstall) ---
// The hook EMITTER lives in the dependency-free ./prime module (also copied to ~/.stupify/prime.ts on install,
// so the hook runs with no global install / node_modules). Everything below only manages the wiring.

const PRIME_ENGINE = join(HOME, 'prime.ts') // the dep-free copy the hook actually runs; also our marker in settings.json

/** Claude Code's user settings file. CLAUDE_CONFIG_DIR overrides ~/.claude (and makes this testable). */
const claudeSettingsPath = (): string => join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'settings.json')

/** Codex's user hooks file. Same JSON shape as Claude's settings.json (hooks.SessionStart[]). CODEX_HOME
 *  overrides ~/.codex. We use hooks.json (not config.toml) so we never touch the user's main Codex config. */
const codexHooksPath = (): string => join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'hooks.json')

/** Read settings.json (or {} if absent). Throws on malformed JSON so callers refuse to clobber a broken file. */
function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

type HookEntry = { matcher?: string; hooks?: { type?: string; command?: string }[] }
const isOurHook = (e: HookEntry): boolean => (e.hooks ?? []).some((h) => (h.command ?? '').includes(PRIME_ENGINE))

// Every agent stupify primes reads a SessionStart command hook in the SAME JSON shape
// ({ hooks: { SessionStart: [{ matcher, hooks: [{ type:'command', command }] }] } }) and the SAME prime.ts
// payload ({ hookSpecificOutput: { hookEventName:'SessionStart', additionalContext } }). So adding an agent is
// just another target here — the merge/emit logic is shared.
type PrimeTarget = {
  id: string
  label: string
  file: () => string
  matcher: string
  installed: () => boolean
  trust?: string // post-install step unique to this agent (Codex makes you trust a hook before it runs)
}
const PRIME_TARGETS: PrimeTarget[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    file: claudeSettingsPath,
    matcher: 'startup',
    installed: () => Bun.which('claude') !== null || existsSync(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')),
  },
  {
    id: 'codex',
    label: 'Codex',
    file: codexHooksPath,
    matcher: 'startup|resume',
    installed: () => Bun.which('codex') !== null || existsSync(process.env.CODEX_HOME ?? join(homedir(), '.codex')),
    trust: `run ${pc.cyan('/hooks')} in Codex once to trust it. Codex won't run an untrusted hook`,
  },
]

/** Which agents to prime: an explicit --agent list, else every one we detect installed (fall back to Claude Code
 *  so `prime --install` on a bare machine still wires something). */
function selectTargets(agentArg?: string): PrimeTarget[] {
  if (agentArg !== undefined) {
    const ids = agentArg.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
    const unknown = ids.filter((id) => !PRIME_TARGETS.some((t) => t.id === id))
    if (unknown.length) die(`unknown --agent: ${unknown.join(', ')} (known: ${PRIME_TARGETS.map((t) => t.id).join(', ')})`)
    return PRIME_TARGETS.filter((t) => ids.includes(t.id))
  }
  const detected = PRIME_TARGETS.filter((t) => t.installed())
  return detected.length > 0 ? detected : PRIME_TARGETS.slice(0, 1) // fall back to Claude Code
}

/** Merge our SessionStart command hook into one agent's hooks file. Never clobbers the user's other hooks or
 *  settings; refreshes our command if already present (the resolved bun path can move); never duplicates. */
function mergeHook(file: string, matcher: string, command: string): { already: boolean } {
  let settings: Record<string, unknown>
  try {
    settings = readSettings(file)
  } catch {
    die(`couldn't parse ${file}, fix or remove it, then retry (left it untouched)`)
  }
  const hooks = (settings.hooks ??= {}) as Record<string, HookEntry[]>
  const sessionStart = (hooks.SessionStart ??= [])
  const existing = sessionStart.find(isOurHook)
  if (existing) existing.hooks = [{ type: 'command', command }]
  else sessionStart.push({ matcher, hooks: [{ type: 'command', command }] })
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`)
  return { already: existing !== undefined }
}

/** Remove our SessionStart hook from one agent's hooks file, leaving the user's other hooks + settings intact. */
function removeHook(file: string): { removed: boolean } {
  if (!existsSync(file)) return { removed: false }
  let settings: Record<string, unknown>
  try {
    settings = readSettings(file)
  } catch {
    die(`couldn't parse ${file}, fix or remove it, then retry (left it untouched)`)
  }
  const hooks = settings.hooks as Record<string, HookEntry[]> | undefined
  if (!hooks?.SessionStart) return { removed: false }
  const kept = hooks.SessionStart.filter((e) => !isOurHook(e))
  const removed = kept.length !== hooks.SessionStart.length
  if (kept.length > 0) hooks.SessionStart = kept
  else delete hooks.SessionStart
  if (Object.keys(hooks).length === 0) delete settings.hooks
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`)
  return { removed }
}

async function installPrimeHook(argv: { pack?: string; agent?: string }): Promise<void> {
  console.clear()
  const targets = selectTargets(argv.agent)
  intro(pc.bgMagenta(pc.black(' stupify ')) + pc.dim(` · prime ${targets.map((t) => t.label).join(' + ')} with your taste`))

  // 0. ensure GLOBAL taste exists for the hook to inject. The hook runs in EVERY repo; a repo's own .review/
  //    wins, but ~/.stupify/.review is the fallback, so without it the hook would no-op everywhere. Assemble it
  //    here (explicit --pack always (re)assembles; otherwise pick only when none exists) so install just works.
  const hasTaste = (d: string) => existsSync(join(d, 'RUBRIC.md')) && existsSync(join(d, 'CORPUS.md'))
  const haveHomeTaste = hasTaste(join(HOME, '.review'))
  const haveRepoTaste = hasTaste(join(repoRoot().root, '.review')) // a BYO .review/ in the repo you're standing in
  let primed = haveHomeTaste || haveRepoTaste
  if (argv.pack !== undefined || !primed) {
    const packs = await pickPacks({ yes: false, packArg: argv.pack })
    if (packs.length > 0) {
      assembleReview(packs)
      primed = true
      const tasteLine = tasteLabel(packs)
      log.success(`global taste assembled → ${pc.cyan(join(HOME, '.review'))} ${pc.dim(`(${tasteLine})`)}`)
    } else if (!primed) {
      log.warn(`no taste yet. the hook will no-op until this repo has a ${pc.cyan('.review/')} (${pc.cyan('stupify init')}) or you run ${pc.cyan('stupify taste')}`)
    }
  }

  // 1. drop the dep-free emitter where the hook can run it fast, no global install needed
  mkdirSync(HOME, { recursive: true })
  copyFileSync(join(PKG_DIR, 'prime.ts'), PRIME_ENGINE)
  const command = `${stableBun()} ${PRIME_ENGINE}`

  // 2. wire the SessionStart hook into each target. The command carries the resolved bun path (which can move —
  //    a new bun install, a Homebrew relocation), so mergeHook refreshes it on re-install instead of going stale.
  const wired = targets.map((t) => ({ t, already: mergeHook(t.file(), t.matcher, command).already }))

  note(
    [
      ...wired.map(
        ({ t, already }) =>
          `${already ? pc.dim('refreshed') : pc.green('wired   ')} ${pc.bold(t.label)} ${pc.dim('→ ' + t.file())}` +
          (t.trust ? `\n          ${pc.yellow('↳ ' + t.trust)}` : ''),
      ),
      ``,
      primed
        ? `every new session now opens primed with your taste ${pc.dim('(~30ms, pure file read)')}.`
        : `wired but ${pc.bold('dormant')}. it activates in any repo with a ${pc.cyan('.review/')}, or run ${pc.cyan('stupify taste --pack <id>')} to set a global one.`,
      ``,
      `${pc.dim('undo:')} ${pc.cyan('stupify prime --uninstall')}`,
    ].join('\n'),
    primed ? "you're primed" : 'hooks wired (no taste yet)',
  )
  outro(primed ? pc.green('your agents will write to your taste from the first line 🧠') : pc.yellow('add taste to bring it to life ↑'))
}

function uninstallPrimeHook(): void {
  console.clear()
  intro(pc.bgMagenta(pc.black(' stupify ')) + pc.dim(' · remove the prime hooks'))
  // Sweep every known target, not just the ones currently installed — so an uninstall after the agent is gone
  // (or after switching machines) still cleans up any hook we left behind.
  const removedFrom = PRIME_TARGETS.filter((t) => removeHook(t.file()).removed).map((t) => t.label)
  rmSync(PRIME_ENGINE, { force: true }) // drop the copied engine too

  note(
    removedFrom.length
      ? `removed the stupify SessionStart hook from ${pc.bold(removedFrom.join(' + '))}. your other hooks + settings are untouched.`
      : `no stupify prime hook found ${pc.dim('(nothing to remove)')}.`,
    'done',
  )
  outro(pc.green('unprimed.'))
}

function run(dry: boolean): void {
  const sweep = join(HOME, 'review-sweep.ts')
  if (!existsSync(sweep)) {
    log.error(`not set up yet. run ${pc.cyan('stupify setup')} to install on this machine, or ${pc.cyan('stupify')} to provision an exe.dev VM`)
    process.exit(1)
  }
  const env = { ...process.env, ...(dry ? { DRY_RUN: '1' } : {}) }
  const r = spawnSync(stableBun(), [sweep], { stdio: 'inherit', env }) // same bun the cron uses, not ambient PATH
  process.exit(r.status ?? 1)
}

// `stupify review <pr-url | owner/repo#123 | #123>` — review ONE PR on demand via the bundled engine (no `setup`
// needed, just taste). Prints the review to stdout; `--post` comments it on the PR. A bare `#123` resolves against
// the repo you're standing in.
function cmdReview(ref: string | undefined, post: boolean): void {
  if (!ref) die('usage: stupify review <pr-url | owner/repo#123 | #123> [--post]')
  let target = ref
  if (/^#?\d+$/.test(ref)) {
    const repo = detectRepo()
    if (!repo) die(`'${ref}' is just a number — run this inside the target repo, or pass owner/repo#${ref.replace(/^#/, '')}`)
    target = `${repo}#${ref.replace(/^#/, '')}`
  }
  const engine = join(PKG_DIR, 'review-sweep.ts') // the bundled engine, run directly — review needs no install
  // STUPIFY_HOME points the engine at ~/.stupify (assembled home taste + logs), not the package's own src/ dir.
  const env = { ...process.env, STUPIFY_HOME: HOME, REVIEW_PR: target, ...(post ? { REVIEW_POST: '1' } : {}) }
  const r = spawnSync(stableBun(), [engine], { stdio: 'inherit', env })
  process.exit(r.status ?? 1)
}

// --- provision: spin up an exe.dev VM that runs stupify, from your laptop ---

async function provision(argv: { repo?: string; yes: boolean; pack?: string }): Promise<void> {
  console.clear()
  intro(pc.bgMagenta(pc.black(' stupify ')) + pc.dim(' · provision a reviewer on exe.dev'))

  // 1. onboarded to exe.dev?
  const s = progress('checking exe.dev')
  const who = exe(['whoami'])
  if (!who.ok) {
    s.stop(pc.red('not connected to exe.dev'))
    note(`onboarding is one step. run this once, then re-run stupify:\n\n  ${pc.cyan('ssh exe.dev')}`, 'connect exe.dev')
    process.exit(1)
  }
  s.stop(pc.green('exe.dev ready') + pc.dim(` · ${(who.out.match(/[\w.+-]+@[\w.-]+/) ?? [''])[0]}`))

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
    if (argv.yes) die('--yes needs a repo when none is detected: stupify <owner/repo> --yes')
    const answer = await text({
      message: 'GitHub repo to review',
      placeholder: 'owner/repo',
      validate: (v) => (validRepo(normalizeRepo(v ?? '')) ? undefined : 'expected owner/repo (e.g. acme/widgets)'),
    })
    bail(answer)
    repo = answer
  }
  repo = normalizeRepo(repo)
  if (!validRepo(repo)) die(`'${repo}' is not a valid owner/repo, expected owner/repo (e.g. acme/widgets)`)

  // 2.5 taste — pick a pack (or your own code); the VM installs it on first boot
  const packs = await pickPacks({ yes: argv.yes, packArg: argv.pack })

  // 3. GitHub integration — reuse an existing one, else create it (needs your GitHub linked once, on the web)
  const s2 = progress('finding your GitHub integration')
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
  // The integration name comes back from the exe.dev API and gets baked into the VM's first-boot setup SCRIPT
  // (which runs in a shell) and into the host. Refuse anything with shell metacharacters before interpolating it.
  if (!integration || !validHost(integration)) {
    die(`exe.dev returned an unexpected integration name${integration ? ` (${integration})` : ''}. refusing to build a setup script with it`)
  }
  const host = `${integration}.int.exe.xyz`
  // Codex on the VM runs on the no-key exe-llm gateway, fronted by the `llm` integration (auto-installed for most
  // exe.dev users). We point Codex at it in setup and attach it to the VM below; without it every review 401s.
  const llm = llmIntegrationFor()
  if (llm && !validHost(llm)) die(`exe.dev returned an unexpected exe-llm integration name (${llm}). refusing to use it`)
  const tasteLine = packs.length
    ? tasteLabel(packs)
    : 'your own codebase'

  // 4. plan + confirm
  note(
    [
      `${pc.dim('repo ')}  ${pc.bold(repo)}`,
      `${pc.dim('taste')}  ${pc.bold(tasteLine)}`,
      `${pc.dim('vm   ')}  a small always-on exe.dev VM on your account`,
      `${pc.dim('auth ')}  integration ${pc.bold(integration)} ${pc.dim('· no keys, no tokens')}`,
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
  const s3 = progress('provisioning VM + installing stupify')
  const vm = vmNameFor(repo)
  const setupCommand = `exec bunx @stupify/cli@${VERSION} setup ${repo} --host ${host} --pack ${packs.join(',') || 'own'} --yes`
  const script = exeSetupScript(setupCommand, llm ? `${llm}.int.exe.xyz` : undefined)
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

  // 5.5 attach the exe-llm gateway so Codex can review (creating with --integration <github> drops the auto:all llm)
  if (llm) {
    exe(['integrations', 'attach', llm, `vm:${vm}`])
  } else {
    note(
      [
        `Codex reviews need the exe-llm gateway and I couldn't find it on your account.`,
        `link your ChatGPT/Codex plan once (web): ${pc.cyan('https://exe.dev/integrations')}`,
        `then attach it: ${pc.cyan(`ssh exe.dev integrations attach llm vm:${vm}`)}`,
      ].join('\n'),
      'connect Codex',
    )
  }

  // 6. success
  const firstReview = packs.length
    ? [
        `reviewing ${pc.bold(repo)} against ${pc.bold(tasteLine)}.`,
        `open a PR (or push to one) → stupify reviews it in ~60s. ${pc.dim('no labels, no setup.')}`,
        ``,
        `want your OWN taste? add a ${pc.cyan('.review/')} to ${pc.bold(repo)}, it overrides the pack.`,
      ]
    : [
        `${pc.yellow('⚠ dormant')}. you chose your own taste, so the reviewer no-ops every sweep until ${pc.bold(repo)} has a ${pc.cyan('.review/')}.`,
        `${pc.bold('1.')} add a ${pc.cyan('.review/')} to ${pc.bold(repo)}, copy this repo's, point CORPUS.md at YOUR best files`,
        `${pc.bold('2.')} push it → stupify reviews every PR in ~60s ${pc.dim('(no labels needed)')}`,
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
  console.log(`${pc.bold('stupify')}: a code reviewer that talks like an idiot and catches real bugs

${pc.dim('Usage')} ${pc.dim('(run from your laptop)')}
  stupify                 provision an exe.dev VM that reviews your repo ${pc.dim('(the magic)')}
  stupify <owner/repo>    provision for a specific repo
  stupify setup [repo]    install on THIS machine instead of provisioning a VM
  stupify run [--dry]     run one review sweep now (where stupify is installed)
  stupify upgrade [repo]  move a running reviewer to the latest engine, in place ${pc.dim('(a VM if repo given, else this box)')}
  stupify review <pr> [--post]  review ONE pull request on demand (a URL or owner/repo#123); prints it, --post comments it
  stupify taste [--pack a,b]  borrow a taste pack (assembles ~/.stupify/.review); packs below
  stupify init [files…]       encode YOUR OWN taste: scaffold .review/ from your best files in this repo
  stupify prime --install     prime Claude Code + Codex with your taste every session (SessionStart hook)
  stupify prime --uninstall   remove those hooks
  stupify --help

${pc.dim('Flags')}
  --host <h.int.exe.xyz>  GitHub integration host (for 'setup')
  --codex-host <h>        exe-llm gateway host (for 'setup'; default llm.int.exe.xyz)
  --agent <a,b>           ('prime') which agents to wire: ${PRIME_TARGETS.map((t) => t.id).join(', ')} (default: detected)
  --pack <a,b,...>        taste packs: ${PACKS.map((p) => p.id).join(', ')}
  --force                 ('init') rebuild CORPUS.md even if it exists (your filled-in "why" lines are kept)
  --yes, -y               accept detected defaults, no prompts (for CI / scripts)

${pc.dim("Provisioning rides exe.dev. Onboard once with 'ssh exe.dev', then one command does the rest.")} https://stupif.ai`)
}

// `stupify upgrade [repo]` — move a box to the latest published engine, IN PLACE. Narrow on purpose: it only
// re-bundles the engine (review-sweep.ts, plus prime.ts where the hook is installed). It never rewrites config.env
// (your tuning), the assembled .review/ taste, or the cron line. The minute cron runs the new file on its next
// tick, so nothing restarts. The engine is otherwise PINNED at provision time — this is the supported way forward.
//   no repo → upgrade THIS machine (run it on the VM itself, or a local `stupify setup` box) from this package.
//   <repo>  → from your laptop: ssh that repo's exe.dev VM and run `bunx @stupify/cli@latest upgrade` there.
async function upgrade(repoArg?: string): Promise<void> {
  if (repoArg) {
    const repo = normalizeRepo(repoArg)
    if (!validRepo(repo)) die(`'${repo}' is not a valid owner/repo (e.g. acme/widgets)`)
    const dest = `${vmNameFor(repo)}.exe.xyz`
    const s = progress(`upgrading ${dest}`)
    // Run the LATEST published CLI's own `upgrade` on the box — it pulls newest from npm and copies its engine in.
    // An exe.dev VM installs bun to ~/.bun/bin but leaves it off the (non-login) ssh PATH — the cron survives by
    // calling bun via its absolute path — so prepend the standard bun bindir or `bunx` is "command not found".
    const remote = 'PATH="$HOME/.bun/bin:$PATH" bunx @stupify/cli@latest upgrade'
    const r = spawnSync('ssh', ['-o', 'ConnectTimeout=25', dest, remote], { encoding: 'utf8', timeout: 180_000 })
    if (r.status !== 0) {
      s.stop(pc.red(`couldn't upgrade ${repo}`))
      die(((r.stderr ?? '') + (r.stdout ?? '')).trim().slice(0, 300) || r.error?.message || `ssh ${dest} exited ${r.status ?? '?'}`)
    }
    s.stop(pc.green(`${repo}'s reviewer is on the latest engine`) + pc.dim(' · the cron picks it up within ~60s'))
    return
  }
  // local: refresh THIS box's engine from this package; leave config.env, taste, and the cron line untouched.
  if (!existsSync(join(HOME, 'review-sweep.ts'))) {
    die(`nothing installed at ${HOME} to upgrade — run ${pc.cyan('stupify setup')} (this machine) or ${pc.cyan('stupify <owner/repo>')} (a VM) first`)
  }
  await installSweepEngine()
  if (existsSync(PRIME_ENGINE)) copyFileSync(join(PKG_DIR, 'prime.ts'), PRIME_ENGINE) // only where `prime --install` put it
  log.success(`engine refreshed to ${VERSION} → ${HOME} ${pc.dim('· cron runs it within ~60s')}`)
}

// --- routing ---
const args = process.argv.slice(2)
const yes = args.includes('--yes') || args.includes('-y')
const valueFlag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const host = valueFlag('--host')
const codexHost = valueFlag('--codex-host')
const pack = valueFlag('--pack')
const agent = valueFlag('--agent')
const positional = args.filter(
  (a, i) =>
    !a.startsWith('-') &&
    args[i - 1] !== '--host' &&
    args[i - 1] !== '--codex-host' &&
    args[i - 1] !== '--pack' &&
    args[i - 1] !== '--agent',
)
const cmd = positional[0]

if (args.includes('-h') || args.includes('--help') || cmd === 'help') {
  help()
} else if (cmd === 'taste') {
  await taste({ pack, yes })
} else if (cmd === 'init') {
  await init({ files: positional.slice(1), force: args.includes('--force') })
} else if (cmd === 'prime') {
  if (args.includes('--install')) await installPrimeHook({ pack, agent })
  else if (args.includes('--uninstall')) uninstallPrimeHook()
  else die('`stupify prime --install` to wire it up (or `--uninstall`). The hook itself runs ~/.stupify/prime.ts directly.')
} else if (cmd === 'run') {
  run(args.includes('--dry'))
} else if (cmd === 'review') {
  cmdReview(positional[1], args.includes('--post'))
} else if (cmd === 'setup') {
  await setup({ repo: positional[1], host, codexHost, yes, pack })
} else if (cmd === 'upgrade') {
  await upgrade(positional[1])
} else {
  // default (and explicit `provision`): provision an exe.dev VM
  await provision({ repo: cmd === 'provision' ? positional[1] : cmd, yes, pack })
}
