// Fetching and measuring PR diffs. The RUNNER fetches the diff (not codex) so codex needs no network or gh —
// it reviews the diff straight from the prompt, sandboxed.
import { exec } from '@bevyl-ai/agent-tools'

import { type Config } from './config'

// GitHub's diff endpoint 406s past EITHER of these, so a big enough PR can't even be MEASURED. They are GitHub's
// limits, not ours — DIFF_LINE_CAP can be set above the line one but never reached.
export const GH_DIFF_LIMITS = '20000-line / 300-file'

/** A `gh pr diff` failure that is GitHub's size refusal rather than a transient error — retrying can never fix it.
 *  Matches on gh's stable `too_large` code first: the prose differs per limit (lines vs files) and can be reworded,
 *  but both variants carry the code. Missing one variant is what kept #8338/#8241 looping after the first fix. */
export const isDiffTooLarge = (output: string): boolean =>
  /PullRequest\.diff too_large|diff exceeded the maximum number of (?:lines|files)/i.test(output)

// Never treat a failed read as "0 lines" (a silent under-cap that would auto-review something it never
// measured) — and keep the two failure modes apart: 'unreadable' is transient and worth retrying, but
// 'too-large' is terminal, and conflating them is what left oversized PRs re-fetched every 60s forever.
type DiffRead = { ok: true; diff: string } | { ok: false; reason: 'unreadable' | 'too-large' }

export function getDiff(cfg: Config, number: number): DiffRead {
  const r = exec('gh', ['pr', 'diff', String(number), '--repo', cfg.slug])
  if (r.ok) {
    return { ok: true, diff: r.stdout }
  }
  return { ok: false, reason: isDiffTooLarge(r.combined) ? 'too-large' : 'unreadable' }
}

export const diffLineCount = (diff: string): number =>
  diff ? diff.split('\n').length - (diff.endsWith('\n') ? 1 : 0) : 0

// Which RIGHT-side (new-file) line numbers a unified diff actually touches, per path — the only lines GitHub lets
// you anchor an inline review comment to. Added (`+`) and context (` `) lines are anchorable; removed (`-`) lines
// are LEFT-only and don't advance the right counter. A finding on a line NOT in here can't be a thread, so the
// runner demotes it into the review body instead of 422-ing the whole review.
export function diffRightLines(diff: string): Map<string, Set<number>> {
  const byPath = new Map<string, Set<number>>()
  const cur = { path: '', right: 0, inHunk: false }
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim()
      cur.path = p.startsWith('b/') ? p.slice(2) : p // b/<path>, or /dev/null for a deletion (no right lines)
      if (!byPath.has(cur.path)) {
        byPath.set(cur.path, new Set())
      }
      cur.inHunk = false
      continue
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(?<right>\d+)(?:,\d+)? @@/)
    if (hunk?.groups?.right !== undefined) {
      cur.right = Number(hunk.groups.right)
      cur.inHunk = true
      continue
    }
    if (!cur.inHunk || !cur.path || cur.path === '/dev/null') {
      continue
    }
    if (line.startsWith('-') || line.startsWith('\\')) {
      continue
    } // left-only line / "no newline" marker — right doesn't advance
    if (line.startsWith('+') || line.startsWith(' ')) {
      byPath.get(cur.path)?.add(cur.right)
      cur.right++
    }
  }
  return byPath
}
