import { execFile, spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readDiffFromStdin } from "./diff.ts";
import {
  sourceRangeForCommit,
  sourceRangeForRecentCommits,
  sourceRangeSince,
} from "./git.ts";
import type {
  AnalyzeCommand,
  SemChange,
  SemChangeSet,
  SemChangeSummary,
  SemContext,
  SourceRange,
} from "./types.ts";
import { sourceId } from "./types.ts";

const execFileAsync = promisify(execFile);
const CONTEXT_BUDGET = 4_000;

export async function semChangeSetForCommand(
  command: AnalyzeCommand,
): Promise<SemChangeSet> {
  if (command.kind === "stdin") return semChangeSetFromPatch(await readDiffFromStdin(), command.debugSem);
  if (command.kind === "commit") {
    const range = await sourceRangeForCommit(command.commit);
    const raw = await runSem(["diff", "--commit", command.commit, "--format", "json"], command.debugSem);
    return withContextWorkspace(normalizeSemDiff(raw, range), command.debugSem);
  }

  const range = await semRangeForCommand(command);
  const raw = await runSem(["diff", "--from", range.base, "--to", range.target, "--format", "json"], command.debugSem);
  return withContextWorkspace(normalizeSemDiff(raw, range), command.debugSem);
}

export async function semContexts(
  cwd: string,
  entityIds: readonly string[],
  changes: readonly SemChange[],
  debugSem: boolean,
): Promise<readonly SemContext[]> {
  const uniqueEntityIds = [...new Set(entityIds)];
  const byEntityId = new Map(changes.map((change) => [change.entityId, change]));
  const contexts: SemContext[] = [];
  for (const entityId of uniqueEntityIds) {
    const startedAt = Date.now();
    try {
      const raw = await runSem([
        "context",
        "--entity-id",
        entityId,
        "--budget",
        String(CONTEXT_BUDGET),
        "--json",
      ], debugSem, cwd);
      contexts.push(normalizeSemContext(raw, entityId));
      if (debugSem) console.error(`trace sem.context.entity ${Date.now() - startedAt}ms entity=${entityId}`);
    } catch {
      const change = byEntityId.get(entityId);
      if (change) contexts.push(contextFromChange(change));
      if (debugSem) console.error(`trace sem.context.entity.fallback ${Date.now() - startedAt}ms entity=${entityId}`);
    }
  }
  return contexts;
}

async function semRangeForCommand(command: AnalyzeCommand): Promise<SourceRange> {
  if (command.kind === "since") return sourceRangeSince(command.since);
  if (command.kind === "commit") return sourceRangeForCommit(command.commit);
  if (command.kind === "commits") return sourceRangeForRecentCommits(command.count);
  throw new Error("sem engine cannot resolve stdin as a git range.");
}

async function semChangeSetFromPatch(patch: string, debugSem: boolean): Promise<SemChangeSet> {
  if (!patch.trim()) throw new Error("No diff received on stdin.");
  const raw = await runSemWithInput(["diff", "--patch", "--format", "json"], patch, debugSem);
  return {
    ...normalizeSemDiff(raw, {
    id: sourceId("stdin"),
    label: "stdin",
    base: "stdin",
    target: "stdin",
    stats: { filesChanged: 0, additions: 0, deletions: 0 },
    }),
    contextCwd: process.cwd(),
    cleanup: async () => undefined,
  };
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
  if (debugSem) console.error(`sem ${args.join(" ")}`);
  const { command, commandArgs } = resolveSemCommand(args);
  try {
    const { stdout, stderr } = await execFileAsync(command, commandArgs, {
      cwd,
      maxBuffer: 128 * 1024 * 1024,
    });
    if (debugSem && stderr.trim()) console.error(stderr.trim());
    return JSON.parse(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`sem failed. Install @ataraxy-labs/sem and ensure its binary is downloaded.\n${message}`);
  }
}

async function runSemWithInput(args: readonly string[], stdin: string, debugSem: boolean): Promise<unknown> {
  if (debugSem) console.error(`sem ${args.join(" ")}`);
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
      if (debugSem && stderrText.trim()) console.error(stderrText.trim());
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
  if (debugSem) console.error(`git ${args.join(" ")}`);
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

function normalizeSemContext(value: unknown, entityId: string): SemContext {
  if (!value || typeof value !== "object") throw new Error(`sem returned invalid context JSON for ${entityId}.`);
  const record = value as Record<string, unknown>;
  const entries = Array.isArray(record.entries) ? record.entries : [];
  return {
    entityId: stringValue(record.entityId) || entityId,
    entityName: stringValue(record.entity) || entityId,
    text: JSON.stringify({
      budget: numberValue(record.budget),
      totalTokens: numberValue(record.total_tokens),
      entries,
    }, null, 2),
  };
}

function contextFromChange(change: SemChange): SemContext {
  return {
    entityId: change.entityId,
    entityName: change.entityName,
    text: JSON.stringify({
      fallback: "sem context could not resolve entity; using sem diff content",
      entries: [{
        role: "target",
        file: change.filePath,
        type: change.entityType,
        name: change.entityName,
        content: change.afterContent ?? change.beforeContent ?? "",
      }],
    }, null, 2),
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
