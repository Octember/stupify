import type { DiffBatch, Finding, FindingCandidate, FindingsResult, NetDiff, StupifyCheck } from "./types.ts";

type ScoutResult = Readonly<{
  candidates: readonly string[];
}>;

type AuditResult = Readonly<{
  findings: readonly FindingCandidate[];
  summary: string;
}>;

export function validateScoutResult(value: unknown, batch: DiffBatch): readonly string[] {
  if (!isScoutResult(value)) return [];
  const validPointers = new Set(batch.hunks.map((hunk) => hunk.pointer));
  return [...new Set(value.candidates)].filter((pointer) => validPointers.has(pointer));
}

export function validateAuditResult(
  value: unknown,
  diff: NetDiff,
  checks: readonly StupifyCheck[],
  proofPointers: readonly string[],
): FindingsResult {
  if (!isAuditResult(value)) throw new Error("Model returned invalid audit JSON.");
  const checkIds = new Map<string, StupifyCheck["id"]>(checks.map((check) => [check.id, check.id]));
  const validProofs = new Set(proofPointers);
  const findings = value.findings.flatMap((finding): Finding[] => {
    const checkId = checkIds.get(finding.checkId);
    const proof = normalizeProof(finding.proof);
    if (!checkId || !finding.why.trim() || !validProofs.has(proof)) return [];
    return [{ sourceId: diff.id, checkId, why: finding.why.trim(), proof }];
  });
  return { findings, summary: value.summary.trim() };
}

function normalizeProof(value: string): string {
  return value.trim().replace(/^POINTER\s+/, "");
}

function isScoutResult(value: unknown): value is ScoutResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.candidates) && record.candidates.every((item) => typeof item === "string");
}

function isAuditResult(value: unknown): value is AuditResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.findings) &&
    record.findings.every(isFindingCandidate) &&
    typeof record.summary === "string"
  );
}

function isFindingCandidate(value: unknown): value is FindingCandidate {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.checkId === "string" &&
    typeof record.why === "string" &&
    typeof record.proof === "string"
  );
}
