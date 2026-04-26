import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareDiff } from "./diff.ts";
import type { DiffUnit } from "./types.ts";

const execFileAsync = promisify(execFile);

export async function readUnitForCommit(commit: string): Promise<DiffUnit> {
  const [raw, message] = await Promise.all([commitDiff(commit), commitMessage(commit)]);
  if (!raw.trim()) throw new Error(`No diff found for commit ${commit}.`);
  const diff = prepareDiff(raw);
  const shortSha = await shortCommit(commit);
  return {
    id: shortSha,
    label: firstLine(message) || shortSha,
    text: `COMMIT MESSAGE:\n${message.trim() || shortSha}\n\nDIFF:\n${diff.text}`,
  };
}

export async function readUnitsForRecentCommits(count: number): Promise<readonly DiffUnit[]> {
  const commits = await recentCommits(count);
  return Promise.all(commits.map(readUnitForCommit));
}

export function unitFromStdinDiff(text: string): DiffUnit {
  const diff = prepareDiff(text);
  return { id: "stdin", label: "stdin", text: diff.text };
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

async function recentCommits(count: number): Promise<readonly string[]> {
  try {
    const { stdout } = await execFileAsync("git", [
      "log",
      "--no-merges",
      "--format=%H",
      `-${count}`,
    ]);
    return stdout.split(/\r?\n/).filter(Boolean).reverse();
  } catch {
    throw new Error(`Could not read last ${count} commits.`);
  }
}

async function shortCommit(commit: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", commit]);
    return stdout.trim();
  } catch {
    throw new Error(`Could not resolve commit ${commit}.`);
  }
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
}

async function commitMessage(commit: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["show", "--no-patch", "--format=%B", commit], {
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch {
    throw new Error(`Could not read commit message for ${commit}.`);
  }
}
