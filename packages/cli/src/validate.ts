import type {
  CheckId,
  DiffBatch,
  Finding,
  FindingCandidate,
  FindingsResult,
  NetDiff,
  SemCandidate,
  SemChangeSet,
  SemContext,
  SourceId,
  StupifyCheck,
} from "./types.ts";

type ScoutResult = Readonly<{
  candidates: readonly string[];
}>;

type AuditResult = Readonly<{
  findings: readonly FindingCandidate[];
  summary: string;
}>;

type SemScoutCandidate = Readonly<{
  entityId: string;
  checkIds: readonly string[];
}>;

type SemScoutResult = Readonly<{
  candidates: readonly SemScoutCandidate[];
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

export function validateSemScoutResult(
  value: unknown,
  changeSet: SemChangeSet,
  checks: readonly StupifyCheck[],
  maxCandidates: number,
): readonly SemCandidate[] {
  if (!isSemScoutResult(value)) return [];
  const validEntities = new Set(changeSet.changes.map((change) => change.entityId));
  const checkIds = new Map<string, CheckId>(checks.map((check) => [check.id, check.id]));
  const seen = new Set<string>();
  return value.candidates.flatMap((candidate): readonly SemCandidate[] => {
    const entityId = normalizeProof(candidate.entityId);
    if (seen.has(entityId) || !validEntities.has(entityId)) return [];
    const candidateCheckIds = candidate.checkIds.flatMap((id) => {
      const checkId = checkIds.get(id);
      return checkId ? [checkId] : [];
    });
    if (candidateCheckIds.length === 0) return [];
    seen.add(entityId);
    return [{
      sourceId: changeSet.id,
      entityId,
      checkIds: candidateCheckIds,
    }];
  }).slice(0, maxCandidates);
}

export function validateSemAuditResult(
  value: unknown,
  sourceId: SourceId,
  checks: readonly StupifyCheck[],
  contexts: readonly SemContext[],
): FindingsResult {
  if (!isAuditResult(value)) throw new Error("Model returned invalid sem audit JSON.");
  const checkIds = new Map<string, StupifyCheck["id"]>(checks.map((check) => [check.id, check.id]));
  const validProofs = new Set(contexts.map((context) => context.entityId));
  const findings = value.findings.flatMap((finding): Finding[] => {
    const checkId = checkIds.get(finding.checkId) ?? soleCheckId(checks);
    const proof = normalizeProof(finding.proof);
    if (!checkId || !finding.why.trim() || !validProofs.has(proof)) return [];
    return [{ sourceId, checkId, why: finding.why.trim(), proof }];
  });
  return { findings, summary: value.summary.trim() };
}

function normalizeProof(value: string): string {
  return value.trim().replace(/^POINTER\s+/, "");
}

function soleCheckId(checks: readonly StupifyCheck[]): CheckId | null {
  return checks.length === 1 ? checks[0].id : null;
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

function isSemScoutResult(value: unknown): value is SemScoutResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.candidates) && record.candidates.every(isSemScoutCandidate);
}

function isSemScoutCandidate(value: unknown): value is SemScoutCandidate {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.entityId === "string" &&
    Array.isArray(record.checkIds) &&
    record.checkIds.every((item) => typeof item === "string")
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
