import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CommitProjection = Readonly<{
  id: string;
  label: string;
  base: string;
  target: string;
  logs: string;
}>;

export async function projectionForCommit(commit: string): Promise<CommitProjection> {
  const [base, target, shortTarget, message] = await Promise.all([
    revParse(`${commit}^1`),
    revParse(commit),
    shortCommit(commit),
    commitMessage(commit),
  ]);

  return {
    id: shortTarget,
    label: firstLine(message) || shortTarget,
    base,
    target,
    logs: await commitLogs(base, target),
  };
}

export async function projectionForRecentCommits(count: number): Promise<CommitProjection> {
  const commits = await recentCommits(count);
  if (commits.length === 0) throw new Error("No non-merge commits found.");

  const oldest = commits[0];
  const newest = commits[commits.length - 1];
  const [base, target, shortBase, shortTarget] = await Promise.all([
    revParse(`${oldest}^1`),
    revParse(newest),
    shortCommit(`${oldest}^1`),
    shortCommit(newest),
  ]);

  return {
    id: `range:${shortBase}..${shortTarget}`,
    label: `${commits.length} recent commits`,
    base,
    target,
    logs: await commitLogLines(commits),
  };
}

async function recentCommits(count: number): Promise<readonly string[]> {
  try {
    const { stdout } = await execFileAsync("git", [
      "log",
      "--first-parent",
      "--no-merges",
      "--format=%H",
      `-${count}`,
    ]);
    return stdout.split(/\r?\n/).filter(Boolean).reverse();
  } catch {
    throw new Error(`Could not read last ${count} commits.`);
  }
}

async function revParse(rev: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", rev]);
    return stdout.trim();
  } catch {
    throw new Error(`Could not resolve ${rev}.`);
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

async function commitLogs(base: string, target: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [
      "log",
      "--no-merges",
      "--reverse",
      "--format=%h %s",
      `${base}..${target}`,
    ], { maxBuffer: 1024 * 1024 });
    return stdout.trim();
  } catch {
    throw new Error(`Could not read commit logs for ${base}..${target}.`);
  }
}

async function commitLogLines(commits: readonly string[]): Promise<string> {
  const lines = await Promise.all(commits.map(async (commit) => {
    const [short, message] = await Promise.all([shortCommit(commit), commitMessage(commit)]);
    return `${short} ${firstLine(message) || "(no commit message)"}`;
  }));
  return lines.join("\n");
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
}
