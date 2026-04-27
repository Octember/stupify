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
  type ParseState = Readonly<{
    hunks: readonly ParsedHunk[];
    filePath: string;
    fileIndex: number;
    hunkIndex: number;
    fileHeader: readonly string[];
    hunkLines: readonly string[] | null;
  }>;

  const lines = diff.split(/\r?\n/);

  const initialState: ParseState = {
    hunks: [],
    filePath: "unknown",
    fileIndex: 0,
    hunkIndex: 0,
    fileHeader: [],
    hunkLines: null,
  };

  const finalState = lines.reduce<ParseState>((state, line) => {
    const fileMatch = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (fileMatch) {
      const flushed = flush(state);
      return {
        ...flushed,
        fileIndex: flushed.fileIndex + 1,
        hunkIndex: 0,
        filePath: fileMatch[1],
        fileHeader: [line],
        hunkLines: null,
      };
    }

    if (line.startsWith("@@ ")) {
      const flushed = flush(state);
      return {
        ...flushed,
        hunkIndex: flushed.hunkIndex + 1,
        hunkLines: [...flushed.fileHeader, line],
      };
    }

    if (state.hunkLines) return { ...state, hunkLines: [...state.hunkLines, line] };
    if (state.fileHeader.length > 0) return { ...state, fileHeader: [...state.fileHeader, line] };
    return state;
  }, initialState);

  return flush(finalState).hunks;

  function flush(state: ParseState): ParseState {
    if (!state.hunkLines) return state;
    const fileId = `file-${pad(state.fileIndex)}`;
    const hunkId = `hunk-${pad(state.hunkIndex)}`;
    const text = state.hunkLines.join("\n").trimEnd();
    const nextHunk: ParsedHunk = {
      fileId,
      hunkId,
      filePath: state.filePath,
      text,
      lineCount: countLines(text),
    };

    return { ...state, hunks: [...state.hunks, nextHunk], hunkLines: null };
  }
}

function splitLargeHunk(
  hunk: ParsedHunk,
  linesPerBatch: number,
): readonly ParsedHunk[] {
  if (hunk.lineCount <= linesPerBatch) return [hunk];
  const lines = hunk.text.split(/\r?\n/);
  const chunkCount = Math.ceil(lines.length / linesPerBatch);
  return Array.from({ length: chunkCount }, (_, chunkIndex) => {
    const start = chunkIndex * linesPerBatch;
    const text = lines.slice(start, start + linesPerBatch).join("\n");
    return {
      ...hunk,
      hunkId: `${hunk.hunkId}-part-${pad(chunkIndex + 1)}`,
      text,
      lineCount: countLines(text),
    };
  });
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
