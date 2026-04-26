import type { DiffPack, Finding, FindingsResult, StupifyCheck } from "./types.ts";

export function isFindingsResult(value: unknown): value is FindingsResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.findings) && record.findings.every(isFinding);
}

export function sanitizeFindingsResult(
  result: FindingsResult,
  checks: readonly StupifyCheck[],
  pack: DiffPack,
): FindingsResult {
  const checkIds = new Set(checks.map((check) => check.id));
  const sourceIds = new Set(pack.units.map((unit) => unit.id));
  return {
    findings: result.findings
      .filter((finding) => checkIds.has(finding.checkId) && sourceIds.has(finding.sourceId))
      .slice(0, 5)
      .map(sanitizeFinding),
  };
}

function isFinding(value: unknown): value is Finding {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.checkId === "string" &&
    typeof record.sourceId === "string" &&
    typeof record.score === "number" &&
    typeof record.confidence === "number" &&
    typeof record.why === "string" &&
    typeof record.proof === "string"
  );
}

function sanitizeFinding(finding: Finding): Finding {
  return {
    sourceId: finding.sourceId,
    checkId: finding.checkId,
    score: Math.max(0, Math.min(10, Math.round(finding.score))),
    confidence: Math.max(0, Math.min(1, Number(finding.confidence.toFixed(2)))),
    why: sanitizeSentence(finding.why),
    proof: sanitizeProof(finding.proof),
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
