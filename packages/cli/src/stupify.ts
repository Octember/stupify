#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  auditCandidates,
  countPromptTokens,
  findingsAuditRequest,
  runFindingsAudit,
  scoutBatch,
  scoutSemChanges,
} from "./analysis.ts";
import { batchDiff } from "./batcher.ts";
import { candidateContexts } from "./candidate-context.ts";
import { enabledChecks } from "./checks.ts";
import { parseCommand } from "./command.ts";
import { MODEL_REGISTRY } from "./constants.ts";
import { counterScoutTargets } from "./counter-scout.ts";
import { readDiffFromStdin } from "./diff.ts";
import { runExperiment } from "./experiment.ts";
import {
  netDiffForCommit,
  netDiffForRecentCommits,
  netDiffFromStdin,
  netDiffSince,
} from "./git.ts";
import { loadLocalModels, type LocalModel } from "./model.ts";
import { emptyContextPack, entityContextsFromChanges, repomixContextPack } from "./repomix-provider.ts";
import { helpText, renderReport } from "./render.ts";
import { semChangeSetForCommand } from "./sem-provider.ts";
import { trace } from "./trace.ts";
import type {
  AnalysisReport,
  AnalyzeCommand,
  AuditReviewResult,
  AuditReviewStats,
  DebugTarget,
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
    if (command.kind === "experiment") {
      const outputDir = await runExperiment(command.configPath);
      console.log(`Experiment results written to ${outputDir}`);
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
          { batch: batch.id },
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
    { candidates: auditedContexts.length },
  );

  return {
    run: {
      mode: command.kind,
      engine: command.engine,
      auditContext: command.auditContext,
      auditPrompt: command.auditPrompt,
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
      timingsMs: {
        diff: diffMs,
        modelLoad: modelMs,
        search: searchMs,
        audit: auditMs,
        total: Date.now() - startedAt,
      },
      warnings: [],
      debugTargets: command.debugTargets ? [] : undefined,
    },
    result,
  };
}

async function runSemEngine(
  command: AnalyzeCommand,
  checks: ReturnType<typeof enabledChecks>,
  startedAt: number,
): Promise<AnalysisReport> {
  const { value: changeSet, ms: diffMs } = await trace.trace("entity.diff", () =>
    semChangeSetForCommand(command),
  );
  const traceEvents: TraceEvent[] = [
    {
      name: "entity.diff",
      ms: diffMs,
      count: changeSet.summary.total,
      detail: `${changeSet.summary.fileCount} files`,
    },
  ];
  debugSemTrace(command, traceEvents[0]);

  printSemRunPlan(
    command,
    changeSet,
    checks.map((check) => check.id),
  );

  const { value: models, ms: modelMs } = await trace.trace(
    "model.load",
    () => loadLocalModels(command.model),
  );
  const { scoutModel, auditModel } = models;
  traceEvents.push({
    name: "model.load",
    ms: modelMs,
    count: 2,
    detail: "scout+audit",
  });
  debugSemTrace(command, traceEvents[traceEvents.length - 1]);

  try {
    const candidateBatches = chunkSemChangeSet(changeSet);
    const { value: candidates, ms: searchMs } = await trace.trace(
      "scout.total",
      async () =>
        candidateBatches.length === 0
          ? []
          : command.scout === "counter"
            ? counterScoutTargets(changeSet, checks, command.maxCandidates)
            : scoutSemBatches(
                scoutModel,
                candidateBatches,
                checks,
                command,
                traceEvents,
              ),
    );
    traceEvents.push({
      name: "scout.total",
      ms: searchMs,
      count: candidates.length,
      detail: `${command.scout} scout ${candidateBatches.length} batches`,
    });
    debugSemTrace(command, traceEvents[traceEvents.length - 1]);

    const { value: contexts, ms: contextMs } = await trace.trace(
      "context.select",
      () => entityContextsFromChanges(candidates, changeSet.changes),
      { candidates: candidates.length },
    );
    traceEvents.push({
      name: "context.select",
      ms: contextMs,
      count: contexts.length,
      detail: `${new Set(contexts.map((context) => context.filePath).filter(Boolean)).size} files`,
    });
    debugSemTrace(command, traceEvents[traceEvents.length - 1]);

    const auditBatches = chunkSemContexts(contexts, command.auditBatchSize);
    const { value: result, ms: auditMs } = await trace.trace(
      "audit.total",
      () =>
        findingsAuditBatches(
          auditModel,
          changeSet,
          auditBatches,
          checks,
          traceEvents,
          command,
        ),
    );
    traceEvents.push({
      name: "audit.total",
      ms: auditMs,
      count: result.findings.length,
      detail: `${result.auditModelCalls} calls targets=${result.stats.totalTargets} clean=${result.stats.clean} uncertain=${result.stats.uncertain} invalid=${result.stats.invalid}`,
    });
    debugSemTrace(command, traceEvents[traceEvents.length - 1]);

    return {
      run: {
        mode: command.kind,
        engine: command.engine,
        auditContext: command.auditContext,
        auditPrompt: command.auditPrompt,
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
        targetsByCheck: countTargetsByCheck(candidates),
        auditedCandidateCount: contexts.length,
        scoutModelCalls: traceEvents.filter((event) => event.name === "scout.batch").length,
        auditModelCalls: result.auditModelCalls,
        timingsMs: {
          diff: diffMs,
          modelLoad: modelMs,
          search: searchMs,
          audit: auditMs + contextMs,
          total: Date.now() - startedAt,
        },
        warnings: [],
        auditStats: result.stats,
        debugTargets: command.debugTargets ? debugTargetsFromContexts(contexts, changeSet.label) : undefined,
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
  command: AnalyzeCommand,
): Promise<FindingsResult & { stats: AuditReviewStats; auditModelCalls: number }> {
  const findings = [];
  const stats = { totalTargets: 0, finding: 0, clean: 0, uncertain: 0, invalid: 0 };
  const limiter = new ConcurrencyLimiter(command.auditConcurrency);
  for (const [index, batch] of batches.entries()) {
    const result = await findingsAuditBatch(
      model,
      changeSet,
      batch,
      checks,
      traceEvents,
      command,
      limiter,
      `${index + 1}/${batches.length}`,
    );
    findings.push(...result.findings);
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
        : `${findings.length} finding review${findings.length === 1 ? "" : "s"} accepted.`,
    stats,
    auditModelCalls: traceEvents.filter((event) => event.name === "audit.batch").length,
  };
}

async function findingsAuditBatch(
  model: LocalModel,
  changeSet: SemChangeSet,
  batch: readonly SemContext[],
  checks: ReturnType<typeof enabledChecks>,
  traceEvents: TraceEvent[],
  command: AnalyzeCommand,
  limiter: ConcurrencyLimiter,
  batchLabel: string,
): Promise<AuditReviewResult> {
  const { value: pack, ms: contextMs } = await trace.trace(
    "context.pack",
    () =>
      command.auditContext === "none"
        ? Promise.resolve(emptyContextPack())
        : repomixContextPack(changeSet.contextCwd, batch, changeSet.changes),
    { candidates: batch.length },
  );
  const request = findingsAuditRequest(changeSet, batch, pack, checks, command.auditPrompt);
  const inputTokens = await countPromptTokens(model, request.prompt);
  const contextEvent = {
    name: "context.pack",
    ms: contextMs,
    count: pack.filePaths.length,
    detail: `batch=${batchLabel} input_tokens=${inputTokens} pack_tokens=${pack.totalTokens} chars=${pack.totalCharacters}`,
  };
  traceEvents.push(contextEvent);
  debugSemTrace(command, contextEvent);

  if (inputTokens > command.maxAuditInputTokens) {
    if (batch.length <= 1) {
      throw new Error(`Findings audit input has ${inputTokens} tokens, above max ${command.maxAuditInputTokens}.`);
    }
    const splitAt = Math.ceil(batch.length / 2);
    const splitEvent = {
      name: "audit.split",
      ms: 0,
      count: batch.length,
      detail: `batch=${batchLabel} input_tokens=${inputTokens} max=${command.maxAuditInputTokens}`,
    };
    traceEvents.push(splitEvent);
    debugSemTrace(command, splitEvent);
    const [left, right] = await Promise.all([
      findingsAuditBatch(
        model,
        changeSet,
        batch.slice(0, splitAt),
        checks,
        traceEvents,
        command,
        limiter,
        `${batchLabel}.1`,
      ),
      findingsAuditBatch(
        model,
        changeSet,
        batch.slice(splitAt),
        checks,
        traceEvents,
        command,
        limiter,
        `${batchLabel}.2`,
      ),
    ]);
    return combineAuditResults(left, right);
  }

  const { value: result, ms: auditMs } = await trace.trace(
    "audit.batch",
    () => limiter.run(() => runFindingsAudit(model, changeSet, batch, pack, checks, request)),
    { candidates: batch.length },
  );
  const event = {
    name: "audit.batch",
    ms: auditMs,
    count: result.findings.length,
    detail: `batch=${batchLabel} candidates=${batch.length} input_tokens=${inputTokens} targets=${result.stats.totalTargets} clean=${result.stats.clean} uncertain=${result.stats.uncertain} invalid=${result.stats.invalid}`,
  };
  traceEvents.push(event);
  debugSemTrace(command, event);
  return result;
}

function combineAuditResults(
  left: AuditReviewResult,
  right: AuditReviewResult,
): AuditReviewResult {
  const findings = [...left.findings, ...right.findings];
  return {
    findings,
    summary:
      findings.length === 0
        ? "No clear judgment-offload signal found."
        : `${findings.length} finding review${findings.length === 1 ? "" : "s"} accepted.`,
    stats: {
      totalTargets: left.stats.totalTargets + right.stats.totalTargets,
      finding: left.stats.finding + right.stats.finding,
      clean: left.stats.clean + right.stats.clean,
      uncertain: left.stats.uncertain + right.stats.uncertain,
      invalid: left.stats.invalid + right.stats.invalid,
    },
  };
}

function countTargetsByCheck(candidates: readonly SemCandidate[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const candidate of candidates) {
    counts[candidate.checkId] = (counts[candidate.checkId] ?? 0) + 1;
  }
  return counts;
}

function debugTargetsFromContexts(
  contexts: readonly SemContext[],
  sourceLabel: string,
): readonly DebugTarget[] {
  return contexts.map((context) => ({
    targetId: context.targetId,
    checkId: context.checkId,
    entityId: context.entityId,
    entityKind: context.entityKind,
    changeKind: context.changeKind,
    scoutReason: context.reason,
    sourceLabel,
  }));
}

class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
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
  const targetsByCheck = new Map<string, number>();
  const maxTargetsPerCheck = 6;
  for (const [index, batch] of batches.entries()) {
    if (candidates.length >= command.maxCandidates) break;
    const remaining = command.maxCandidates - candidates.length;
    const { value: batchCandidates, ms } = await trace.trace(
      "scout.batch",
      () => scoutSemChanges(model, batch, checks, remaining),
      { entities: batch.changes.length },
    );
    const event = {
      name: "scout.batch",
      ms,
      count: batchCandidates.length,
      detail: `batch=${index + 1}/${batches.length} entities=${batch.changes.length} remaining=${remaining}`,
    };
    traceEvents.push(event);
    debugSemTrace(command, event);
    for (const candidate of batchCandidates) {
      const key = `${candidate.entityId}\u0000${candidate.checkId}`;
      if (seen.has(key)) continue;
      const checkCount = targetsByCheck.get(candidate.checkId) ?? 0;
      if (checkCount >= maxTargetsPerCheck) continue;
      seen.add(key);
      targetsByCheck.set(candidate.checkId, checkCount + 1);
      candidates.push({
        ...candidate,
        targetId: `t${String(candidates.length + 1).padStart(3, "0")}`,
      });
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
