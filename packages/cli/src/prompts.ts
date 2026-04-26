import type { CandidateContext, DiffBatch, StupifyCheck } from "./types.ts";

export function scoutPrompt(batch: DiffBatch, checks: readonly StupifyCheck[], sourceLabel: string): string {
  return `You are Stupify's fast search step.
Keep an eye out for the following antipatterns in this git diff batch.
Your job is only to point at candidate hunks for a later audit.
Return pointer-only JSON.
No explanations.

Return JSON only:
{
  "candidates": ["batch-001:file-002:hunk-001"]
}

Rules:
- Use POINTER values exactly as shown.
- Return at most 3 candidates.
- If a batch looks clean, return { "candidates": [] }.
- Prefer catching subtle possible issues over being quiet.
- Added exported types, payloads, mappers, helpers, wrappers, or boundaries are worth pointing at when they resemble an enabled check.
- For duplicated_schema, include hunks that add both a local type/payload/schema and a function that maps fields from an imported typed input.
- When related hunks appear together, prefer the hunk where the new shape, mapper, wrapper, or boundary is defined over a hunk that only uses it.

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
  return `You are Stupify's audit step.
Stupify checks whether recent code changes show signs that AI replaced engineering judgment with plausible code.
You will receive candidate diff regions selected by a local search step.
Report subtle issues when the pattern is visible in the candidate region.
Clean candidates can be omitted.

Return JSON only:
{
  "findings": [
    {
      "checkId": "duplicated_schema",
      "why": "one sentence",
      "proof": "batch-001:file-002:hunk-001"
    }
  ],
  "summary": "one short sentence"
}

Rules:
- Use only the checks listed below.
- proof must be one exact POINTER value from the candidate regions.
- proof should point to the hunk containing the duplicated shape, mapper, wrapper, or boundary, not merely a usage site.
- why should describe why the check matched.
- why should not quote source code or name identifiers.
- Use generic phrases like "local payload type", "mapper", and "input result shape" instead of type or function names.
- Ignore-when examples are reasons to omit a finding, not finding explanations.
- Findings should describe the suspicious structure only.
- If a candidate is fine, omit it.
- If there are no findings, return { "findings": [], "summary": "No clear judgment-offload signal found." }.

Allowed proof pointers:
${contexts.map((context) => `- ${context.pointer}`).join("\n")}

${formatFullChecks(checks)}

SOURCE:
${sourceLabel}

CANDIDATE REGIONS:
${contexts.map(formatContext).join("\n\n")}`;
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
