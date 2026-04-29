import { countPromptTokens, runSearch } from "../llm/analysis.ts";
import { searchChecks } from "../core/checks.ts";
import { createCliUi, type CliUi } from "../core/ui.ts";
import { counterScoutPlan } from "../sem/counter-scout.ts";
import { firstRunModelBootstrap, loadLocalModel } from "../model/model.ts";
import {
  entityContextsFromChanges,
  emptyContextPack,
  repomixContextPack,
  repomixSearchConfig,
} from "../repomix/repomix-provider.ts";
import {
  effectiveMaxCandidates,
  effectiveMaxSearchInputTokens,
  effectiveRepomixConfig,
  effectiveSearchChecks,
  loadSearchProfile,
} from "./search-profile.ts";
import { semChangeSetForCommand } from "../sem/sem-provider.ts";
import { createTracer } from "../core/trace.ts";
import { blameEntity } from "../git/git.ts";
import type { SearchCommand, SearchMatch, SearchRunJson } from "../core/types.ts";
import { buildSearchBatches } from "./search-batches.ts";
import {
  formatErrorStep,
  formatStartStep,
  formatStep,
  printRunPlan,
  scoutPlanLine,
  targetPlanLine,
} from "./search-output.ts";
import {
  countTargetsByPattern,
  dedupeMatches,
  previewTargets,
  withCheckWhy,
} from "./search-targets.ts";

export async function runSearchCommand(
  command: SearchCommand,
  startedAt: number,
  ui: CliUi = createCliUi({ quiet: command.json }),
): Promise<SearchRunJson> {
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
      const message =
        event.phase === "error"
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
    const initialPack =
      profile?.context === "sem"
        ? emptyContextPack()
        : await t
            .trace(
              "context.pack",
              () =>
                repomixContextPack(changeSet.contextCwd, contexts, changeSet.changes, baseRepomixConfig),
              {
                count: (v) => v.filePaths.length,
                detail: (v) => `${v.totalTokens} tokens`,
              },
            )
            .then((result) => result.value);
    const packedFiles = new Set(initialPack.filePaths);
    const searchContexts =
      profile?.context === "sem"
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
    const pack =
      profile?.context === "sem" || searchContexts.length === contexts.length
        ? initialPack
        : await repomixContextPack(
            changeSet.contextCwd,
            searchContexts,
            changeSet.changes,
            baseRepomixConfig,
          );
    const { value: batches } = await t.trace(
      "search.batches",
      () =>
        buildSearchBatches({
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
        detail: (result) =>
          result.wasSplit
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
      ui.warn(
        `Search input is large; queued ${batches.batches.length} smaller batches for ${searchContexts.length} targets (${maxSearchInputTokens} token cap).`,
      );
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
    const uniqueMatches = await withEntityBlame(dedupeMatches(matches), changeSet.target, command);

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

async function withEntityBlame(
  matches: readonly SearchMatch[],
  targetRev: string,
  command: SearchCommand,
): Promise<readonly SearchMatch[]> {
  if (command.kind === "staged" || command.kind === "stdin") return matches;

  return Promise.all(matches.map(async (match) => {
    if (!match.filePath || !match.entityName) return match;
    const blame = await blameEntity({
      filePath: match.filePath,
      entityName: match.entityName,
      rev: targetRev,
    });
    return blame ? { ...match, blame } : match;
  }));
}
