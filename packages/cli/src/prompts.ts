import type { CandidateContext, DiffBatch, SemChangeSet, SemContext, StupifyCheck } from "./types.ts";

export function scoutPrompt(batch: DiffBatch, checks: readonly StupifyCheck[], sourceLabel: string): string {
  return `Pick diff hunks that match enabled checks.
Return JSON only:
{ "candidates": ["exact POINTER"] }

Rules:
- Use POINTER values exactly as shown.
- Return at most 3 candidates.
- Return { "candidates": [] } if clean.
- Pick definitions over usage sites.

${formatCompactChecks(checks)}

SOURCE:
${sourceLabel}

DIFF BATCH ${batch.id}:
${batch.text}`;
}

export function auditPrompt(
  contexts: readonly CandidateContext[],
  checks: readonly StupifyCheck[],
  sourceLabel: string,
): string {
  return `Audit candidate diff regions against enabled checks.
Return JSON only:
{
  "findings": [{ "checkId": "check_id", "why": "one sentence", "proof": "exact POINTER" }],
  "summary": "one short sentence"
}

Rules:
- Use only checks listed below.
- checkId must be a check ID, never a POINTER.
- proof must be one exact POINTER from candidate regions.
- why describes the suspicious structure, not an identifier.
- Do not describe an issue in summary unless it is also in findings.
- If no findings, return { "findings": [], "summary": "No clear judgment-offload signal found." }.

Allowed proof pointers:
${contexts.map((context) => `- ${context.pointer}`).join("\n")}

${formatFullChecks(checks)}

SOURCE:
${sourceLabel}

CANDIDATE REGIONS:
${contexts.map(formatContext).join("\n\n")}`;
}

export function semScoutPrompt(
  changeSet: SemChangeSet,
  checks: readonly StupifyCheck[],
  maxCandidates: number,
): string {
  return `Pick changed entities that match enabled checks.
Return JSON only:
{ "candidates": [{ "entityId": "exact entityId", "checkIds": ["check_id"] }] }

Rules:
- Use entityId values exactly as shown.
- Return at most ${maxCandidates} candidates.
- Return { "candidates": [] } if clean.
- Pick definitions over usage sites.

${formatCompactChecks(checks)}

SOURCE:
${changeSet.label}

SEM CHANGE SUMMARY:
${JSON.stringify(changeSet.summary, null, 2)}

SEM ENTITY CHANGES:
${changeSet.changes.map(formatSemChange).join("\n\n")}`;
}

export function semAuditPrompt(
  contexts: readonly SemContext[],
  checks: readonly StupifyCheck[],
  sourceLabel: string,
): string {
  return `Audit candidate entity contexts against enabled checks.
Return JSON only:
{
  "findings": [{ "checkId": "check_id", "why": "one sentence", "proof": "exact entityId" }],
  "summary": "one short sentence"
}

Rules:
- Use only checks listed below.
- checkId must be a check ID, never an entityId.
- proof must be one exact entityId from candidate contexts.
- why describes the suspicious structure, not an identifier.
- Do not describe an issue in summary unless it is also in findings.
- Return every clear finding in the provided candidates.
- If no findings, return { "findings": [], "summary": "No clear judgment-offload signal found." }.

Allowed proof entity IDs:
${contexts.map((context) => `- ${context.entityId}`).join("\n")}

${formatFullChecks(checks)}

SOURCE:
${sourceLabel}

CANDIDATE ENTITY CONTEXTS:
${contexts.map(formatSemContext).join("\n\n")}`;
}

function formatCompactChecks(checks: readonly StupifyCheck[]): string {
  return `Checks:
${checks.map((check) => `- ${check.id}: ${check.lookFor.join("; ")}`).join("\n")}`;
}

function formatFullChecks(checks: readonly StupifyCheck[]): string {
  return checks.map(formatCheck).join("\n\n");
}

function formatCheck(check: StupifyCheck): string {
  return `# ${check.name}
ID: ${check.id}
Q: ${check.question}
Look for:
${check.lookFor.map((signal) => `- ${signal}`).join("\n")}
Ignore when:
${check.ignoreWhen.map((signal) => `- ${signal}`).join("\n")}
Match examples:
${(check.examples?.match ?? []).map((example) => `- ${example}`).join("\n")}
No-match examples:
${(check.examples?.noMatch ?? []).map((example) => `- ${example}`).join("\n")}`;
}

function formatContext(context: CandidateContext): string {
  return `POINTER ${context.pointer}
${context.text}`;
}

function formatSemChange(change: SemChangeSet["changes"][number]): string {
  return `ENTITY ${change.entityId}
TYPE ${change.entityType}
CHANGE ${change.changeType}
PATH ${change.filePath}`;
}

function formatSemContext(context: SemContext): string {
  return `ENTITY ${context.entityId}
NAME ${context.entityName}
CONTEXT:
${context.text}`;
}

function shortenCode(value: string | null): string {
  if (!value) return "(none)";
  const lines = value.split(/\r?\n/);
  const limit = 80;
  if (lines.length <= limit) return value;
  return `${lines.slice(0, limit).join("\n")}
[stupify: sem entity content shortened after ${limit} lines]`;
}
