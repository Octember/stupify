import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pack, setLogLevel } from "repomix";
import type { RepomixSearchConfig, SemCandidate, SemChange, SemContext, SemContextPack } from "./types.ts";

const MAX_PACK_FILE_SIZE_BYTES = 48 * 1024;
const MAX_PACK_TOTAL_SIZE_BYTES = 128 * 1024;

export function emptyContextPack(): SemContextPack {
  const config = repomixSearchConfig();
  return {
    provider: "repomix",
    filePaths: [],
    totalCharacters: 0,
    totalTokens: 0,
    text: "",
    config,
  };
}

export async function repomixContextPack(
  cwd: string,
  contexts: readonly SemContext[],
  changes: readonly SemChange[],
  config = repomixSearchConfig(),
): Promise<SemContextPack> {
  const filePaths = await candidateFilePaths(cwd, contexts, changes, config);
  if (filePaths.length === 0) {
    return {
      ...emptyContextPack(),
      config,
    };
  }

  setLogLevel(-1);
  const tempDir = await mkdtemp(path.join(tmpdir(), "stupify-repomix-"));
  const outputPath = path.join(tempDir, "context.xml");
  try {
    const result = await pack(
      [cwd],
      {
        cwd,
        input: { maxFileSize: config.maxFileSizeBytes },
        output: {
          filePath: outputPath,
          style: "xml",
          parsableStyle: false,
          fileSummary: false,
          directoryStructure: false,
          files: true,
          removeComments: false,
          removeEmptyLines: config.removeEmptyLines,
          compress: config.compress,
          topFilesLength: 0,
          showLineNumbers: config.showLineNumbers,
          truncateBase64: true,
          copyToClipboard: false,
          includeFullDirectoryStructure: false,
          tokenCountTree: false,
          git: {
            sortByChanges: false,
            sortByChangesMaxCommits: 1,
            includeDiffs: false,
            includeLogs: false,
            includeLogsCount: 1,
          },
        },
        include: [],
        ignore: {
          useGitignore: true,
          useDotIgnore: true,
          useDefaultPatterns: true,
          customPatterns: [...config.ignorePatterns],
        },
        security: { enableSecurityCheck: false },
        tokenCount: { encoding: "o200k_base" },
      } satisfies Parameters<typeof pack>[1],
      () => undefined,
      {},
      [...filePaths],
    );
    return {
      provider: "repomix",
      filePaths,
      totalCharacters: result.totalCharacters,
      totalTokens: result.totalTokens,
      text: await readFile(outputPath, "utf8"),
      config,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function entityContextsFromChanges(
  candidates: readonly SemCandidate[],
  changes: readonly SemChange[],
): readonly SemContext[] {
  const byEntityId = new Map(changes.map((change) => [change.entityId, change]));
  return candidates.flatMap((candidate): readonly SemContext[] => {
    const change = byEntityId.get(candidate.entityId);
    if (!change) return [];
    return [{
      targetId: candidate.targetId,
      entityId: change.entityId,
      entityName: change.entityName,
      entityKind: change.entityType,
      changeKind: change.changeType,
      checkId: candidate.checkId,
      reason: candidate.reason,
      filePath: change.filePath,
      text: JSON.stringify({
        source: "sem diff",
        file: change.filePath,
        type: change.entityType,
        name: change.entityName,
        change: change.changeType,
        before: shortenCode(change.beforeContent),
        after: shortenCode(change.afterContent),
      }, null, 2),
    }];
  });
}

async function candidateFilePaths(
  cwd: string,
  contexts: readonly SemContext[],
  changes: readonly SemChange[],
  config: RepomixSearchConfig,
): Promise<readonly string[]> {
  const byEntityId = new Map(changes.map((change) => [change.entityId, change.filePath]));
  const paths = contexts.flatMap((context) => context.filePath ?? byEntityId.get(context.entityId) ?? []);
  const safePaths = [...new Set(paths)].filter(isSafeRelativeFilePath);
  const selected = [];
  let totalBytes = 0;
  for (const filePath of safePaths) {
    if (matchesAnyPattern(filePath, config.ignorePatterns)) continue;
    const bytes = await fileSize(cwd, filePath);
    if (bytes === null || bytes > config.maxFileSizeBytes) continue;
    if (totalBytes + bytes > config.maxTotalSizeBytes) continue;
    totalBytes += bytes;
    selected.push(filePath);
  }
  return selected;
}

export function repomixSearchConfig(): RepomixSearchConfig {
  return {
    compress: envBoolean("STUPIFY_REPOMIX_COMPRESS", true),
    showLineNumbers: envBoolean("STUPIFY_REPOMIX_SHOW_LINE_NUMBERS", true),
    removeEmptyLines: envBoolean("STUPIFY_REPOMIX_REMOVE_EMPTY_LINES", true),
    maxFileSizeBytes: envInteger("STUPIFY_REPOMIX_MAX_FILE_BYTES", MAX_PACK_FILE_SIZE_BYTES),
    maxTotalSizeBytes: envInteger("STUPIFY_REPOMIX_MAX_TOTAL_BYTES", MAX_PACK_TOTAL_SIZE_BYTES),
    ignorePatterns: envList("STUPIFY_REPOMIX_IGNORE_PATTERNS"),
  };
}

function envBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function envInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function envList(name: string): readonly string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesAnyPattern(filePath: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesPattern(filePath, pattern));
}

function matchesPattern(filePath: string, pattern: string): boolean {
  if (pattern === filePath) return true;
  if (!pattern.includes("*")) return false;
  const escaped = pattern
    .split("*")
    .map(escapeRegExp)
    .join(".*");
  return new RegExp(`^${escaped}$`).test(filePath);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isSafeRelativeFilePath(value: string): boolean {
  if (!value || path.isAbsolute(value)) return false;
  const normalized = path.normalize(value);
  return normalized !== "." && !normalized.startsWith("..") && !path.isAbsolute(normalized);
}

async function fileSize(cwd: string, filePath: string): Promise<number | null> {
  try {
    const fullPath = path.join(cwd, filePath);
    if (!fullPath.startsWith(`${cwd}${path.sep}`)) return null;
    const result = await stat(fullPath);
    return result.isFile() ? result.size : null;
  } catch {
    return null;
  }
}

function shortenCode(value: string | null): string {
  if (!value) return "(none)";
  const lines = value.split(/\r?\n/);
  const limit = 120;
  if (lines.length <= limit) return value;
  return `${lines.slice(0, limit).join("\n")}
[stupify: sem entity content shortened after ${limit} lines]`;
}
