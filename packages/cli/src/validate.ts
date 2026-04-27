import type {
  CheckId,
  DiffBatch,
  AuditReviewResult,
  AuditReviewStats,
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

type SemFindingReview = Readonly<{
  candidateId: string;
  checkId: string;
  why: string;
  proof: string;
}>;

type SemUncertainReview = Readonly<{
  candidateId: string;
  checkId: string;
  why: string;
}>;

type SemAuditReviewResult = Readonly<{
  findings?: readonly SemFindingReview[];
  uncertain?: readonly SemUncertainReview[];
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
): AuditReviewResult {
  if (!isSemAuditReviewResult(value)) throw new Error("Model returned invalid sem audit JSON.");
  const checkIds = new Map<string, StupifyCheck["id"]>(checks.map((check) => [check.id, check.id]));
  const contextsByCandidateId = new Map(contexts.map((context) => [context.candidateId, context]));
  const expectedPairs = new Set(contexts.flatMap((context) =>
    context.checkIds.map((checkId) => reviewKey(context.candidateId, checkId))
  ));
  const seen = new Set<string>();
  const findings: Finding[] = [];
  const stats: MutableAuditReviewStats = {
    totalTargets: expectedPairs.size,
    finding: 0,
    clean: 0,
    uncertain: 0,
    invalid: 0,
  };

  for (const review of value.findings ?? []) {
    const target = validReviewTarget(review, contextsByCandidateId, checkIds, seen);
    if (!target) {
      stats.invalid += 1;
      continue;
    }
    const why = review.why.trim();
    const proof = review.proof.trim();
    if (
      !why ||
      why.length > 240 ||
      !proof ||
      proof.length > 120 ||
      startsWithNegativeFindingLanguage(why)
    ) {
      stats.invalid += 1;
      continue;
    }
    seen.add(target.key);
    stats.finding += 1;
    findings.push({ sourceId, checkId: target.checkId, why, proof });
  }

  for (const review of value.uncertain ?? []) {
    const target = validReviewTarget(review, contextsByCandidateId, checkIds, seen);
    if (!target) {
      stats.invalid += 1;
      continue;
    }
    const why = review.why.trim();
    if (!why || why.length > 240) {
      stats.invalid += 1;
      continue;
    }
    seen.add(target.key);
    stats.uncertain += 1;
  }

  stats.clean = Math.max(0, stats.totalTargets - stats.finding - stats.uncertain);
  return {
    findings,
    summary: findings.length === 0
      ? "No clear judgment-offload signal found."
      : `${findings.length} finding review${findings.length === 1 ? "" : "s"} accepted.`,
    stats,
  };
}

function normalizeProof(value: string): string {
  return value.trim().replace(/^POINTER\s+/, "");
}

function isScoutResult(value: unknown): value is ScoutResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.candidates) && record.candidates.every((item) => typeof item === "string");
}

function isSemAuditReviewResult(value: unknown): value is SemAuditReviewResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    optionalArray(record.findings, isSemFindingReview) &&
    optionalArray(record.uncertain, isSemUncertainReview)
  );
}

function isSemFindingReview(value: unknown): value is SemFindingReview {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.candidateId === "string" &&
    typeof record.checkId === "string" &&
    typeof record.why === "string" &&
    typeof record.proof === "string"
  );
}

function isSemUncertainReview(value: unknown): value is SemUncertainReview {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.candidateId === "string" &&
    typeof record.checkId === "string" &&
    typeof record.why === "string"
  );
}

function optionalArray<T>(value: unknown, guard: (item: unknown) => item is T): boolean {
  return value === undefined || (Array.isArray(value) && value.every(guard));
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

type MutableAuditReviewStats = {
  -readonly [Key in keyof AuditReviewStats]: AuditReviewStats[Key];
};

function reviewKey(candidateId: string, checkId: string): string {
  return `${candidateId}\u0000${checkId}`;
}

function startsWithNegativeFindingLanguage(value: string): boolean {
  return /^(no evidence|no issue|does not appear|not enough evidence|insufficient evidence|clean)\b/i.test(value.trim());
}

function validReviewTarget(
  review: Pick<SemFindingReview, "candidateId" | "checkId">,
  contextsByCandidateId: ReadonlyMap<string, SemContext>,
  checkIds: ReadonlyMap<string, CheckId>,
  seen: ReadonlySet<string>,
): Readonly<{ checkId: CheckId; key: string }> | null {
  const candidateId = normalizeProof(review.candidateId);
  const context = contextsByCandidateId.get(candidateId);
  const checkId = checkIds.get(review.checkId);
  const key = reviewKey(candidateId, review.checkId);
  if (!context || !checkId || !context.checkIds.includes(checkId) || seen.has(key)) return null;
  return { checkId, key };
}
