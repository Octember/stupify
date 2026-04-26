import type { DiffBatch, DiffHunk } from "./types.ts";

const DEFAULT_BATCH_LINES = 1_000;

type ParsedHunk = Readonly<{
  fileId: string;
  hunkId: string;
  filePath: string;
  text: string;
  lineCount: number;
}>;

export function batchDiff(
  diff: string,
  linesPerBatch = DEFAULT_BATCH_LINES,
): readonly DiffBatch[] {
  const hunks = parseHunks(diff).flatMap((item) =>
    splitLargeHunk(item, linesPerBatch),
  );

  type BatchState = Readonly<{
    batches: readonly DiffBatch[];
    current: readonly DiffHunk[];
    currentLines: number;
    batchNumber: number;
  }>;

  const initialState: BatchState = {
    batches: [],
    current: [],
    currentLines: 0,
    batchNumber: 1,
  };

  const finalized = hunks.reduce<BatchState>((state, hunk) => {
    const needsFlush =
      state.current.length > 0 &&
      state.currentLines + hunk.lineCount > linesPerBatch;

    const flushed = needsFlush ? flush(state) : state;
    return {
      ...flushed,
      current: [...flushed.current, toDiffHunk(hunk, flushed.batchNumber)],
      currentLines: flushed.currentLines + hunk.lineCount,
    };
  }, initialState);

  return finalized.current.length > 0
    ? [...finalized.batches, toBatch(finalized.batchNumber, finalized.current)]
    : finalized.batches;

  function flush(state: BatchState): BatchState {
    return {
      batches: [...state.batches, toBatch(state.batchNumber, state.current)],
      current: [],
      currentLines: 0,
      batchNumber: state.batchNumber + 1,
    };
  }
}

export function allHunks(batches: readonly DiffBatch[]): readonly DiffHunk[] {
  return batches.flatMap((batch) => batch.hunks);
}

function parseHunks(diff: string): readonly ParsedHunk[] {
  const hunks: ParsedHunk[] = [];
  const lines = diff.split(/\r?\n/);
  let filePath = "unknown";
  let fileIndex = 0;
  let hunkIndex = 0;
  let fileHeader: string[] = [];
  let hunkLines: string[] | null = null;

  for (const line of lines) {
    const fileMatch = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (fileMatch) {
      flushHunk();
      fileIndex += 1;
      hunkIndex = 0;
      filePath = fileMatch[1];
      fileHeader = [line];
      continue;
    }

    if (line.startsWith("@@ ")) {
      flushHunk();
      hunkIndex += 1;
      hunkLines = [...fileHeader, line];
      continue;
    }

    if (hunkLines) hunkLines.push(line);
    else if (fileHeader.length > 0) fileHeader.push(line);
  }

  flushHunk();
  return hunks;

  function flushHunk(): void {
    if (!hunkLines) return;
    const fileId = `file-${pad(fileIndex)}`;
    const hunkId = `hunk-${pad(hunkIndex)}`;
    const text = hunkLines.join("\n").trimEnd();
    hunks.push({ fileId, hunkId, filePath, text, lineCount: countLines(text) });
    hunkLines = null;
  }
}

function splitLargeHunk(
  hunk: ParsedHunk,
  linesPerBatch: number,
): readonly ParsedHunk[] {
  if (hunk.lineCount <= linesPerBatch) return [hunk];
  const lines = hunk.text.split(/\r?\n/);
  const chunks: ParsedHunk[] = [];
  for (let index = 0; index < lines.length; index += linesPerBatch) {
    const text = lines.slice(index, index + linesPerBatch).join("\n");
    chunks.push({
      ...hunk,
      hunkId: `${hunk.hunkId}-part-${pad(chunks.length + 1)}`,
      text,
      lineCount: countLines(text),
    });
  }
  return chunks;
}

function toDiffHunk(hunk: ParsedHunk, batchNumber: number): DiffHunk {
  const batchId = `batch-${pad(batchNumber)}`;
  return {
    ...hunk,
    batchId,
    pointer: `${batchId}:${hunk.fileId}:${hunk.hunkId}`,
  };
}

function toBatch(batchNumber: number, hunks: readonly DiffHunk[]): DiffBatch {
  const id = `batch-${pad(batchNumber)}`;
  return {
    id,
    hunks,
    text: hunks.map(formatHunkForSearch).join("\n\n"),
  };
}

function formatHunkForSearch(hunk: DiffHunk): string {
  return `POINTER ${hunk.pointer}
FILE ${hunk.fileId}
PATH ${hunk.filePath}
${searchView(hunk.text)}`;
}

function searchView(text: string): string {
  return text
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.startsWith("diff --git ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("@@ ") ||
        (line.startsWith("+") && !line.startsWith("+++")),
    )
    .join("\n");
}

function countLines(value: string): number {
  return value.length === 0 ? 0 : value.split(/\r?\n/).length;
}

function pad(value: number): string {
  return String(value).padStart(3, "0");
}
