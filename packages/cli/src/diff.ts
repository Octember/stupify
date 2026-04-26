import { stdin as input } from "node:process";
import type { DiffInput } from "./types.ts";

export async function readDiffFromStdin(): Promise<DiffInput> {
  const raw = await readStdin();
  if (!raw.trim()) throw new Error("No diff received on stdin.");
  return prepareDiff(raw);
}

export function prepareDiff(raw: string, commitMessage?: string): DiffInput {
  const labeled = labelHunks(raw);
  return {
    commitMessage,
    text: labeled.text,
    hunkCount: labeled.hunkCount,
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function labelHunks(diff: string): { text: string; hunkCount: number } {
  let hunkCount = 0;
  const text = diff
    .split(/\r?\n/)
    .map((line) => {
      if (!line.startsWith("@@ ")) return line;
      hunkCount += 1;
      return `[hunk-${hunkCount}]\n${line}`;
    })
    .join("\n");

  return { text, hunkCount };
}
