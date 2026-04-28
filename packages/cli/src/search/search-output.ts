import type { CliUi } from "../core/ui.ts";
import type { SearchCommand, SemContext } from "../core/types.ts";
import type { CounterScoutPlan } from "../sem/counter-scout.ts";

export function printRunPlan(command: SearchCommand, patternIds: readonly string[], ui: CliUi): void {
  if (command.json) return;
  ui.intro("stupify");
  ui.note(
    [`Search: ${sourceLabel(command)}`, `Patterns: ${patternIds.join(", ")}`].join("\n"),
    "Run",
  );
}

export function formatStep(name: string, ms: number, count?: number, detail?: string): string {
  if (name === "entity.diff") return `Diff: ${detail ?? "changed files"}, ${count ?? 0} changed entities (${ms}ms)`;
  if (name === "context.pack") return `Context: ${count ?? 0} files, ${detail ?? "0 tokens"} (${ms}ms)`;
  if (name === "search.batches") return `Search: ${count ?? 0} model batches, ${detail ?? "0 estimated tokens"} (${ms}ms)`;
  if (name === "prompt.tokens") return `Tokens: ${count ?? 0} prompt tokens (${ms}ms)`;
  if (name === "search.model") return `Model: ${count ?? 0} matches (${ms}ms)`;
  return `${name}: ${ms}ms`;
}

export function formatStartStep(name: string, detail?: string): string {
  if (name === "entity.diff") return "Diff: running sem over the selected git range";
  if (name === "context.pack") return "Context: packing selected target files with Repomix";
  if (name === "search.batches") return `Search: preparing token-bounded model batches${detail ? ` for ${detail}` : ""}`;
  if (name === "prompt.tokens") return `Tokens: counting search prompt${detail ? ` for ${detail}` : ""}`;
  if (name === "search.model") return `Model: searching selected target/check pairs${detail ? ` (${detail})` : ""}`;
  return `${name}: working`;
}

export function formatErrorStep(name: string, ms: number): string {
  if (name === "entity.diff") return `Diff failed after ${ms}ms`;
  if (name === "context.pack") return `Context packing failed after ${ms}ms`;
  if (name === "search.batches") return `Search batch preparation failed after ${ms}ms`;
  if (name === "prompt.tokens") return `Token counting failed after ${ms}ms`;
  if (name === "search.model") return `Model search failed after ${ms}ms`;
  return `${name} failed after ${ms}ms`;
}

export function scoutPlanLine(plan: CounterScoutPlan, entitiesScanned: number): string {
  if (plan.targets.length === 0) {
    return `Scout: deterministic counters scanned ${entitiesScanned} entities; no target/check pairs selected`;
  }

  return [
    `Scout: deterministic counters scanned ${entitiesScanned} entities`,
    `${plan.totalSignals} counter signals`,
    `selected ${plan.targets.length}/${plan.totalSignals} target/check pairs (cap ${plan.maxTargets}, not exhaustive)`,
  ].join("; ");
}

export function targetPlanLine(
  searchContexts: readonly SemContext[],
  selectedTargets: number,
  targetsByPattern: Record<string, number>,
): string {
  const retained =
    searchContexts.length === selectedTargets
      ? `${searchContexts.length} selected targets`
      : `${searchContexts.length}/${selectedTargets} selected targets retained after context packing`;
  return `Targets: model will inspect ${retained}; ${formatCounts(targetsByPattern)}`;
}

export function sourceLabel(command: SearchCommand): string {
  if (command.kind === "since") return `since ${command.since}`;
  if (command.kind === "commit") return `commit ${command.commit}`;
  if (command.kind === "commits") return `last ${command.count} commits`;
  if (command.kind === "staged") return "staged changes";
  return "stdin diff";
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  if (entries.length === 0) return "no target/check pairs";
  return entries.map(([id, count]) => `${id}=${count}`).join(", ");
}
