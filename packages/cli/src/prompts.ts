import type { DiffInput } from "./types.js";

export function judgmentPrompt(diff: DiffInput): string {
  const hunkNote = diff.hunkCount > 0 ? "Use one of the provided hunk labels for proof." : "Use hunk-1 for proof.";

  return `You are Stupify.
Stupify checks whether AI may be making a developer dumber by looking at code diffs.
You will receive one git diff.
Judge only this:
Does this diff show signs that the developer may have outsourced judgment instead of using AI as a tool?
Return JSON only:
{
  "score": 0-10,
  "why": "one sentence",
  "proof": "short pointer like hunk-1 or hunk-2",
  "confidence": 0.0-1.0
}
Rules:
- Do not quote code.
- Do not include identifiers.
- Do not over-explain.
- If the diff looks fine, score low.
- ${hunkNote}

Diff:
${diff.text}`;
}
