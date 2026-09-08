import { exec } from '@bevyl-ai/agent-tools'

import { type Config } from './config'
import { type Pr } from './prs'

export const GH_DIFF_LIMITS = '20000-line / 300-file'

export const isDiffTooLarge = (output: string): boolean =>
  /PullRequest\.diff too_large|diff exceeded the maximum number of (?:lines|files)/i.test(output)

type DiffRead = { ok: true; diff: string } | { ok: false; reason: 'unreadable' | 'too-large' }

export function getDiff(cfg: Config, pr: Pick<Pr, 'baseRefOid' | 'headRefOid'>): DiffRead {
  const r = exec('gh', [
    'api',
    `repos/${cfg.slug}/compare/${pr.baseRefOid}...${pr.headRefOid}`,
    '-H',
    'Accept: application/vnd.github.diff',
  ])
  if (r.ok) {
    return { ok: true, diff: r.stdout }
  }
  return { ok: false, reason: isDiffTooLarge(r.combined) ? 'too-large' : 'unreadable' }
}

export const diffLineCount = (diff: string): number =>
  diff ? diff.split('\n').length - (diff.endsWith('\n') ? 1 : 0) : 0

export function diffRightLines(diff: string): Map<string, Set<number>> {
  const byPath = new Map<string, Set<number>>()
  const cur = { path: '', right: 0, inHunk: false }
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim()
      cur.path = p.startsWith('b/') ? p.slice(2) : p
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
    }
    if (line.startsWith('+') || line.startsWith(' ')) {
      byPath.get(cur.path)?.add(cur.right)
      cur.right++
    }
  }
  return byPath
}
