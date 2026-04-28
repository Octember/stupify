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
  if (!isSearchableSourceChange(change)) return null;

  const haystack = `${change.entityName}\n${change.entityType}\n${change.filePath}\n${change.afterContent ?? ""}`.toLowerCase();
  const changed = change.changeType === "added" || change.changeType === "modified";
  if (!changed) return null;

  switch (checkId as string) {
    case "duplicated_schema":
      return isDuplicatedSchemaCandidate(change) ? "local_schemaish_copy" : null;
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
      return overCommentingSignal(change)
        ? "comment_lines_increased"
        : null;
    case "lint_bypass":
      return lintBypassSignal(change.afterContent ?? "")
        ? "lint_or_type_bypass_text"
        : null;
    case "inconsistent_patterns":
      return /\b(manager|factory|provider|adapter|orchestrator|coordinator)\b/i.test(change.entityName)
        ? "pattern_abstraction_name"
        : null;
    case "reinvented_utils":
      return reinventedUtilitySignal(change)
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

function isDuplicatedSchemaCandidate(change: SemChange): boolean {
  if (!/^(interface|type)$/i.test(change.entityType)) return false;
  if (/^(public|external|internal|payment|.+client$)/i.test(change.entityName)) return false;
  return /\b(local|payload|schema)\b/i.test(words(change.entityName));
}

function overCommentingSignal(change: SemChange): boolean {
  const before = commentLines(change.beforeContent);
  const after = commentLines(change.afterContent);
  if (after <= before + 3) return false;
  const comments = commentText(change.afterContent);
  if (/\b(because|why|constraint|provider|external|api|quirk|edge case|timezone|utc|ledger|finance|reconciliation|rejects|mirrors|keep this)\b/i.test(comments)) {
    return false;
  }
  return true;
}

function lintBypassSignal(value: string): boolean {
  return value.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    const comment = /^(\/\/|\/\*|\*)/.test(trimmed);
    if (comment && /@ts-ignore\s*$/i.test(trimmed)) return true;
    if (comment && /@ts-expect-error\s*$/i.test(trimmed)) return true;
    if (comment && /(eslint-disable|biome-ignore)/i.test(trimmed) && !/\s--\s*\S/.test(trimmed)) return true;
    return /\bas unknown as\b|\bas any\b|:\s*any\b/i.test(trimmed);
  });
}

function reinventedUtilitySignal(change: SemChange): boolean {
  const name = change.entityName;
  if (!/^(clamp|debounce|throttle|slug|slugify|sort|shuffle|memoize|pick|omit|uniq)/i.test(name)) return false;
  const content = change.afterContent ?? "";
  if (/currency|invoice|refund|subscription|tier|domain/i.test(`${name}\n${content}`)) return false;
  return true;
}

function isSearchableSourceChange(change: SemChange): boolean {
  const filePath = change.filePath.toLowerCase();
  if (/(^|\/)(bun|package-lock|pnpm-lock|yarn)\.lock$/.test(filePath)) return false;
  if (/(^|\/)(dist|build|coverage|generated|vendor|fixtures?|snapshots?)(\/|$)/.test(filePath)) return false;
  if (/\.(md|mdx|txt|json|jsonc|ya?ml|toml|lock|csv|svg|png|jpe?g|gif|webp)$/i.test(filePath)) return false;
  if (/\.(test|spec|fixture)\.[cm]?[jt]sx?$/i.test(filePath)) return false;
  return /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i.test(filePath);
}

function commentLines(value: string | null): number {
  if (!value) return 0;
  return value.split(/\r?\n/).filter((line) => /^\s*(\/\/|\/\*|\*|#)/.test(line)).length;
}

function commentText(value: string | null): string {
  if (!value) return "";
  return value
    .split(/\r?\n/)
    .filter((line) => /^\s*(\/\/|\/\*|\*|#)/.test(line))
    .join("\n");
}

function words(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
}
