#!/usr/bin/env bun
/**
 * stupify prime — emit the pre-decided taste (rubric + corpus index) as a Claude Code SessionStart hook
 * payload, so a coding session opens already holding your standard instead of only catching slop in review.
 *
 * Dependency-free (node builtins only) ON PURPOSE: `stupify prime --install` drops a copy of THIS file at
 * ~/.stupify/prime.ts and points the hook at it, so the hook runs fast with no global install and no
 * node_modules. Pure file read — no model, no network. It must NEVER break session start: any miss or error
 * emits nothing and exits 0. stdout is ONLY the JSON payload (a stray byte makes Claude Code drop it).
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = process.env.STUPIFY_HOME ?? join(homedir(), '.stupify')
const BUDGET = 9000 // max bytes of injected additionalContext — measured: SessionStart silently truncates above ~10KB

/** Resolve taste like the reviewer does (the repo you're coding in wins, else the pack taste setup assembled)
 *  and build the SessionStart payload. Returns null when no taste is set up — caller emits nothing. */
export function primePayload(cwd: string = process.cwd(), home: string = HOME): string | null {
  const dir = [join(cwd, '.review'), join(home, '.review')].find(
    (d) => existsSync(join(d, 'RUBRIC.md')) && existsSync(join(d, 'CORPUS.md')),
  )
  if (dir === undefined) return null
  const rubric = readFileSync(join(dir, 'RUBRIC.md'), 'utf8').trim()
  let corpus = readFileSync(join(dir, 'CORPUS.md'), 'utf8').trim()
  const head = `# Your taste, loaded by stupify — write to this standard

You're about to write or change code in this repo. Hold every edit to the standard below BEFORE you write it —
it's the same taste stupify reviews against, so matching it now is a clean review later.

## What counts as slop here — don't ship it (RUBRIC)
${rubric}

## The code yours should look like — match it (CORPUS)
`
  // A SessionStart hook's additionalContext is silently truncated above ~12KB, and the corpus lands LAST, so a
  // big .review/ would inject the rubric but drop all the code. Trim the corpus at a whole-section boundary to
  // stay under budget — the agent always gets real code; the reviewer reads the full CORPUS.md from disk.
  const room = BUDGET - head.length
  if (corpus.length > room) {
    const cut = Math.max(corpus.lastIndexOf('\n\n---\n\n', room), corpus.lastIndexOf('\n### ', room))
    corpus = `${cut > 0 ? corpus.slice(0, cut) : corpus.slice(0, room)}\n\n_(more exemplars in .review/CORPUS.md — trimmed here to fit the session-start budget)_`
  }
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: head + corpus } })
}

/** Write the payload to stdout, or nothing. Swallows every error: a hook must never disrupt session start. */
export function emitPrime(): void {
  try {
    const payload = primePayload()
    if (payload !== null) process.stdout.write(payload)
  } catch {
    /* never break session start */
  }
}

if (import.meta.main) emitPrime() // run directly (the installed hook calls `bun ~/.stupify/prime.ts`)
