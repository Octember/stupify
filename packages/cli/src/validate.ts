import type { Finding, FindingsCandidate, FindingsResult, ModelInput, StupifyCheck } from "./types.ts";

export function validateFindingsResult(
  result: FindingsCandidate,
  checks: readonly StupifyCheck[],
  input: ModelInput,
): FindingsResult {
  const checkIds = new Map<string, StupifyCheck["id"]>(checks.map((check) => [check.id, check.id]));
  const sourceIds = new Map<string, ModelInput["artifacts"][number]["id"]>(
    input.artifacts.map((artifact) => [artifact.id, artifact.id]),
  );
  const fallbackSourceId = input.artifacts.length === 1 ? input.artifacts[0].id : null;

  return {
    findings: result.findings
      .flatMap((finding): Finding[] => {
        const checkId = checkIds.get(finding.checkId);
        const sourceId = sourceIds.get(finding.sourceId) ?? fallbackSourceId;
        if (!checkId || !sourceId) return [];
        return [{ sourceId, checkId, why: finding.why, proof: finding.proof }];
      })
      .slice(0, 5),
  };
}
