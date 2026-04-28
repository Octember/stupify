import { stdin as input } from "node:process";

export async function readDiffFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) throw new Error("No diff received on stdin.");
  return text;
}
