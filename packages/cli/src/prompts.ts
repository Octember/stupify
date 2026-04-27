import type { CandidateContext, DiffBatch, SemChangeSet, SemContext, SemContextPack, StupifyCheck } from "./types.ts";

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
  pack: SemContextPack,
  checks: readonly StupifyCheck[],
  sourceLabel: string,
): string {
  return `You are Stupify's auditor.
Audit candidate entities against enabled checks.
Return JSON only:
{
  "findings": [
    {
      "candidateId": "string",
      "checkId": "check_id",
      "why": "one sentence",
      "proof": "short pointer"
    }
  ],
  "uncertain": [
    {
      "candidateId": "string",
      "checkId": "check_id",
      "why": "one sentence"
    }
  ]
}

Rules:
- Inspect every candidate/check target.
- Emit a finding only when the candidate clearly matches the check.
- Emit uncertain only when the candidate may match, but evidence is insufficient.
- If a target is clean, emit nothing for it.
- Omitted target means clean.
- Do not output clean reviews.
- Do not explain clean targets.
- Do not write "no evidence" as a finding.
- Do not put negative statements in findings.
- Prefer omission over weak findings.
- Use only provided candidateIds and checkIds.
- Do not quote source code.
- Use packed file context only as supporting evidence for these candidate entities.

Candidate/check targets:
${contexts.map(formatAuditTarget).join("\n")}

${formatFullChecks(checks)}

SOURCE:
${sourceLabel}

CANDIDATE ENTITY DELTAS:
${contexts.map(formatSemContext).join("\n\n")}

PACKED FILE CONTEXT (${pack.provider}, ${pack.filePaths.length} files, ${pack.totalTokens} tokens):
${pack.text || "(none)"}`;
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
  return `CANDIDATE ${context.candidateId}
ENTITY ${context.entityId}
NAME ${context.entityName}
CHECKS ${context.checkIds.join(", ")}
CONTEXT:
${context.text}`;
}

function formatAuditTarget(context: SemContext): string {
  return context.checkIds
    .map((checkId) => `- candidateId=${context.candidateId} checkId=${checkId} entityId=${context.entityId}`)
    .join("\n");
}

function shortenCode(value: string | null): string {
  if (!value) return "(none)";
  const lines = value.split(/\r?\n/);
  const limit = 80;
  if (lines.length <= limit) return value;
  return `${lines.slice(0, limit).join("\n")}
[stupify: sem entity content shortened after ${limit} lines]`;
}
