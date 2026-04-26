import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CommitProjection } from "./git.ts";
import type { SourceId } from "./types.ts";

const execFileAsync = promisify(execFile);

export type ProjectedChange = Readonly<{
  tempDir: string;
  id: SourceId;
  label: string;
  base: string;
  target: string;
  logs: string;
  cleanup: () => Promise<void>;
}>;

export async function projectChange(projection: CommitProjection): Promise<ProjectedChange> {
  const tempDir = await realpath(await mkdtemp(path.join(tmpdir(), "stupify-change-")));
  let worktreeAdded = false;

  try {
    await git(["worktree", "add", "--detach", tempDir, projection.base]);
    worktreeAdded = true;

    const patchPath = path.join(tempDir, ".stupify-change.patch");
    await writeFile(patchPath, await diff(projection.base, projection.target));
    await git(["-C", tempDir, "apply", "--index", "--3way", patchPath]);
    await rm(patchPath, { force: true });

    return {
      ...projection,
      tempDir,
      cleanup: async () => {
        await cleanupWorktree(tempDir, worktreeAdded);
      },
    };
  } catch (error) {
    await cleanupWorktree(tempDir, worktreeAdded);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function diff(base: string, target: string): Promise<string> {
  const { stdout } = await git(["diff", "--binary", "--no-ext-diff", "--no-color", base, target, "--"]);
  if (!stdout.trim()) throw new Error(`No diff found for ${base}..${target}.`);
  return stdout;
}

async function git(args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("git", [...args], { maxBuffer: 128 * 1024 * 1024 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Git command failed: git ${args.join(" ")}\n${message}`);
  }
}

async function cleanupWorktree(tempDir: string, worktreeAdded: boolean): Promise<void> {
  if (worktreeAdded) {
    try {
      await git(["worktree", "remove", "--force", tempDir]);
    } catch {
      await rm(tempDir, { recursive: true, force: true });
      await git(["worktree", "prune"]).catch(() => undefined);
    }
    return;
  }

  await rm(tempDir, { recursive: true, force: true });
}
