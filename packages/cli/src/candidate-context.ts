import { allHunks } from "./batcher.ts";
import type { CandidateContext, DiffBatch, DiffHunk } from "./types.ts";

const MAX_CONTEXT_LINES = 80;

export function candidateContexts(
  batches: readonly DiffBatch[],
  candidatePointers: readonly string[],
): readonly CandidateContext[] {
  const hunks = allHunks(batches);
  const byPointer = new Map(hunks.map((hunk) => [hunk.pointer, hunk]));
  const uniquePointers = [...new Set(candidatePointers)]
    .sort((left, right) => hunkPriority(byPointer.get(right)) - hunkPriority(byPointer.get(left)));

  return uniquePointers.flatMap((pointer) => {
    const hunk = byPointer.get(pointer);
    if (!hunk) return [];
    return [{ pointer, text: formatHunk(hunk) }];
  });
}

function formatHunk(hunk: DiffHunk): string {
  return `PATH ${hunk.filePath}
${shorten(hunk.text)}`;
}

function shorten(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= MAX_CONTEXT_LINES) return text;
  return `${lines.slice(0, MAX_CONTEXT_LINES).join("\n")}
[stupify: hunk shortened after ${MAX_CONTEXT_LINES} lines]`;
}

function hunkPriority(hunk: DiffHunk | undefined): number {
  if (!hunk) return 0;
  const text = hunk.text;
  let priority = 0;
  if (/^\+export\s+type\s|\+export\s+interface\s|\+type\s|\+interface\s/m.test(text)) priority += 3;
  if (/^\+export\s+function\s|\+function\s/m.test(text)) priority += 2;
  if (/\.map\(|=>\s*\(\{|=>\s*\{/m.test(text)) priority += 2;
  if (/payload|schema|dto|response|result/i.test(text)) priority += 1;
  return priority;
}
