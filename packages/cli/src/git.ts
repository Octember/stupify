import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareDiff } from "./diff.js";
import type { DiffInput } from "./types.js";

const execFileAsync = promisify(execFile);

export async function readDiffForCommit(commit: string): Promise<DiffInput> {
  const raw = await commitDiff(commit);
  if (!raw.trim()) throw new Error(`No diff found for commit ${commit}.`);
  return prepareDiff(raw);
}

async function commitDiff(commit: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [
      "diff",
      "--no-ext-diff",
      "--no-color",
      "--unified=0",
      `${commit}^1`,
      commit,
      "--",
    ], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    throw new Error(`Could not diff commit ${commit}.`);
  }
}
