#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { countPromptTokens, runSearch, searchRequest, type SearchRequest } from "./analysis.ts";
import { searchChecks } from "./checks.ts";
import { parseCommand } from "./command.ts";
import { counterScoutTargets } from "./counter-scout.ts";
import { runDoctor } from "./doctor.ts";
import { runHookCommand } from "./hooks.ts";
import { firstRunModelBootstrap, loadLocalModel } from "./model.ts";
import { entityContextsFromChanges, emptyContextPack, repomixContextPack, repomixSearchConfig } from "./repomix-provider.ts";
import { helpText, renderSearchRun } from "./render.ts";
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
import type { SearchCommand, SearchMatch, SearchProfile, SearchRunJson, SemContext, SemContextPack, StupifyCheck } from "./types.ts";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const startedAt = Date.now();
  let ui = createCliUi();
  try {
    const command = parseCommand(argv);
    if (command.kind === "help") {
      ui.writeStdout(helpText());
      return 0;
    }
    if (command.kind === "hook") {
      ui.writeStdout(await runHookCommand(command.action));
      return 0;
    }
    if (command.kind === "doctor") {
      const result = await runDoctor();
      ui.writeStdout(result.text);
      return result.exitCode;
    }
    if (command.kind === "bench-search") {
      const { runSearchBench } = await import("./search-bench.ts");
      ui.writeStdout(await runSearchBench(command.configPath));
      return 0;
    }

    ui = createCliUi({ quiet: command.json });
    const run = await runSearchCommand(command, startedAt, ui);
    ui.writeStdout(renderSearchRun(run, command));
    return 0;
  } catch (error) {
    ui.error(error instanceof Error ? error.message : String(error), { force: true });
    return 1;
  }
}

export async function runSearchCommand(command: SearchCommand, startedAt: number, ui = createCliUi({ quiet: command.json })): Promise<SearchRunJson> {
  const t = createTracer({
    writeLine: () => undefined,
    onEvent: (event) => {
      if (command.json) return;
      ui.step(formatStep(event.name, event.ms, event.count, event.detail));
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
    const candidates = counterScoutTargets(changeSet, checks, maxCandidates);
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
    const batches = await buildSearchBatches({
      command,
      changeSet,
      contexts: searchContexts,
      initialPack: pack,
      checks,
      profile,
      includeCounterReasonInPrompt: command.includeCounterReasonInPrompt,
      maxSearchInputTokens,
      baseRepomixConfig,
    });

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
      ui.warn(`Search input is large; queued ${batches.batches.length} smaller search batches.`);
      if (batches.skippedTargets > 0) {
        ui.warn(`Skipped ${batches.skippedTargets} oversized targets that could not fit alone.`);
      }
    }

    const modelPath = await firstRunModelBootstrap(command.model, ui);
    const model = await loadLocalModel(modelPath, command.model, "scout", ui);
    const matches = [];
    let modelCalls = 0;
    let inputTokens = 0;
    let exactSkippedTargets = batches.skippedTargets;
    for (const batch of batches.batches) {
      const batchInputTokens = await countPromptTokens(model, batch.request.prompt);
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
        { count: (v) => v.length },
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

function formatStep(name: string, ms: number, count?: number, detail?: string): string {
  if (name === "entity.diff") return `Diff: ${detail ?? "changed files"}, ${count ?? 0} changed entities (${ms}ms)`;
  if (name === "context.pack") return `Context: ${count ?? 0} files, ${detail ?? "0 tokens"} (${ms}ms)`;
  if (name === "search.model") return `Model: ${count ?? 0} matches (${ms}ms)`;
  return `${name}: ${ms}ms`;
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
