import type { AiSlopCheck, SearchMatch, SemContext } from "../core/types.ts";

export function dedupeMatches<T extends { targetId: string; patternId: string; proof: string }>(
  matches: readonly T[],
): readonly T[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.patternId}\n${match.proof.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function withCheckWhy(
  matches: readonly SearchMatch[],
  checks: readonly AiSlopCheck[],
): readonly SearchMatch[] {
  const checksById = new Map(checks.map((check) => [check.id, check]));
  return matches.map((match) => ({
    ...match,
    patternName: checksById.get(match.patternId)?.name,
    checkWhy: checksById.get(match.patternId)?.why,
  }));
}

export function countTargetsByPattern(contexts: readonly SemContext[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const context of contexts) counts[context.checkId] = (counts[context.checkId] ?? 0) + 1;
  return counts;
}

export function previewTargets(contexts: readonly SemContext[]) {
  return contexts.map((context) => ({
    targetId: context.targetId,
    patternId: context.checkId,
    entityKind: context.entityKind || undefined,
    sourceKind: context.filePath ? pathKind(context.filePath) : undefined,
  }));
}

function pathKind(filePath: string): string {
  const ext = filePath.split(".").pop();
  return ext && ext !== filePath ? ext : "unknown";
}
