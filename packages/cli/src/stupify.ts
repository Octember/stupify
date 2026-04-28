#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { countPromptTokens, runSearch, searchRequest, type SearchRequest } from "./analysis.ts";
import { searchChecks } from "./checks.ts";
import { parseCommand } from "./command.ts";
import { counterScoutPlan } from "./counter-scout.ts";
import { renderDoctorToUi, runDoctor } from "./doctor.ts";
import { renderHookResultToUi, runHookCommand } from "./hooks.ts";
import { firstRunModelBootstrap, loadLocalModel } from "./model.ts";
import { entityContextsFromChanges, emptyContextPack, repomixContextPack, repomixSearchConfig } from "./repomix-provider.ts";
import { helpText, renderSearchRun, renderSearchRunToUi } from "./render.ts";
import {
  effectiveMaxCandidates,
  effectiveMaxSearchInputTokens,
  effectiveRepomixConfig,
  effectiveSearchChecks,
  loadSearchProfile,
} from "./search-profile.ts";
import { semChangeSetForCommand } from "./sem-provider.ts";
import { createTracer } from "./trace.ts";
import { createCliUi, type CliUi } from "./ui.ts";
import type { CounterScoutPlan } from "./counter-scout.ts";
import type { SearchCommand, SearchMatch, SearchProfile, SearchRunJson, SemContext, SemContextPack, StupifyCheck } from "./types.ts";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const startedAt = Date.now();
  let ui = createCliUi();
  try {
    const command = parseCommand(argv);
    if (command.kind === "help") {
      ui.intro("stupify");
      ui.note(helpText().trim(), "Help");
      ui.outro("Local-only. Warn-only.");
      return 0;
    }
    if (command.kind === "hook") {
      ui.intro("stupify");
      renderHookResultToUi(await runHookCommand(command.action), ui);
      ui.outro("Hook mode is warn-only. Commits are not blocked.");
      return 0;
    }
    if (command.kind === "doctor") {
      const result = await runDoctor();
      ui.intro("stupify");
      renderDoctorToUi(result, ui);
      ui.outro(result.exitCode === 0 ? "Ready." : "Fix missing required dependencies, then rerun doctor.");
      return result.exitCode;
    }
    if (command.kind === "bench-search") {
      const { runSearchBench } = await import("./search-bench.ts");
      ui.intro("stupify");
      ui.note(await runSearchBench(command.configPath), "Search bench");
      ui.outro("Bench complete.");
      return 0;
    }

    ui = createCliUi({ quiet: command.json });
    const run = await runSearchCommand(command, startedAt, ui);
    if (command.json) ui.writeStdout(renderSearchRun(run, command));
    else renderSearchRunToUi(run, command, ui);
    return 0;
  } catch (error) {
    ui.error(error instanceof Error ? error.message : String(error), { force: true });
    return 1;
  }
}

export async function runSearchCommand(command: SearchCommand, startedAt: number, ui = createCliUi({ quiet: command.json })): Promise<SearchRunJson> {
  const activeSpans = new Map<string, ReturnType<CliUi["spinner"]>>();
  const t = createTracer({
    writeLine: () => undefined,
    onEvent: (event) => {
      if (command.json) return;
      if (event.phase === "start") {
        activeSpans.set(event.name, ui.spinner(formatStartStep(event.name, event.detail)));
        return;
      }

      const active = activeSpans.get(event.name);
      activeSpans.delete(event.name);
      const message = event.phase === "error"
        ? formatErrorStep(event.name, event.ms)
        : formatStep(event.name, event.ms, event.count, event.detail);
      if (!active) {
        if (event.phase === "error") ui.error(message);
        else ui.step(message);
        return;
      }
      if (event.phase === "error") active.error(message);
      else active.stop(message);
    },
  });

  const profile = await loadSearchProfile(command.searchProfilePath);
  const checks = profile ? effectiveSearchChecks(command.checkIds, profile) : searchChecks(command.checkIds);
  const patternIds = checks.map((check) => check.id);
  const maxCandidates = effectiveMaxCandidates(command.maxCandidates, profile);
  const maxSearchInputTokens = effectiveMaxSearchInputTokens(command.maxSearchInputTokens, profile);
  printRunPlan(command, patternIds, ui);
  const { value: changeSet } = await t.trace(
    "entity.diff",
    () => semChangeSetForCommand(command),
    {
      count: (v) => v.summary.total,
      detail: (v) => `${v.summary.fileCount} files`,
    },
  );

  try {
    const scoutPlan = counterScoutPlan(changeSet, checks, maxCandidates);
    if (!command.json) ui.step(scoutPlanLine(scoutPlan, changeSet.summary.total));
    const candidates = scoutPlan.targets;
    const contexts = entityContextsFromChanges(candidates, changeSet.changes);
    const targetsByPattern = countTargetsByPattern(contexts);
    const targetsPreview = previewTargets(contexts);
    if (contexts.length === 0) {
      return {
        schemaVersion: "search.v1",
        mode: "search",
        source: command.source,
        model: { id: command.model },
        patterns: patternIds,
        stats: {
          elapsedMs: Date.now() - startedAt,
          modelCalls: 0,
          committers: changeSet.committers,
          commitSubjects: changeSet.commitSubjects,
          skipped: true,
          skipReason: "no_candidates",
          filesChanged: changeSet.summary.fileCount,
          entitiesScanned: changeSet.summary.total,
          candidates: 0,
          searchTargets: 0,
          repomixFiles: 0,
          repomixTokens: 0,
          profileId: profile?.id,
          targetsByPattern,
          targetsPreview,
        },
        matches: [],
      };
    }

    const baseRepomixConfig = effectiveRepomixConfig(repomixSearchConfig(), profile);
    const initialPack = profile?.context === "sem"
      ? emptyContextPack()
      : await t.trace(
        "context.pack",
        () => repomixContextPack(changeSet.contextCwd, contexts, changeSet.changes, baseRepomixConfig),
        {
          count: (v) => v.filePaths.length,
          detail: (v) => `${v.totalTokens} tokens`,
        },
      ).then((result) => result.value);
    const packedFiles = new Set(initialPack.filePaths);
    const searchContexts = profile?.context === "sem"
      ? contexts
      : contexts.filter((context) => context.filePath && packedFiles.has(context.filePath));
    if (!command.json) ui.step(targetPlanLine(searchContexts, contexts.length, countTargetsByPattern(searchContexts)));
    if (searchContexts.length === 0) {
      return {
        schemaVersion: "search.v1",
        mode: "search",
        source: command.source,
        model: { id: command.model },
        patterns: patternIds,
        stats: {
          elapsedMs: Date.now() - startedAt,
          modelCalls: 0,
          committers: changeSet.committers,
          commitSubjects: changeSet.commitSubjects,
          skipped: true,
          skipReason: "no_candidates",
          filesChanged: changeSet.summary.fileCount,
          entitiesScanned: changeSet.summary.total,
          candidates: contexts.length,
          searchTargets: 0,
          repomixFiles: initialPack.filePaths.length,
          repomixTokens: initialPack.totalTokens,
          repomixConfig: initialPack.config,
          profileId: profile?.id,
          targetsByPattern,
          targetsPreview,
        },
        matches: [],
      };
    }
    const pack = profile?.context === "sem" || searchContexts.length === contexts.length
      ? initialPack
      : await repomixContextPack(changeSet.contextCwd, searchContexts, changeSet.changes, baseRepomixConfig);
    const { value: batches } = await t.trace(
      "search.batches",
      () => buildSearchBatches({
        command,
        changeSet,
        contexts: searchContexts,
        initialPack: pack,
        checks,
        profile,
        includeCounterReasonInPrompt: command.includeCounterReasonInPrompt,
        maxSearchInputTokens,
        baseRepomixConfig,
      }),
      {
        startDetail: `${searchContexts.length} targets`,
        count: (result) => result.batches.length,
        detail: (result) => result.wasSplit
          ? `${result.skippedTargets} oversized targets skipped`
          : `${result.estimatedInputTokens} estimated tokens`,
      },
    );

    if (batches.batches.length === 0) {
      return {
        schemaVersion: "search.v1",
        mode: "search",
        source: command.source,
        model: { id: command.model },
        patterns: patternIds,
        stats: {
          elapsedMs: Date.now() - startedAt,
          modelCalls: 0,
          inputTokens: batches.estimatedInputTokens,
          inputTokenCap: maxSearchInputTokens,
          committers: changeSet.committers,
          commitSubjects: changeSet.commitSubjects,
          skipped: true,
          skipReason: "input_too_large",
          filesChanged: changeSet.summary.fileCount,
          entitiesScanned: changeSet.summary.total,
          candidates: contexts.length,
          searchTargets: searchContexts.length,
          repomixFiles: pack.filePaths.length,
          repomixTokens: pack.totalTokens,
          repomixConfig: pack.config,
          searchBatches: 0,
          skippedTargets: batches.skippedTargets,
          profileId: profile?.id,
          targetsByPattern: countTargetsByPattern(searchContexts),
          targetsPreview: previewTargets(searchContexts),
        },
        matches: [],
      };
    }

    if (batches.wasSplit && !command.json) {
      ui.warn(`Search input is large; queued ${batches.batches.length} smaller batches for ${searchContexts.length} targets (${maxSearchInputTokens} token cap).`);
      if (batches.skippedTargets > 0) {
        ui.warn(`Skipped ${batches.skippedTargets} oversized targets that could not fit alone.`);
      }
    } else if (!command.json) {
      ui.step(`Search: ${searchContexts.length} targets in ${batches.batches.length} model batch (${maxSearchInputTokens} token cap)`);
    }

    const modelPath = await firstRunModelBootstrap(command.model, ui);
    const model = await loadLocalModel(modelPath, command.model, "scout", ui);
    const matches = [];
    let modelCalls = 0;
    let inputTokens = 0;
    let exactSkippedTargets = batches.skippedTargets;
    for (const batch of batches.batches) {
      const { value: batchInputTokens } = await t.trace(
        "prompt.tokens",
        () => countPromptTokens(model, batch.request.prompt),
        {
          startDetail: `${batch.contexts.length} targets`,
          count: (tokens) => tokens,
        },
      );
      inputTokens += batchInputTokens;
      if (batchInputTokens > maxSearchInputTokens) {
        exactSkippedTargets += batch.contexts.length;
        if (!command.json) {
          ui.warn(`Skipped ${batch.contexts.length} targets after exact token count exceeded the limit.`);
        }
        continue;
      }
      const { value } = await t.trace(
        "search.model",
        () => runSearch(model, batch.request),
        {
          startDetail: `${batch.contexts.length} targets`,
          count: (v) => v.length,
        },
      );
      modelCalls += 1;
      matches.push(...withCheckWhy(value, checks));
    }
    const uniqueMatches = dedupeMatches(matches);

    return {
      schemaVersion: "search.v1",
      mode: "search",
      source: command.source,
      model: { id: command.model },
      patterns: patternIds,
      stats: {
        elapsedMs: Date.now() - startedAt,
        modelCalls,
        inputTokens,
        inputTokenCap: maxSearchInputTokens,
        committers: changeSet.committers,
        commitSubjects: changeSet.commitSubjects,
        filesChanged: changeSet.summary.fileCount,
        entitiesScanned: changeSet.summary.total,
        candidates: contexts.length,
        searchTargets: searchContexts.length,
        repomixFiles: pack.filePaths.length,
        repomixTokens: pack.totalTokens,
        repomixConfig: pack.config,
        searchBatches: batches.batches.length,
        skippedTargets: exactSkippedTargets,
        profileId: profile?.id,
        targetsByPattern: countTargetsByPattern(searchContexts),
        targetsPreview: previewTargets(searchContexts),
      },
      matches: uniqueMatches,
    };
  } finally {
    await changeSet.cleanup();
  }
}

function dedupeMatches<T extends { targetId: string; patternId: string; proof: string }>(matches: readonly T[]): readonly T[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.patternId}\n${match.proof.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function withCheckWhy(matches: readonly SearchMatch[], checks: readonly StupifyCheck[]): readonly SearchMatch[] {
  const checksById = new Map(checks.map((check) => [check.id, check]));
  return matches.map((match) => ({
    ...match,
    patternName: checksById.get(match.patternId)?.name,
    checkWhy: checksById.get(match.patternId)?.why,
  }));
}

type SearchBatch = Readonly<{
  contexts: readonly SemContext[];
  pack: SemContextPack;
  request: SearchRequest;
  estimatedInputTokens: number;
}>;

async function buildSearchBatches(input: Readonly<{
  command: SearchCommand;
  changeSet: Parameters<typeof searchRequest>[0]["changeSet"];
  contexts: readonly SemContext[];
  initialPack: SemContextPack;
  checks: readonly StupifyCheck[];
  profile: SearchProfile | null;
  includeCounterReasonInPrompt: boolean;
  maxSearchInputTokens: number;
  baseRepomixConfig: Parameters<typeof repomixContextPack>[3];
}>): Promise<Readonly<{
  batches: readonly SearchBatch[];
  estimatedInputTokens: number;
  skippedTargets: number;
  wasSplit: boolean;
}>> {
  const first = makeSearchBatch(input, input.contexts, input.initialPack);
  if (first.estimatedInputTokens <= input.maxSearchInputTokens) {
    return {
      batches: [first],
      estimatedInputTokens: first.estimatedInputTokens,
      skippedTargets: 0,
      wasSplit: false,
    };
  }

  const batches: SearchBatch[] = [];
  let skippedTargets = 0;
  let currentContexts: readonly SemContext[] = [];
  let currentBatch: SearchBatch | null = null;

  for (const context of input.contexts) {
    const candidateContexts = [...currentContexts, context];
    const candidateBatch = await makeSearchBatchWithPack(input, candidateContexts);
    if (candidateBatch.estimatedInputTokens <= input.maxSearchInputTokens) {
      currentContexts = candidateContexts;
      currentBatch = candidateBatch;
      continue;
    }

    if (currentBatch) {
      batches.push(currentBatch);
      currentContexts = [];
      currentBatch = null;
    }

    const singleBatch = candidateContexts.length === 1
      ? candidateBatch
      : await makeSearchBatchWithPack(input, [context]);
    if (singleBatch.estimatedInputTokens <= input.maxSearchInputTokens) {
      currentContexts = [context];
      currentBatch = singleBatch;
    } else {
      skippedTargets += 1;
    }
  }

  if (currentBatch) batches.push(currentBatch);

  return {
    batches,
    estimatedInputTokens: first.estimatedInputTokens,
    skippedTargets,
    wasSplit: true,
  };
}

function makeSearchBatch(
  input: Readonly<{
    changeSet: Parameters<typeof searchRequest>[0]["changeSet"];
    checks: readonly StupifyCheck[];
    profile: SearchProfile | null;
    includeCounterReasonInPrompt: boolean;
  }>,
  contexts: readonly SemContext[],
  pack: SemContextPack,
): SearchBatch {
  const request = buildSearchRequest(
    input.changeSet,
    contexts,
    pack,
    input.checks,
    input.profile,
    input.includeCounterReasonInPrompt,
  );
  return {
    contexts,
    pack,
    request,
    estimatedInputTokens: estimatePromptTokens(request.prompt),
  };
}

async function makeSearchBatchWithPack(
  input: Readonly<{
    command: SearchCommand;
    changeSet: Parameters<typeof searchRequest>[0]["changeSet"];
    checks: readonly StupifyCheck[];
    profile: SearchProfile | null;
    includeCounterReasonInPrompt: boolean;
    baseRepomixConfig: Parameters<typeof repomixContextPack>[3];
  }>,
  contexts: readonly SemContext[],
): Promise<SearchBatch> {
  const pack = input.profile?.context === "sem"
    ? emptyContextPack()
    : await repomixContextPack(input.changeSet.contextCwd, contexts, input.changeSet.changes, input.baseRepomixConfig);
  return makeSearchBatch(input, contexts, pack);
}

function buildSearchRequest(
  changeSet: Parameters<typeof searchRequest>[0]["changeSet"],
  contexts: Parameters<typeof searchRequest>[0]["contexts"],
  pack: SemContextPack,
  patterns: readonly StupifyCheck[],
  profile: SearchProfile | null,
  includeCounterReasonInPrompt: boolean,
) {
  return searchRequest({
    changeSet,
    contexts,
    pack,
    patterns,
    includeCounterReasonInPrompt: profile?.includeCounterReasonInPrompt ?? includeCounterReasonInPrompt,
  });
}

function printRunPlan(
  command: SearchCommand,
  patternIds: readonly string[],
  ui: CliUi,
): void {
  if (command.json) return;
  ui.intro("stupify");
  ui.note(
    [
      `Search: ${sourceLabel(command)}`,
      `Patterns: ${patternIds.join(", ")}`,
    ].join("\n"),
    "Run",
  );
}

function formatStartStep(name: string, detail?: string): string {
  if (name === "entity.diff") return "Diff: running sem over the selected git range";
  if (name === "context.pack") return "Context: packing selected target files with Repomix";
  if (name === "search.batches") return `Search: preparing token-bounded model batches${detail ? ` for ${detail}` : ""}`;
  if (name === "prompt.tokens") return `Tokens: counting search prompt${detail ? ` for ${detail}` : ""}`;
  if (name === "search.model") return `Model: searching selected target/check pairs${detail ? ` (${detail})` : ""}`;
  return `${name}: working`;
}

function formatStep(name: string, ms: number, count?: number, detail?: string): string {
  if (name === "entity.diff") return `Diff: ${detail ?? "changed files"}, ${count ?? 0} changed entities (${ms}ms)`;
  if (name === "context.pack") return `Context: ${count ?? 0} files, ${detail ?? "0 tokens"} (${ms}ms)`;
  if (name === "search.batches") return `Search: ${count ?? 0} model batches, ${detail ?? "0 estimated tokens"} (${ms}ms)`;
  if (name === "prompt.tokens") return `Tokens: ${count ?? 0} prompt tokens (${ms}ms)`;
  if (name === "search.model") return `Model: ${count ?? 0} matches (${ms}ms)`;
  return `${name}: ${ms}ms`;
}

function formatErrorStep(name: string, ms: number): string {
  if (name === "entity.diff") return `Diff failed after ${ms}ms`;
  if (name === "context.pack") return `Context packing failed after ${ms}ms`;
  if (name === "search.batches") return `Search batch preparation failed after ${ms}ms`;
  if (name === "prompt.tokens") return `Token counting failed after ${ms}ms`;
  if (name === "search.model") return `Model search failed after ${ms}ms`;
  return `${name} failed after ${ms}ms`;
}

function scoutPlanLine(plan: CounterScoutPlan, entitiesScanned: number): string {
  if (plan.targets.length === 0) {
    return `Scout: deterministic counters scanned ${entitiesScanned} entities; no target/check pairs selected`;
  }

  return [
    `Scout: deterministic counters scanned ${entitiesScanned} entities`,
    `${plan.totalSignals} counter signals`,
    `selected ${plan.targets.length}/${plan.totalSignals} target/check pairs (cap ${plan.maxTargets}, not exhaustive)`,
  ].join("; ");
}

function targetPlanLine(
  searchContexts: readonly SemContext[],
  selectedTargets: number,
  targetsByPattern: Record<string, number>,
): string {
  const retained = searchContexts.length === selectedTargets
    ? `${searchContexts.length} selected targets`
    : `${searchContexts.length}/${selectedTargets} selected targets retained after context packing`;
  return `Targets: model will inspect ${retained}; ${formatCounts(targetsByPattern)}`;
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  if (entries.length === 0) return "no target/check pairs";
  return entries.map(([id, count]) => `${id}=${count}`).join(", ");
}

function sourceLabel(command: SearchCommand): string {
  if (command.kind === "since") return `since ${command.since}`;
  if (command.kind === "commit") return `commit ${command.commit}`;
  if (command.kind === "commits") return `last ${command.count} commits`;
  if (command.kind === "staged") return "staged changes";
  return "stdin diff";
}

function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 3);
}

function countTargetsByPattern(contexts: readonly SemContext[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const context of contexts) counts[context.checkId] = (counts[context.checkId] ?? 0) + 1;
  return counts;
}

function previewTargets(contexts: readonly SemContext[]) {
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

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
