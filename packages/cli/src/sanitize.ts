import type { Judgment } from "./types.js";

export function isJudgment(value: unknown): value is Judgment {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.score === "number" &&
    typeof record.why === "string" &&
    typeof record.proof === "string" &&
    typeof record.confidence === "number"
  );
}

export function sanitizeJudgment(judgment: Judgment): Judgment {
  return {
    score: Math.max(0, Math.min(10, Math.round(judgment.score))),
    why: sanitizeSentence(judgment.why),
    proof: sanitizeProof(judgment.proof),
    confidence: Math.max(0, Math.min(1, Number(judgment.confidence.toFixed(2)))),
  };
}

function sanitizeSentence(value: string): string {
  const scrubbed = value
    .replace(/`[^`]*`/g, "a specific implementation detail")
    .replace(/"[^"]*"/g, "a quoted detail")
    .replace(/'[^']*'/g, "a quoted detail")
    .replace(/\b[A-Za-z_$][A-Za-z0-9_$]{24,}\b/g, "implementation detail")
    .replace(/\b[A-Z][A-Za-z0-9]*(?:[A-Z][a-z0-9]+){2,}\b/g, "implementation detail")
    .replace(/\s+/g, " ")
    .trim();

  return scrubbed.match(/[^.!?]+[.!?]*/)?.[0]?.trim() || "No strong signal.";
}

function sanitizeProof(value: string): string {
  const match = /\bhunk-\d+\b/i.exec(value);
  return match?.[0].toLowerCase() ?? "hunk-1";
}
