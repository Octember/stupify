#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  auditCandidates,
  auditSemContexts,
  scoutBatch,
  scoutSemChanges,
} from "./analysis.ts";
import { batchDiff } from "./batcher.ts";
import { candidateContexts } from "./candidate-context.ts";
import { enabledChecks } from "./checks.ts";
import { parseCommand } from "./command.ts";
import { MODEL_REGISTRY } from "./constants.ts";
import { readDiffFromStdin } from "./diff.ts";
import {
  netDiffForCommit,
  netDiffForRecentCommits,
  netDiffFromStdin,
  netDiffSince,
} from "./git.ts";
import { firstRunModelBootstrap, loadLocalModel, type LocalModel } from "./model.ts";
import { entityContextsFromChanges, repomixContextPack } from "./repomix-provider.ts";
import { helpText, renderReport } from "./render.ts";
import { semChangeSetForCommand } from "./sem-provider.ts";
import { trace } from "./trace.ts";
import type {
  AnalysisReport,
  AnalyzeCommand,
  AuditReviewStats,
  FindingsResult,
  NetDiff,
  SemCandidate,
  SemChangeSet,
  SemContext,
  TraceEvent,
} from "./types.ts";

const SEM_SCOUT_CHUNK_SIZE = 200;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const startedAt = Date.now();
  try {
    const command = parseCommand(argv);
    if (command.kind === "help") {
      console.log(helpText());
      return 0;
    }

    const checks = enabledChecks(command.checkIds);
    const report = command.engine === "sem"
      ? await runSemEngine(command, checks, startedAt)
      : await runRawDiffEngine(command, checks, startedAt);

    console.log(renderReport(report, command));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function runRawDiffEngine(
  command: AnalyzeCommand,
  checks: ReturnType<typeof enabledChecks>,
  startedAt: number,
): Promise<AnalysisReport> {
  const diffStartedAt = Date.now();
  const diff = await trace.trace("net.diff", () =>
    netDiffForCommand(command),
  );
  const diffMs = Date.now() - diffStartedAt;

  printRunPlan(
    command,
    diff,
    checks.map((check) => check.id),
  );

  const modelStartedAt = Date.now();
  const modelPath = await firstRunModelBootstrap(command.model);
  const scoutModel = await loadLocalModel(modelPath, command.model, "scout");
  const auditModel = await loadLocalModel(modelPath, command.model, "audit");
  const modelMs = Date.now() - modelStartedAt;

  const batches = batchDiff(diff.text);
  const searchStartedAt = Date.now();
  const candidatePointers: string[] = [];
  for (const batch of batches) {
    const candidates = await trace.trace(
      "search.batch",
      () => scoutBatch(scoutModel, batch, checks, diff.label),
      {
        batch: batch.id,
      },
    );
    candidatePointers.push(...candidates);
  }
  const searchMs = Date.now() - searchStartedAt;

  const contexts = candidateContexts(batches, candidatePointers);
  const auditedContexts = contexts;
  const warnings: string[] = [];
  const auditStartedAt = Date.now();
  const result = await trace.trace(
    "audit.candidates",
    () => auditCandidates(auditModel, diff, auditedContexts, checks),
    {
      candidates: auditedContexts.length,
    },
  );
  const auditMs = Date.now() - auditStartedAt;

  return {
    run: {
      mode: command.kind,
      engine: command.engine,
      modelId: command.model,
      checkIds: checks.map((check) => check.id),
      sourceId: diff.id,
      label: diff.label,
      stats: diff.stats,
      batchesScanned: batches.length,
      entitiesScanned: 0,
      candidateCount: new Set(candidatePointers).size,
      auditedCandidateCount: auditedContexts.length,
      scoutModelCalls: batches.length,
      auditModelCalls: auditedContexts.length > 0 ? 1 : 0,
      timingsMs: {
        diff: diffMs,
        modelLoad: modelMs,
        search: searchMs,
        audit: auditMs,
        total: Date.now() - startedAt,
      },
      warnings,
    },
    result,
  };
}

async function runSemEngine(
  command: AnalyzeCommand,
  checks: ReturnType<typeof enabledChecks>,
  startedAt: number,
): Promise<AnalysisReport> {
  const diffStartedAt = Date.now();
  const changeSet = await trace.trace("entity.diff", () => semChangeSetForCommand(command));
  const diffMs = Date.now() - diffStartedAt;
  const traceEvents: TraceEvent[] = [{
    name: "entity.diff",
    ms: diffMs,
    count: changeSet.summary.total,
    detail: `${changeSet.summary.fileCount} files`,
  }];
  debugSemTrace(command, traceEvents[0]);

  printSemRunPlan(
    command,
    changeSet,
    checks.map((check) => check.id),
  );

  const modelStartedAt = Date.now();
  const modelPath = await firstRunModelBootstrap(command.model);
  const scoutModel = await loadLocalModel(modelPath, command.model, "scout");
  const auditModel = await loadLocalModel(modelPath, command.model, "audit");
  const modelMs = Date.now() - modelStartedAt;
  traceEvents.push({
    name: "model.load",
    ms: modelMs,
    count: 2,
    detail: "scout+audit",
  });
  debugSemTrace(command, traceEvents[traceEvents.length - 1]);

  try {
    const searchStartedAt = Date.now();
    const candidateBatches = chunkSemChangeSet(changeSet);
    const candidates = candidateBatches.length === 0
      ? []
      : await scoutSemBatches(scoutModel, candidateBatches, checks, command, traceEvents);
    const searchMs = Date.now() - searchStartedAt;
    traceEvents.push({
      name: "scout.total",
      ms: searchMs,
      count: candidates.length,
      detail: `${candidateBatches.length} batches`,
    });
    debugSemTrace(command, traceEvents[traceEvents.length - 1]);

    const contextStartedAt = Date.now();
    const contexts = await trace.trace(
      "candidate.context.select",
      () => Promise.resolve(entityContextsFromChanges(candidates, changeSet.changes)),
      { candidates: candidates.length },
    );
    const contextMs = Date.now() - contextStartedAt;
    traceEvents.push({
      name: "context.select",
      ms: contextMs,
      count: contexts.length,
      detail: `${new Set(contexts.map((context) => context.filePath).filter(Boolean)).size} files`,
    });
    debugSemTrace(command, traceEvents[traceEvents.length - 1]);

    const auditStartedAt = Date.now();
    const auditBatches = chunkSemContexts(contexts, command.auditBatchSize);
    const result = await auditSemContextBatches(auditModel, changeSet, auditBatches, checks, traceEvents, command);
    const auditMs = Date.now() - auditStartedAt;
    traceEvents.push({
      name: "audit.total",
      ms: auditMs,
      count: result.findings.length,
      detail: `${auditBatches.length} batches targets=${result.stats.totalTargets} clean=${result.stats.clean} uncertain=${result.stats.uncertain} invalid=${result.stats.invalid}`,
    });
    debugSemTrace(command, traceEvents[traceEvents.length - 1]);

    return {
      run: {
        mode: command.kind,
        engine: command.engine,
        modelId: command.model,
        checkIds: checks.map((check) => check.id),
        sourceId: changeSet.id,
        label: changeSet.label,
        stats: {
          filesChanged: changeSet.summary.fileCount,
          additions: changeSet.summary.added,
          deletions: changeSet.summary.deleted,
        },
        batchesScanned: 0,
        entitiesScanned: changeSet.summary.total,
        candidateCount: candidates.length,
        auditedCandidateCount: contexts.length,
        scoutModelCalls: traceEvents.filter((event) => event.name === "scout.batch").length,
        auditModelCalls: auditBatches.length,
        timingsMs: {
          diff: diffMs,
          modelLoad: modelMs,
          search: searchMs,
          audit: auditMs + contextMs,
          total: Date.now() - startedAt,
        },
        warnings: [],
        auditStats: result.stats,
        traceEvents,
      },
      result,
    };
  } finally {
    await changeSet.cleanup();
  }
}

async function auditSemContextBatches(
  model: LocalModel,
  changeSet: SemChangeSet,
  batches: readonly (readonly SemContext[])[],
  checks: ReturnType<typeof enabledChecks>,
  traceEvents: TraceEvent[],
  command: AnalyzeCommand,
): Promise<FindingsResult & { stats: AuditReviewStats }> {
  const findings = [];
  const summaries = [];
  const stats = { totalTargets: 0, finding: 0, clean: 0, uncertain: 0, invalid: 0 };
  for (const [index, batch] of batches.entries()) {
    const contextStartedAt = Date.now();
    const pack = await trace.trace(
      "candidate.context.pack",
      () => repomixContextPack(changeSet.contextCwd, batch, changeSet.changes),
      { candidates: batch.length },
    );
    const contextEvent = {
      name: "context.pack",
      ms: Date.now() - contextStartedAt,
      count: pack.filePaths.length,
      detail: `batch=${index + 1}/${batches.length} tokens=${pack.totalTokens} chars=${pack.totalCharacters}`,
    };
    traceEvents.push(contextEvent);
    debugSemTrace(command, contextEvent);

    const startedAt = Date.now();
    const result = await trace.trace(
      "candidate.audit",
      () => auditSemContexts(model, changeSet, batch, pack, checks),
      { candidates: batch.length },
    );
    const event = {
      name: "audit.batch",
      ms: Date.now() - startedAt,
      count: result.findings.length,
      detail: `batch=${index + 1}/${batches.length} candidates=${batch.length} targets=${result.stats.totalTargets} clean=${result.stats.clean} uncertain=${result.stats.uncertain} invalid=${result.stats.invalid}`,
    };
    traceEvents.push(event);
    debugSemTrace(command, event);
    findings.push(...result.findings);
    if (result.summary) summaries.push(result.summary);
    stats.totalTargets += result.stats.totalTargets;
    stats.finding += result.stats.finding;
    stats.clean += result.stats.clean;
    stats.uncertain += result.stats.uncertain;
    stats.invalid += result.stats.invalid;
  }
  return {
    findings,
    summary: findings.length === 0
      ? "No clear judgment-offload signal found."
      : summaries.join(" "),
    stats,
  };
}

async function scoutSemBatches(
  model: LocalModel,
  batches: readonly SemChangeSet[],
  checks: ReturnType<typeof enabledChecks>,
  command: AnalyzeCommand,
  traceEvents: TraceEvent[],
): Promise<readonly SemCandidate[]> {
  const candidates: SemCandidate[] = [];
  const seen = new Set<string>();
  for (const [index, batch] of batches.entries()) {
    if (candidates.length >= command.maxCandidates) break;
    const remaining: number = command.maxCandidates - candidates.length;
    const startedAt = Date.now();
    const batchCandidates: readonly SemCandidate[] = await trace.trace(
      "candidate.scout",
      () => scoutSemChanges(model, batch, checks, remaining),
      { entities: batch.changes.length },
    );
    const event = {
      name: "scout.batch",
      ms: Date.now() - startedAt,
      count: batchCandidates.length,
      detail: `batch=${index + 1}/${batches.length} entities=${batch.changes.length} remaining=${remaining}`,
    };
    traceEvents.push(event);
    debugSemTrace(command, event);
    for (const candidate of batchCandidates) {
      if (seen.has(candidate.entityId)) continue;
      seen.add(candidate.entityId);
      candidates.push(candidate);
      if (candidates.length >= command.maxCandidates) break;
    }
  }
  return candidates;
}

function debugSemTrace(command: AnalyzeCommand, event: TraceEvent): void {
  if (!command.debugSem) return;
  const parts = [`trace ${event.name}`, `${event.ms}ms`];
  if (event.count !== undefined) parts.push(`count=${event.count}`);
  if (event.detail) parts.push(event.detail);
  console.error(parts.join(" "));
}

function chunkSemChangeSet(changeSet: SemChangeSet): readonly SemChangeSet[] {
  const chunks: SemChangeSet[] = [];
  for (let index = 0; index < changeSet.changes.length; index += SEM_SCOUT_CHUNK_SIZE) {
    const changes = changeSet.changes.slice(index, index + SEM_SCOUT_CHUNK_SIZE);
    chunks.push({
      ...changeSet,
      label: `${changeSet.label} batch ${chunks.length + 1}`,
      changes,
      summary: {
        ...changeSet.summary,
        fileCount: new Set(changes.map((change) => change.filePath)).size,
        total: changes.length,
      },
    });
  }
  return chunks;
}

function chunkSemContexts(
  contexts: readonly SemContext[],
  auditBatchSize: number,
): readonly (readonly SemContext[])[] {
  const chunks: SemContext[][] = [];
  for (let index = 0; index < contexts.length; index += auditBatchSize) {
    chunks.push(contexts.slice(index, index + auditBatchSize));
  }
  return chunks;
}

function printRunPlan(
  command: AnalyzeCommand,
  diff: NetDiff,
  checkIds: readonly string[],
): void {
  if (command.json) return;
  console.error("🧙 stupify 🪄");
  console.error(`Window: ${diff.label}`);
  console.error(
    `Diff: ${diff.stats.filesChanged} files changed, ${diff.stats.additions} added, ${diff.stats.deletions} deleted`,
  );
  console.error(`Model: ${MODEL_REGISTRY[command.model].name}`);
  console.error(`Checks: ${checkIds.join(", ")}`);
}

function printSemRunPlan(
  command: AnalyzeCommand,
  changeSet: SemChangeSet,
  checkIds: readonly string[],
): void {
  if (command.json) return;
  console.error("🧙 stupify 🪄");
  console.error(`Window: ${changeSet.label}`);
  console.error(
    `Entities: ${changeSet.summary.fileCount} files, ${changeSet.summary.total} changed entities`,
  );
  console.error(`Model: ${MODEL_REGISTRY[command.model].name}`);
  console.error(`Checks: ${checkIds.join(", ")}`);
}

async function netDiffForCommand(command: AnalyzeCommand): Promise<NetDiff> {
  if (command.kind === "since") return netDiffSince(command.since);
  if (command.kind === "stdin")
    return netDiffFromStdin(await readDiffFromStdin());
  if (command.kind === "commit") return netDiffForCommit(command.commit);
  return netDiffForRecentCommits(command.count);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
