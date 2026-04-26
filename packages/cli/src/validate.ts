import type { Finding, FindingsResult, ModelInput, StupifyCheck } from "./types.js";

export function isFindingsResult(value: unknown): value is FindingsResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.findings) && record.findings.every(isFinding);
}

export function validateFindingsResult(
  result: FindingsResult,
  checks: readonly StupifyCheck[],
  input: ModelInput,
): FindingsResult {
  const checkIds = new Set(checks.map((check) => check.id));
  const sourceIds = new Set(input.artifacts.map((artifact) => artifact.id));
  const fallbackSourceId = input.artifacts.length === 1 ? input.artifacts[0].id : null;

  return {
    findings: result.findings
      .filter((finding) => checkIds.has(finding.checkId))
      .map((finding) => ({
        ...finding,
        sourceId: sourceIds.has(finding.sourceId) ? finding.sourceId : fallbackSourceId ?? finding.sourceId,
      }))
      .filter((finding) => sourceIds.has(finding.sourceId))
      .slice(0, 5),
  };
}

function isFinding(value: unknown): value is Finding {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.checkId === "string" &&
    typeof record.sourceId === "string" &&
    typeof record.why === "string" &&
    typeof record.proof === "string"
  );
}
