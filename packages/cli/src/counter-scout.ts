import type { CheckId, SemCandidate, SemChange, SemChangeSet, StupifyCheck } from "./types.ts";

type Signal = Readonly<{
  checkId: CheckId;
  entityId: string;
  reasonCode: string;
}>;

type SignalBucket = Readonly<{
  checkId: CheckId;
  total: number;
  examples: readonly Signal[];
}>;

const MAX_COUNTER_EXAMPLES_PER_CHECK = 4;

export function counterScoutTargets(
  changeSet: SemChangeSet,
  checks: readonly StupifyCheck[],
  maxTargets: number,
): readonly SemCandidate[] {
  const buckets = runSignalCounters(changeSet, checks);
  const targets: SemCandidate[] = [];
  let cursor = 0;
  while (targets.length < maxTargets && buckets.some((bucket) => cursor < bucket.examples.length)) {
    for (const bucket of buckets) {
      const signal = bucket.examples[cursor];
      if (!signal) continue;
      targets.push({
        sourceId: changeSet.id,
        targetId: `t${String(targets.length + 1).padStart(3, "0")}`,
        entityId: signal.entityId,
        checkId: signal.checkId,
        reason: signal.reasonCode,
      });
      if (targets.length >= maxTargets) break;
    }
    cursor += 1;
  }
  return targets;
}

export function runSignalCounters(
  changeSet: SemChangeSet,
  checks: readonly StupifyCheck[],
): readonly SignalBucket[] {
  return checks
    .map((check) => {
      const signals = changeSet.changes.flatMap((change): readonly Signal[] => {
        const reasonCode = reasonForCheck(check.id, change);
        return reasonCode ? [{ checkId: check.id, entityId: change.entityId, reasonCode }] : [];
      });
      return {
        checkId: check.id,
        total: signals.length,
        examples: signals.slice(0, MAX_COUNTER_EXAMPLES_PER_CHECK),
      };
    })
    .filter((bucket) => bucket.total > 0);
}

function reasonForCheck(checkId: CheckId, change: SemChange): string | null {
  const haystack = `${change.entityName}\n${change.entityType}\n${change.filePath}\n${change.afterContent ?? ""}`.toLowerCase();
  const changed = change.changeType === "added" || change.changeType === "modified";
  if (!changed) return null;

  switch (checkId as string) {
    case "duplicated_schema":
      return isSchemaish(change, haystack) ? "schemaish_type_or_payload" : null;
    case "unnecessary_complexity":
      return /\b(helper|wrapper|service|provider|manager|factory|adapter|resolver|coordinator)\b/i.test(change.entityName)
        ? "new_abstraction_name"
        : null;
    case "fake_precision_windowing":
      return /\b(token|budget|window|batch|ratio|estimate|counter|count|limit)\b/i.test(haystack)
        ? "precision_accounting_terms"
        : null;
    case "coauthored_slop":
      return /\b(coauhtoried|coauthored|co-authored|co-authored-by)\b/i.test(haystack)
        ? "coauthor_text"
        : null;
    case "mega_file":
      return change.entityType === "chunk" && /lines\s+\d+-\d+/i.test(change.entityName)
        ? "large_changed_chunk"
        : null;
    case "over_commenting":
      return commentLines(change.afterContent) > commentLines(change.beforeContent) + 3
        ? "comment_lines_increased"
        : null;
    case "lint_bypass":
      return /(eslint-disable|biome-ignore|@ts-ignore|@ts-expect-error|\bas unknown as\b|\bany\b)/i.test(change.afterContent ?? "")
        ? "lint_or_type_bypass_text"
        : null;
    case "inconsistent_patterns":
      return /\b(manager|factory|provider|adapter|orchestrator|coordinator)\b/i.test(change.entityName)
        ? "pattern_abstraction_name"
        : null;
    case "reinvented_utils":
      return /^(format|parse|normalize|group|sort|filter|find|has|get|set|is|resolve|clamp|slug)/i.test(change.entityName)
        ? "generic_utility_name"
        : null;
    case "operator_style_mismatch":
      return /\b(manager|factory|provider|enterprise|orchestrator)\b/i.test(haystack)
        ? "style_smell_terms"
        : null;
    default:
      return null;
  }
}

function isSchemaish(change: SemChange, haystack: string): boolean {
  if (/^(interface|type|class)$/i.test(change.entityType)) return true;
  return /\b(payload|dto|schema|response|request|input|output|result|context|asset|job|node|edge|generation)\b/i.test(haystack);
}

function commentLines(value: string | null): number {
  if (!value) return 0;
  return value.split(/\r?\n/).filter((line) => /^\s*(\/\/|\/\*|\*|#)/.test(line)).length;
}
