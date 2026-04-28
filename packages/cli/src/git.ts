import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sourceId, type NetDiff, type NetDiffStats, type SourceRange, type StagedDiff } from "./types.ts";

const execFileAsync = promisify(execFile);

export async function netDiffSince(since: string): Promise<NetDiff> {
  const range = await sourceRangeSince(since);
  return netDiff(range.base, range.target, range.label, range.id);
}

export async function netDiffForCommit(commit: string): Promise<NetDiff> {
  const range = await sourceRangeForCommit(commit);
  return netDiff(range.base, range.target, range.label, range.id);
}

export async function netDiffForRecentCommits(count: number): Promise<NetDiff> {
  const range = await sourceRangeForRecentCommits(count);
  return netDiff(range.base, range.target, range.label, range.id);
}

export async function sourceRangeSince(since: string): Promise<SourceRange> {
  const [base, target] = await Promise.all([baseBefore(since), revParse("HEAD")]);
  return sourceRange(base, target, `last ${since}`);
}

export async function sourceRangeForCommit(commit: string): Promise<SourceRange> {
  const [base, target, shortTarget, message] = await Promise.all([
    revParse(`${commit}^1`),
    revParse(commit),
    shortCommit(commit),
    commitMessage(commit),
  ]);
  return sourceRange(base, target, firstLine(message) || shortTarget, sourceId(shortTarget));
}

export async function sourceRangeForRecentCommits(count: number): Promise<SourceRange> {
  const commits = await recentCommits(count);
  if (commits.length === 0) throw new Error("No non-merge commits found.");

  const oldest = commits[0];
  const newest = commits[commits.length - 1];
  if (!oldest || !newest) throw new Error("Could not resolve recent commit range.");
  const [base, target, shortBase, shortTarget] = await Promise.all([
    revParse(`${oldest}^1`),
    revParse(newest),
    shortCommit(`${oldest}^1`),
    shortCommit(newest),
  ]);

  return sourceRange(base, target, `${commits.length} recent commits`, sourceId(`range:${shortBase}..${shortTarget}`));
}

export async function netDiffFromStdin(text: string): Promise<NetDiff> {
  if (!text.trim()) throw new Error("No diff received on stdin.");
  return {
    id: sourceId("stdin"),
    label: "stdin",
    base: "stdin",
    target: "stdin",
    text,
    stats: statsFromDiff(text),
  };
}

export async function stagedDiff(): Promise<StagedDiff> {
  try {
    const { stdout } = await execFileAsync("git", [
      "diff",
      "--cached",
      "--no-ext-diff",
      "--no-color",
      "--unified=3",
      "--",
    ], { maxBuffer: 64 * 1024 * 1024 });
    return { text: stdout, stats: statsFromDiff(stdout) };
  } catch {
    throw new Error("Could not read staged changes. Run stupify inside a git repository.");
  }
}

export async function gitRoot(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"]);
    return stdout.trim();
  } catch {
    throw new Error("Could not find a git repository.");
  }
}

export async function gitPath(pathspec: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", pathspec]);
    return stdout.trim();
  } catch {
    throw new Error(`Could not resolve git path: ${pathspec}`);
  }
}

export async function gitUserLabel(): Promise<string> {
  const [name, email] = await Promise.all([
    gitConfig("user.name"),
    gitConfig("user.email"),
  ]);
  if (name && email) return `${name} <${email}>`;
  return name || email || "working tree";
}

async function netDiff(base: string, target: string, label: string, id?: NetDiff["id"]): Promise<NetDiff> {
  const [text, stats, shortBase, shortTarget] = await Promise.all([
    diff(base, target),
    diffStats(base, target),
    shortCommit(base),
    shortCommit(target),
  ]);
  return {
    id: id ?? sourceId(`net:${shortBase}..${shortTarget}`),
    label,
    base,
    target,
    text,
    stats,
  };
}

async function sourceRange(base: string, target: string, label: string, id?: SourceRange["id"]): Promise<SourceRange> {
  const [stats, shortBase, shortTarget, committers, commitSubjects] = await Promise.all([
    diffStats(base, target),
    shortCommit(base),
    shortCommit(target),
    committersForRange(base, target),
    commitSubjectsForRange(base, target),
  ]);
  return {
    id: id ?? sourceId(`net:${shortBase}..${shortTarget}`),
    label,
    base,
    target,
    committers,
    commitSubjects,
    stats,
  };
}

async function gitConfig(key: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--get", key]);
    return stdout.trim();
  } catch {
    return "";
  }
}

async function committersForRange(base: string, target: string): Promise<readonly string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["log", "--format=%cn <%ce>", `${base}..${target}`], {
      maxBuffer: 4 * 1024 * 1024,
    });
    return uniqueLines(stdout);
  } catch {
    return [];
  }
}

async function commitSubjectsForRange(base: string, target: string): Promise<readonly string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["log", "--format=%s", `${base}..${target}`], {
      maxBuffer: 4 * 1024 * 1024,
    });
    return uniqueLines(stdout);
  } catch {
    return [];
  }
}

function uniqueLines(value: string): readonly string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    lines.push(trimmed);
  }
  return lines;
}

async function baseBefore(since: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [
      "log",
      "--first-parent",
      "--before",
      since,
      "-1",
      "--format=%H",
    ]);
    const commit = stdout.trim();
    if (commit) return commit;
    return rootCommit();
  } catch {
    throw new Error(`Could not resolve base commit before ${since}.`);
  }
}

async function rootCommit(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-list", "--max-parents=0", "HEAD"]);
    return stdout.trim().split(/\r?\n/, 1)[0] ?? "";
  } catch {
    throw new Error("Could not resolve repository root commit.");
  }
}

async function diff(base: string, target: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [
      "diff",
      "--no-ext-diff",
      "--no-color",
      "--unified=8",
      base,
      target,
      "--",
    ], { maxBuffer: 128 * 1024 * 1024 });
    if (!stdout.trim()) throw new Error("empty diff");
    return stdout;
  } catch {
    throw new Error(`No diff found for ${base}..${target}.`);
  }
}

async function diffStats(base: string, target: string): Promise<NetDiffStats> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--numstat", base, target, "--"], {
      maxBuffer: 16 * 1024 * 1024,
    });
    return statsFromNumstat(stdout);
  } catch {
    return { filesChanged: 0, additions: 0, deletions: 0 };
  }
}

function statsFromDiff(diffText: string): NetDiffStats {
  const files = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const line of diffText.split(/\r?\n/)) {
    const fileMatch = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (fileMatch?.[1]) files.add(fileMatch[1]);
    else if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { filesChanged: files.size, additions, deletions };
}

function statsFromNumstat(numstat: string): NetDiffStats {
  let filesChanged = 0;
  let additions = 0;
  let deletions = 0;

  for (const line of numstat.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [added, deleted] = line.split(/\s+/, 3);
    filesChanged += 1;
    additions += Number(added) || 0;
    deletions += Number(deleted) || 0;
  }

  return { filesChanged, additions, deletions };
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

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
}
