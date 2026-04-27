import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pack, setLogLevel } from "repomix";
import type { SemCandidate, SemChange, SemContext, SemContextPack } from "./types.ts";

const MAX_PACK_FILE_SIZE_BYTES = 48 * 1024;
const MAX_PACK_TOTAL_SIZE_BYTES = 128 * 1024;

export function emptyContextPack(): SemContextPack {
  return {
    provider: "repomix",
    filePaths: [],
    totalCharacters: 0,
    totalTokens: 0,
    text: "",
  };
}

export async function repomixContextPack(
  cwd: string,
  contexts: readonly SemContext[],
  changes: readonly SemChange[],
): Promise<SemContextPack> {
  const filePaths = await candidateFilePaths(cwd, contexts, changes);
  if (filePaths.length === 0) {
    return emptyContextPack();
  }

  setLogLevel(-1);
  const tempDir = await mkdtemp(path.join(tmpdir(), "stupify-repomix-"));
  const outputPath = path.join(tempDir, "context.xml");
  try {
    const result = await pack(
      [cwd],
      {
        cwd,
        input: { maxFileSize: MAX_PACK_FILE_SIZE_BYTES },
        output: {
          filePath: outputPath,
          style: "xml",
          parsableStyle: false,
          fileSummary: false,
          directoryStructure: false,
          files: true,
          removeComments: false,
          removeEmptyLines: true,
          compress: true,
          topFilesLength: 0,
          showLineNumbers: true,
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
          customPatterns: [],
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
): Promise<readonly string[]> {
  const byEntityId = new Map(changes.map((change) => [change.entityId, change.filePath]));
  const paths = contexts.flatMap((context) => context.filePath ?? byEntityId.get(context.entityId) ?? []);
  const safePaths = [...new Set(paths)].filter(isSafeRelativeFilePath);
  const selected = [];
  let totalBytes = 0;
  for (const filePath of safePaths) {
    const bytes = await fileSize(cwd, filePath);
    if (bytes === null || bytes > MAX_PACK_FILE_SIZE_BYTES) continue;
    if (totalBytes + bytes > MAX_PACK_TOTAL_SIZE_BYTES) continue;
    totalBytes += bytes;
    selected.push(filePath);
  }
  return selected;
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
