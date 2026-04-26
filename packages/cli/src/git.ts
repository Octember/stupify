import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { prepareDiff } from "./diff.js";
import type { DiffUnit } from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_RELATED_CONTEXT_CHARS = 12_000;

export async function readUnitForCommit(commit: string): Promise<DiffUnit> {
  const [raw, message] = await Promise.all([commitDiff(commit), commitMessage(commit)]);
  if (!raw.trim()) throw new Error(`No diff found for commit ${commit}.`);
  const relatedContext = await readRelatedImportContext(commit, raw);
  const diff = prepareDiff(raw);
  const shortSha = await shortCommit(commit);
  const contextBlock = relatedContext ? `\n\nRELATED LOCAL CONTEXT:\n${relatedContext}` : "";
  return {
    id: shortSha,
    label: firstLine(message) || shortSha,
    text: `COMMIT MESSAGE:\n${message.trim() || shortSha}${contextBlock}\n\nDIFF:\n${diff.text}`,
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
      "--unified=8",
      `${commit}^1`,
      commit,
      "--",
    ], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    throw new Error(`Could not diff commit ${commit}.`);
  }
}

async function readRelatedImportContext(commit: string, rawDiff: string): Promise<string> {
  const refs = relatedLocalImports(rawDiff);
  const blocks: string[] = [];
  let usedChars = 0;

  for (const filePath of refs) {
    const content = await showFileAtCommit(`${commit}^1`, filePath) ?? await showFileAtCommit(commit, filePath);
    if (!content) continue;

    const block = `FILE ${filePath}\n${content.trim()}`;
    if (usedChars + block.length > MAX_RELATED_CONTEXT_CHARS) break;
    blocks.push(block);
    usedChars += block.length;
  }

  return blocks.join("\n\n");
}

function relatedLocalImports(rawDiff: string): readonly string[] {
  const refs = new Set<string>();
  let currentFile = "";

  for (const line of rawDiff.split(/\r?\n/)) {
    const fileMatch = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }

    if (!currentFile || !line.startsWith("+import ")) continue;
    const importMatch = /\bfrom\s+["']([^"']+)["']/.exec(line);
    if (!importMatch || !importMatch[1].startsWith(".")) continue;

    for (const candidate of resolveImportCandidates(currentFile, importMatch[1])) {
      refs.add(candidate);
    }
  }

  return [...refs];
}

function resolveImportCandidates(importer: string, specifier: string): readonly string[] {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  if (path.posix.extname(base) === ".js") {
    const withoutExt = base.slice(0, -3);
    return [`${withoutExt}.ts`, `${withoutExt}.tsx`];
  }
  if (path.posix.extname(base)) return [base];
  return [`${base}.ts`, `${base}.tsx`, path.posix.join(base, "index.ts"), path.posix.join(base, "index.tsx")];
}

async function showFileAtCommit(commit: string, filePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["show", `${commit}:${filePath}`], {
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
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
