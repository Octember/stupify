#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  auditCandidates,
  runFindingsAudit,
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
import { loadLocalModels, type LocalModel } from "./model.ts";
import { entityContextsFromChanges, repomixContextPack } from "./repomix-provider.ts";
import { helpText, renderReport } from "./render.ts";
import { semChangeSetForCommand } from "./sem-provider.ts";
import { createTracer, trace } from "./trace.ts";
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
    const report =
      command.engine === "sem"
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
  const { value: diff, ms: diffMs } = await trace.trace("net.diff", () =>
    netDiffForCommand(command),
  );

  printRunPlan(
    command,
    diff,
    checks.map((check) => check.id),
  );

  const { value: models, ms: modelMs } = await trace.trace(
    "model.load",
    () => loadLocalModels(command.model),
  );
  const { scoutModel, auditModel } = models;

  const batches = batchDiff(diff.text);
  const { value: candidatePointers, ms: searchMs } = await trace.trace(
    "search.total",
    async () => {
      const pointers: string[] = [];
      for (const batch of batches) {
        const { value: candidates } = await trace.trace(
          "search.batch",
          () => scoutBatch(scoutModel, batch, checks, diff.label),
          { fields: { batch: batch.id } },
        );
        pointers.push(...candidates);
      }
      return pointers;
    },
  );

  const contexts = candidateContexts(batches, candidatePointers);
  const auditedContexts = contexts;
  const { value: result, ms: auditMs } = await trace.trace(
    "audit.candidates",
    () => auditCandidates(auditModel, diff, auditedContexts, checks),
    { fields: { candidates: auditedContexts.length } },
  );

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
      candidateCount: new Set(candidatePointers).size,
      entitiesScanned: 0,
      auditedCandidateCount: auditedContexts.length,
      scoutModelCalls: batches.length,
      auditModelCalls: auditedContexts.length > 0 ? 1 : 0,
      warnings: [],
      timingsMs: {
        diff: diffMs,
        modelLoad: modelMs,
        search: searchMs,
        audit: auditMs,
        total: Date.now() - startedAt,
      },
    },
    result,
  };
}

async function runSemEngine(
  command: AnalyzeCommand,
  checks: ReturnType<typeof enabledChecks>,
  startedAt: number,
): Promise<AnalysisReport> {
  const traceEvents: TraceEvent[] = [];
  const t = createTracer({
    onEvent: (event) => {
      traceEvents.push(event);
      debugSemTrace(command, event);
    },
  });

  const { value: changeSet, ms: diffMs } = await t.trace(
    "entity.diff",
    () => semChangeSetForCommand(command),
    {
      count: (v) => v.summary.total,
      detail: (v) => `${v.summary.fileCount} files`,
    },
  );

  printSemRunPlan(
    command,
    changeSet,
    checks.map((check) => check.id),
  );

  const { value: models, ms: modelMs } = await t.trace(
    "model.load",
    () => loadLocalModels(command.model),
    {
      count: () => 2,
      detail: () => "scout+audit",
    },
  );
  const { scoutModel, auditModel } = models;

  try {
    const candidateBatches = chunkSemChangeSet(changeSet);
    const { value: candidates, ms: searchMs } = await t.trace(
      "scout.total",
      async () =>
        candidateBatches.length === 0
          ? []
          : scoutSemBatches(
              scoutModel,
              candidateBatches,
              checks,
              command,
              traceEvents,
              t,
            ),
      {
        count: (v) => v.length,
        detail: () => `${candidateBatches.length} batches`,
      },
    );

    const { value: contexts, ms: contextMs } = await t.trace(
      "context.select",
      async () => entityContextsFromChanges(candidates, changeSet.changes),
      {
        fields: { candidates: candidates.length },
        count: (v) => v.length,
        detail: (v) => `${new Set(v.map((context) => context.filePath).filter(Boolean)).size} files`,
      },
    );

    const auditBatches = chunkSemContexts(contexts, command.auditBatchSize);
    const { value: result, ms: auditMs } = await t.trace(
      "audit.total",
      () =>
        findingsAuditBatches(
          auditModel,
          changeSet,
          auditBatches,
          checks,
          traceEvents,
          t,
          command,
        ),
      {
        count: (v) => v.findings.length,
        detail: (v) =>
          `${auditBatches.length} batches targets=${v.stats.totalTargets} clean=${v.stats.clean} uncertain=${v.stats.uncertain} invalid=${v.stats.invalid}`,
      },
    );

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

async function findingsAuditBatches(
  model: LocalModel,
  changeSet: SemChangeSet,
  batches: readonly (readonly SemContext[])[],
  checks: ReturnType<typeof enabledChecks>,
  traceEvents: TraceEvent[],
  t: ReturnType<typeof createTracer>,
  command: AnalyzeCommand,
): Promise<FindingsResult & { stats: AuditReviewStats }> {
  const findings = [];
  const summaries = [];
  const stats = { totalTargets: 0, finding: 0, clean: 0, uncertain: 0, invalid: 0 };
  for (const [index, batch] of batches.entries()) {
    const { value: pack } = await t.trace(
      "context.pack",
      () => repomixContextPack(changeSet.contextCwd, batch, changeSet.changes),
      {
        fields: { candidates: batch.length },
        count: (v) => v.filePaths.length,
        detail: (v) => `batch=${index + 1}/${batches.length} tokens=${v.totalTokens} chars=${v.totalCharacters}`,
      },
    );

    const { value: result } = await t.trace(
      "audit.batch",
      () => runFindingsAudit(model, changeSet, batch, pack, checks),
      {
        fields: { candidates: batch.length },
        count: (v) => v.findings.length,
        detail: (v) =>
          `batch=${index + 1}/${batches.length} candidates=${batch.length} targets=${v.stats.totalTargets} clean=${v.stats.clean} uncertain=${v.stats.uncertain} invalid=${v.stats.invalid}`,
      },
    );

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
    summary:
      findings.length === 0
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
  t: ReturnType<typeof createTracer>,
): Promise<readonly SemCandidate[]> {
  const candidates: SemCandidate[] = [];
  const seen = new Set<string>();
  for (const [index, batch] of batches.entries()) {
    if (candidates.length >= command.maxCandidates) break;
    const remaining: number = command.maxCandidates - candidates.length;
    const { value: batchCandidates } = await t.trace(
      "scout.batch",
      async () => scoutSemChanges(model, batch, checks, remaining),
      {
        fields: { entities: batch.changes.length },
        count: (v) => v.length,
        detail: (v) =>
          `batch=${index + 1}/${batches.length} entities=${batch.changes.length} remaining=${remaining}`,
      },
    );
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
  for (
    let index = 0;
    index < changeSet.changes.length;
    index += SEM_SCOUT_CHUNK_SIZE
  ) {
    const changes = changeSet.changes.slice(
      index,
      index + SEM_SCOUT_CHUNK_SIZE,
    );
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
  chunkSize: number,
): readonly (readonly SemContext[])[] {
  const chunks: SemContext[][] = [];
  for (let index = 0; index < contexts.length; index += chunkSize) {
    chunks.push(contexts.slice(index, index + chunkSize));
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
