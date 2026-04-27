import type {
  AuditPromptName,
  CandidateContext,
  DiffBatch,
  SemChangeSet,
  SemContext,
  SemContextPack,
  StupifyCheck,
} from "./types.ts";

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
  return `Pick changed entity/check targets worth auditing.
Return JSON only:
{ "targets": [{ "entityId": "exact entityId", "checkId": "check_id", "reason": "short scout reason" }] }

Rules:
- Use entityId values exactly as shown.
- Each target has exactly one checkId.
- Return at most ${maxCandidates} targets.
- Return { "targets": [] } if clean.
- Pick definitions over usage sites.
- Prefer high recall, but do not attach unrelated checks.

${formatCompactChecks(checks)}

SOURCE:
${changeSet.label}

SEM CHANGE SUMMARY:
${JSON.stringify(changeSet.summary, null, 2)}

SEM ENTITY CHANGES:
${changeSet.changes.map(formatSemChange).join("\n\n")}`;
}

export function findingsAuditPrompt(
  contexts: readonly SemContext[],
  pack: SemContextPack,
  checks: readonly StupifyCheck[],
  sourceLabel: string,
  promptName: AuditPromptName,
): string {
  const task =
    promptName === "high_bar"
      ? `You are Stupify's audit model.
You are reviewing candidate/check targets for signs that AI-assisted coding may have replaced engineering judgment.
Only emit a finding if it is clearly useful to a developer.
A useful finding must:
- match the target's check exactly
- point to a concrete change pattern
- explain why the change may reflect judgment-offload
- avoid generic code-review commentary
If the target is normal engineering work, omit it.
If the target is merely plausible but not strong, omit it.
If the target does not exactly match its assigned check, omit it.`
      : `You are Stupify's auditor.
Audit only the listed target/check pairs.
Emit only exceptions.`;

  const highBarRules =
    promptName === "high_bar"
      ? `- Prefer clean over weak.
- Prefer no finding over generic finding.
- Do not emit style feedback unless the assigned check is truly about style.
- Do not turn functional refactors into style mismatch findings.`
      : "";

  return `${task}
Return JSON only:
{
  "findings": [
    {
      "targetId": "t001",
      "why": "one sentence",
      "proof": "short pointer"
    }
  ],
  "uncertain": [
    {
      "targetId": "t002",
      "why": "one sentence"
    }
  ]
}

Rules:
- Inspect every target.
- Each target has exactly one check.
- Emit a finding only when the target clearly matches its check.
- Emit uncertain only when the target may match, but evidence is insufficient.
- If a target is clean, emit nothing for it.
- Omitted target means clean.
- Do not output clean reviews.
- Do not explain clean targets.
- Do not write "no evidence" as a finding.
- Do not put negative statements in findings.
- Prefer omission over weak findings.
- Use only provided targetIds.
- Do not search for other checks.
- Do not quote source code.
- Use packed file context only as supporting evidence for these candidate entities.
${highBarRules}

Targets:
${contexts.map((context) => formatAuditTarget(context, checks)).join("\n\n")}

SOURCE:
${sourceLabel}

CANDIDATE ENTITY DELTAS:
${contexts.map(formatSemContext).join("\n\n")}

PACKED FILE CONTEXT (${pack.provider}, ${pack.filePaths.length} files, ${pack.totalTokens} tokens):
${pack.text || "(none)"}`;
}

export function searchPrompt(
  stagedChanges: string,
  patterns: readonly StupifyCheck[],
): string {
  return `You are Stupify's local search model.
Stupify checks whether AI-assisted coding may be replacing developer judgment.
You will receive:
1. Staged code changes.
2. A small registry of search patterns.
Your job:
Search the staged changes for concrete matches to the enabled patterns.
This is a commit-hook warning system.
False positives are expensive.
Only emit a match if the pattern clearly applies.
Do not perform general code review.
Do not suggest improvements.
Do not apply patterns that are not enabled.
Do not emit clean results.
Omitted pattern = clean.
Return JSON only:
{
  "matches": [
    {
      "patternId": "string",
      "reason": "one sentence",
      "proof": "short pointer"
    }
  ]
}
Rules:
- Use only enabled pattern IDs.
- Emit at most 5 matches.
- Prefer no match over a weak match.
- Do not quote source code.
- Do not write generic feedback.
- Do not emit "no evidence" or "does not apply."
- Proof must point to concrete changed product code that implements the pattern.
- Proof must not be a file header or start with "diff --git".
- Do not use pattern registry text, prompt text, docs, tests, or examples as proof.
- Do not treat pattern or prompt wording as the code being evaluated.
- Do not treat plain conditionals, guard clauses, skip paths, or error handling as indirection.
- For unnecessary_complexity, identify the exact new named abstraction in proof.
- If unnecessary_complexity proof would only be a file, hunk, or conditional block, omit it.
- If nothing clearly matches, return { "matches": [] }.

ENABLED PATTERNS:
${patterns.map(formatSearchPattern).join("\n\n")}

STAGED CHANGES:
${stagedChanges}`;
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

function formatSearchPattern(check: StupifyCheck): string {
  return `# ${check.name}
ID: ${check.id}
${check.searchPrompt ?? check.question}
Match examples:
${(check.searchExamples?.match ?? check.examples?.match ?? []).map((example) => `- ${example}`).join("\n")}
Non-match examples:
${(check.searchExamples?.nonMatch ?? check.examples?.noMatch ?? []).map((example) => `- ${example}`).join("\n")}`;
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
  return `TARGET ${context.targetId}
ENTITY ${context.entityId}
NAME ${context.entityName}
KIND ${context.entityKind}
CHANGE ${context.changeKind}
CHECK ${context.checkId}
SCOUT_REASON ${context.reason}
CONTEXT:
${context.text}`;
}

function formatAuditTarget(context: SemContext, checks: readonly StupifyCheck[]): string {
  const check = checks.find((item) => item.id === context.checkId);
  return `- targetId=${context.targetId} checkId=${context.checkId} entityId=${context.entityId}
scoutReason=${context.reason}
${check ? formatCheck(check) : ""}`;
}

function shortenCode(value: string | null): string {
  if (!value) return "(none)";
  const lines = value.split(/\r?\n/);
  const limit = 80;
  if (lines.length <= limit) return value;
  return `${lines.slice(0, limit).join("\n")}
[stupify: sem entity content shortened after ${limit} lines]`;
}
