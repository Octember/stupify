import { stdin as input } from "node:process";
import { sourceId, type ChangeArtifact } from "./types.ts";

export async function artifactFromStdinDiff(): Promise<ChangeArtifact> {
  const raw = await readStdin();
  if (!raw.trim()) throw new Error("No diff received on stdin.");
  return {
    id: sourceId("stdin"),
    label: "stdin",
    text: `DIFF:
${labelHunks(raw)}`,
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function labelHunks(diff: string): string {
  let hunkCount = 0;
  return diff
    .split(/\r?\n/)
    .map((line) => {
      if (!line.startsWith("@@ ")) return line;
      hunkCount += 1;
      return `[hunk-${hunkCount}]\n${line}`;
    })
    .join("\n");
}
