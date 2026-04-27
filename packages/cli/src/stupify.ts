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
import { helpText, renderReport } from "./render.ts";
import { semChangeSetForCommand, semContexts } from "./sem-provider.ts";
import { trace } from "./trace.ts";
import type {
  AnalysisReport,
  AnalyzeCommand,
  FindingsResult,
  NetDiff,
  SemCandidate,
  SemChangeSet,
  SemContext,
  SemTraceEvent,
} from "./types.ts";

const SEM_SCOUT_CHUNK_SIZE = 200;
const SEM_AUDIT_CHUNK_SIZE = 5;

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
  const changeSet = await trace.trace("sem.diff", () => semChangeSetForCommand(command));
  const diffMs = Date.now() - diffStartedAt;
  const semTrace: SemTraceEvent[] = [{
    name: "sem.diff",
    ms: diffMs,
    count: changeSet.summary.total,
    detail: `${changeSet.summary.fileCount} files`,
  }];
  debugSemTrace(command, semTrace[0]);

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
  semTrace.push({
    name: "model.load",
    ms: modelMs,
    count: 2,
    detail: "scout+audit",
  });
  debugSemTrace(command, semTrace[semTrace.length - 1]);

  try {
    const searchStartedAt = Date.now();
    const candidateBatches = chunkSemChangeSet(changeSet);
    const candidates = candidateBatches.length === 0
      ? []
      : await scoutSemBatches(scoutModel, candidateBatches, checks, command, semTrace);
    const searchMs = Date.now() - searchStartedAt;
    semTrace.push({
      name: "sem.scout.total",
      ms: searchMs,
      count: candidates.length,
      detail: `${candidateBatches.length} batches`,
    });
    debugSemTrace(command, semTrace[semTrace.length - 1]);

    const contextStartedAt = Date.now();
    const contexts = await trace.trace(
      "sem.context",
      () => semContexts(
        changeSet.contextCwd,
        candidates.map((candidate) => candidate.entityId),
        changeSet.changes,
        command.debugSem,
      ),
      { candidates: candidates.length },
    );
    const contextMs = Date.now() - contextStartedAt;
    semTrace.push({
      name: "sem.context.total",
      ms: contextMs,
      count: contexts.length,
    });
    debugSemTrace(command, semTrace[semTrace.length - 1]);

    const auditStartedAt = Date.now();
    const auditBatches = chunkSemContexts(contexts);
    const result = await auditSemContextBatches(auditModel, changeSet, auditBatches, checks, semTrace, command);
    const auditMs = Date.now() - auditStartedAt;
    semTrace.push({
      name: "sem.audit.total",
      ms: auditMs,
      count: result.findings.length,
      detail: `${auditBatches.length} batches`,
    });
    debugSemTrace(command, semTrace[semTrace.length - 1]);

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
        scoutModelCalls: candidateBatches.length,
        auditModelCalls: auditBatches.length,
        timingsMs: {
          diff: diffMs,
          modelLoad: modelMs,
          search: searchMs,
          audit: auditMs + contextMs,
          total: Date.now() - startedAt,
        },
        warnings: [],
        semTrace,
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
  semTrace: SemTraceEvent[],
  command: AnalyzeCommand,
): Promise<FindingsResult> {
  const findings = [];
  const summaries = [];
  for (const [index, batch] of batches.entries()) {
    const startedAt = Date.now();
    const result = await trace.trace(
      "audit.sem",
      () => auditSemContexts(model, changeSet, batch, checks),
      { candidates: batch.length },
    );
    const event = {
      name: "sem.audit.batch",
      ms: Date.now() - startedAt,
      count: result.findings.length,
      detail: `batch=${index + 1}/${batches.length} candidates=${batch.length}`,
    };
    semTrace.push(event);
    debugSemTrace(command, event);
    findings.push(...result.findings);
    if (result.summary) summaries.push(result.summary);
  }
  return {
    findings,
    summary: findings.length === 0
      ? "No clear judgment-offload signal found."
      : summaries.join(" "),
  };
}

async function scoutSemBatches(
  model: LocalModel,
  batches: readonly SemChangeSet[],
  checks: ReturnType<typeof enabledChecks>,
  command: AnalyzeCommand,
  semTrace: SemTraceEvent[],
): Promise<readonly SemCandidate[]> {
  const candidates: SemCandidate[] = [];
  const seen = new Set<string>();
  for (const [index, batch] of batches.entries()) {
    if (candidates.length >= command.maxCandidates) break;
    const remaining: number = command.maxCandidates - candidates.length;
    const startedAt = Date.now();
    const batchCandidates: readonly SemCandidate[] = await trace.trace(
      "search.sem",
      () => scoutSemChanges(model, batch, checks, remaining),
      { entities: batch.changes.length },
    );
    const event = {
      name: "sem.scout.batch",
      ms: Date.now() - startedAt,
      count: batchCandidates.length,
      detail: `batch=${index + 1}/${batches.length} entities=${batch.changes.length} remaining=${remaining}`,
    };
    semTrace.push(event);
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

function debugSemTrace(command: AnalyzeCommand, event: SemTraceEvent): void {
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

function chunkSemContexts(contexts: readonly SemContext[]): readonly (readonly SemContext[])[] {
  const chunks: SemContext[][] = [];
  for (let index = 0; index < contexts.length; index += SEM_AUDIT_CHUNK_SIZE) {
    chunks.push(contexts.slice(index, index + SEM_AUDIT_CHUNK_SIZE));
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
    `Sem: ${changeSet.summary.fileCount} files, ${changeSet.summary.total} changed entities`,
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
