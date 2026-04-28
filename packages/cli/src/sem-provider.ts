import { execFile, spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { cachedJson, fingerprint } from "./cache.ts";
import { readDiffFromStdin } from "./diff.ts";
import {
  sourceRangeForCommit,
  sourceRangeForRecentCommits,
  sourceRangeSince,
  stagedDiff,
} from "./git.ts";
import { diagnostic } from "./ui.ts";
import type {
  SearchCommand,
  SemChange,
  SemChangeSet,
  SemChangeSummary,
  SourceRange,
} from "./types.ts";
import { sourceId } from "./types.ts";

const execFileAsync = promisify(execFile);

export async function semChangeSetForCommand(
  command: SearchCommand,
): Promise<SemChangeSet> {
  if (command.kind === "stdin") return semChangeSetFromPatch(await readDiffFromStdin(), command.debugSem);
  if (command.kind === "staged") {
    const diff = await stagedDiff();
    if (!diff.text.trim()) return emptyChangeSet("staged", diff.stats);
    return semChangeSetFromPatch(diff.text, command.debugSem, "staged");
  }
  if (command.kind === "commit") {
    const range = await sourceRangeForCommit(command.commit);
    const raw = await cachedSemDiff(
      ["diff", "--commit", command.commit, "--format", "json"],
      range,
      command.debugSem,
    );
    return withContextWorkspace(normalizeSemDiff(raw, range), command.debugSem);
  }

  const range = await semRangeForCommand(command);
  const raw = await cachedSemDiff(
    ["diff", "--from", range.base, "--to", range.target, "--format", "json"],
    range,
    command.debugSem,
  );
  return withContextWorkspace(normalizeSemDiff(raw, range), command.debugSem);
}

function emptyChangeSet(label: string, stats: SourceRange["stats"]): SemChangeSet {
  return {
    id: sourceId(label),
    label,
    base: label,
    target: label,
    contextCwd: process.cwd(),
    cleanup: async () => undefined,
    changes: [],
    summary: {
      added: stats.additions,
      deleted: stats.deletions,
      modified: 0,
      moved: 0,
      renamed: 0,
      fileCount: stats.filesChanged,
      total: 0,
    },
  };
}

async function semRangeForCommand(command: SearchCommand): Promise<SourceRange> {
  if (command.kind === "since") return sourceRangeSince(command.since);
  if (command.kind === "commit") return sourceRangeForCommit(command.commit);
  if (command.kind === "commits") return sourceRangeForRecentCommits(command.count);
  throw new Error("sem cannot resolve stdin as a git range.");
}

async function semChangeSetFromPatch(patch: string, debugSem: boolean, label = "stdin"): Promise<SemChangeSet> {
  if (!patch.trim()) throw new Error("No diff received on stdin.");
  const raw = await cachedJson(
    "sem-diff",
    fingerprint({
      version: 1,
      cwd: process.cwd(),
      command: ["diff", "--patch", "--format", "json"],
      patchHash: fingerprint(patch),
    }),
    () => runSemWithInput(["diff", "--patch", "--format", "json"], patch, debugSem),
  );
  return {
    ...normalizeSemDiff(raw, {
    id: sourceId(label),
    label,
    base: label,
    target: label,
    stats: { filesChanged: 0, additions: 0, deletions: 0 },
    }),
    contextCwd: process.cwd(),
    cleanup: async () => undefined,
  };
}

async function cachedSemDiff(
  args: readonly string[],
  range: SourceRange,
  debugSem: boolean,
): Promise<unknown> {
  return cachedJson(
    "sem-diff",
    fingerprint({
      version: 1,
      cwd: process.cwd(),
      args,
      base: range.base,
      target: range.target,
    }),
    () => runSem(args, debugSem),
  );
}

async function withContextWorkspace(changeSet: SemChangeSet, debugSem: boolean): Promise<SemChangeSet> {
  const tempDir = await realpath(await mkdtemp(path.join(tmpdir(), "stupify-sem-context-")));
  let worktreeAdded = false;
  try {
    await git(["worktree", "add", "--detach", tempDir, changeSet.target], debugSem);
    worktreeAdded = true;
    return {
      ...changeSet,
      contextCwd: tempDir,
      cleanup: async () => cleanupWorktree(tempDir, worktreeAdded, debugSem),
    };
  } catch (error) {
    await cleanupWorktree(tempDir, worktreeAdded, debugSem);
    throw error;
  }
}

async function runSem(args: readonly string[], debugSem: boolean, cwd = process.cwd()): Promise<unknown> {
  if (debugSem) diagnostic(`sem ${args.join(" ")}`);
  const { command, commandArgs } = resolveSemCommand(args);
  try {
    const { stdout, stderr } = await execFileAsync(command, commandArgs, {
      cwd,
      maxBuffer: 128 * 1024 * 1024,
    });
    if (debugSem && stderr.trim()) diagnostic(stderr.trim());
    return JSON.parse(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`sem failed. Install @ataraxy-labs/sem and ensure its binary is downloaded.\n${message}`);
  }
}

async function runSemWithInput(args: readonly string[], stdin: string, debugSem: boolean): Promise<unknown> {
  if (debugSem) diagnostic(`sem ${args.join(" ")}`);
  const { command, commandArgs } = resolveSemCommand(args);
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (debugSem && stderrText.trim()) diagnostic(stderrText.trim());
      if (code !== 0) {
        reject(new Error(`sem failed with exit code ${code}${stderrText ? `: ${stderrText.trim()}` : ""}`));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(stdin);
  });
}

async function git(args: readonly string[], debugSem: boolean): Promise<void> {
  if (debugSem) diagnostic(`git ${args.join(" ")}`);
  await execFileAsync("git", [...args], { maxBuffer: 128 * 1024 * 1024 });
}

async function cleanupWorktree(tempDir: string, worktreeAdded: boolean, debugSem: boolean): Promise<void> {
  if (!worktreeAdded) {
    await rm(tempDir, { recursive: true, force: true });
    return;
  }
  try {
    await git(["worktree", "remove", "--force", tempDir], debugSem);
  } catch {
    await rm(tempDir, { recursive: true, force: true });
    await git(["worktree", "prune"], debugSem).catch(() => undefined);
  }
}

function resolveSemCommand(args: readonly string[]): Readonly<{ command: string; commandArgs: readonly string[] }> {
  const packageBin = semPackageBin();
  if (packageBin) return { command: process.execPath, commandArgs: [packageBin, ...args] };
  return { command: "sem", commandArgs: args };
}

function semPackageBin(): string | null {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve("@ataraxy-labs/sem/bin/sem.js");
  } catch {
    return null;
  }
}

function normalizeSemDiff(value: unknown, range: SourceRange): SemChangeSet {
  if (!value || typeof value !== "object") throw new Error("sem returned invalid diff JSON.");
  const record = value as Record<string, unknown>;
  const changes = Array.isArray(record.changes) ? record.changes.flatMap(normalizeSemChange) : [];
  const summary = normalizeSemSummary(record.summary, changes);
  return {
    id: range.id,
    label: range.label,
    base: range.base,
    target: range.target,
    contextCwd: process.cwd(),
    cleanup: async () => undefined,
    changes,
    summary,
  };
}

function normalizeSemChange(value: unknown): readonly SemChange[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const entityId = stringValue(record.entityId);
  const entityName = stringValue(record.entityName);
  const entityType = stringValue(record.entityType);
  const filePath = stringValue(record.filePath);
  const changeType = stringValue(record.changeType);
  if (!entityId || !entityName || !entityType || !filePath || !changeType) return [];
  return [{
    entityId,
    entityName,
    entityType,
    filePath,
    changeType,
    beforeContent: nullableString(record.beforeContent),
    afterContent: nullableString(record.afterContent),
  }];
}

function normalizeSemSummary(value: unknown, changes: readonly SemChange[]): SemChangeSummary {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    added: numberValue(record.added) ?? countByChange(changes, "added"),
    deleted: numberValue(record.deleted) ?? countByChange(changes, "deleted"),
    modified: numberValue(record.modified) ?? countByChange(changes, "modified"),
    moved: numberValue(record.moved) ?? countByChange(changes, "moved"),
    renamed: numberValue(record.renamed) ?? countByChange(changes, "renamed"),
    fileCount: numberValue(record.fileCount) ?? new Set(changes.map((change) => change.filePath)).size,
    total: numberValue(record.total) ?? changes.length,
  };
}

function countByChange(changes: readonly SemChange[], changeType: string): number {
  return changes.filter((change) => change.changeType === changeType).length;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
