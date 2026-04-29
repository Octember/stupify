import { searchImplForLanguage, sourceLanguageForPath } from "../source-languages.ts";
import type { AiSlopCheck, SemChangeSet, SemContext, SemContextPack } from "../core/types.ts";

export function searchPrompt(input: Readonly<{
  changeSet: SemChangeSet;
  contexts: readonly SemContext[];
  pack: SemContextPack;
  patterns: readonly AiSlopCheck[];
  includeCounterReason: boolean;
}>): string {
  return `You are Stupify's local search model.
Stupify checks whether AI-assisted coding may be replacing developer judgment.
You will receive:
1. Semantic changed entities selected by a fast local counter.
2. Compressed local file context from Repomix.
3. A list of search targets. Each target has exactly one assigned pattern.

Your job:
Evaluate each target only against its assigned pattern.
False positives are expensive.
Only emit a match if the assigned pattern clearly applies to that exact target.
Do not perform general code review.
Do not suggest improvements.
Do not choose a pattern.
Do not apply other patterns.
Do not report issues for unlisted targets.
Do not emit clean results.
Omitted target = clean.
Return JSON only:
{
  "matches": [
    {
      "targetId": "t001",
      "reason": "one sentence",
      "proof": "short pointer"
    }
  ]
}

Rules:
- Use only targetIds from the input.
- Emit at most 5 matches.
- Prefer omission over a weak match.
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

SOURCE:
${input.changeSet.label}

SEARCH TARGETS:
${input.contexts.map((context) => formatSearchTarget(context, patternForContext(context, input.patterns), input.includeCounterReason)).join("\n\n") || "(none)"}

REPOMIX CONTEXT (${input.pack.filePaths.length} files, ${input.pack.totalTokens} tokens):
${input.pack.text || "(none)"}`;
}

function formatSearchPattern(check: AiSlopCheck, context: SemContext): string {
  const language = context.filePath ? sourceLanguageForPath(context.filePath) : null;
  const search = searchImplForLanguage(check, language?.id ?? null);
  return `Pattern: ${check.id} (${check.name})
Why this matters: ${check.why}
Question: ${search.prompt ?? check.question}
Look for:
${(search.lookFor ?? check.lookFor).map((signal) => `- ${signal}`).join("\n")}
Ignore when:
${(search.ignoreWhen ?? check.ignoreWhen).map((signal) => `- ${signal}`).join("\n")}
Match examples:
${(search.examples?.match ?? check.examples?.match ?? []).map((example) => `- ${example}`).join("\n")}
Non-match examples:
${(search.examples?.nonMatch ?? check.examples?.noMatch ?? []).map((example) => `- ${example}`).join("\n")}`;
}

function formatSearchTarget(context: SemContext, pattern: AiSlopCheck, includeCounterReason: boolean): string {
  return `TARGET ${context.targetId}
ASSIGNED ${formatSearchPattern(pattern, context)}
SEM TARGET:
ENTITY ${context.entityId}
NAME ${context.entityName}
KIND ${context.entityKind}
CHANGE ${context.changeKind}
FILE ${context.filePath ?? "(unknown)"}
${includeCounterReason ? `COUNTER_REASON ${context.reason}` : ""}`.trim();
}

function patternForContext(context: SemContext, patterns: readonly AiSlopCheck[]): AiSlopCheck {
  return patterns.find((pattern) => pattern.id === context.checkId) ?? {
    id: context.checkId,
    name: context.checkId,
    question: `Does this target match ${context.checkId}?`,
    why: "This pattern may indicate judgment-offload.",
    lookFor: [],
    ignoreWhen: [],
  };
}
