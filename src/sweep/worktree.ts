import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { exec } from '@bevyl-ai/agent-tools'

import { type Pr } from './prs'

function headWorktreePath(repoDir: string, pr: Pr): string {
  return join(dirname(repoDir), 'worktrees', `${pr.number}-${pr.headRefOid.slice(0, 8)}`)
}

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
