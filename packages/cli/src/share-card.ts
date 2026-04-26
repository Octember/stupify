import type { FindingsResult } from "./types.js";

export type ShareCardFinding = Readonly<{
  sourceId: string;
  checkId: string;
  why: string;
  proof: string;
}>;

export type ShareCardPayload = Readonly<{
  findings: readonly ShareCardFinding[];
}>;

export function toShareCardPayload(findings: FindingsResult): ShareCardPayload {
  return {
    findings: findings.findings.map((finding) => ({
      sourceId: finding.sourceId,
      checkId: finding.checkId,
      why: finding.why,
      proof: finding.proof,
    })),
  };
}
