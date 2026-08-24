// Detached worktree at a PR's head SHA so codex reads the same tree the diff describes — required for stacked
// PRs whose base is not main (the shared checkout stays on defaultBranch for refreshRepo).
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { exec } from '@bevyl-ai/agent-tools'

import { type Pr } from './prs'

export function headWorktreePath(repoDir: string, pr: Pr): string {
  return join(dirname(repoDir), 'worktrees', `${pr.number}-${pr.headRefOid.slice(0, 8)}`)
}

/** Fetch base+head and add a detached worktree at the PR head. Returns null on failure. */
export function prepareHeadWorktree(repoDir: string, pr: Pr): string | null {
  const dir = headWorktreePath(repoDir, pr)
  rmSync(dir, { recursive: true, force: true })
  exec('git', ['worktree', 'prune'], { cwd: repoDir })
  if (
    !exec('git', ['fetch', '-q', 'origin', pr.baseRefOid, pr.headRefOid], { cwd: repoDir }).ok ||
    !exec('git', ['worktree', 'add', '--detach', dir, pr.headRefOid], { cwd: repoDir }).ok
  ) {
    return null
  }
  return dir
}

export function removeHeadWorktree(repoDir: string, pr: Pr): void {
  const dir = headWorktreePath(repoDir, pr)
  exec('git', ['worktree', 'remove', '--force', dir], { cwd: repoDir })
  rmSync(dir, { recursive: true, force: true })
}
