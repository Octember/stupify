#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { auditCandidates, scoutBatch } from "./analysis.ts";
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
import { firstRunModelBootstrap, loadLocalModel } from "./model.ts";
import { helpText, renderReport } from "./render.ts";
import { trace } from "./trace.ts";
import type { AnalysisReport, AnalyzeCommand, NetDiff } from "./types.ts";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const startedAt = Date.now();
  try {
    const command = parseCommand(argv);
    if (command.kind === "help") {
      console.log(helpText());
      return 0;
    }

    const checks = enabledChecks(command.checkIds);
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
    const model = await loadLocalModel(modelPath, command.model);
    const modelMs = Date.now() - modelStartedAt;

    const batches = batchDiff(diff.text);
    const searchStartedAt = Date.now();
    const candidatePointers: string[] = [];
    for (const batch of batches) {
      const candidates = await trace.trace(
        "search.batch",
        () => scoutBatch(model, batch, checks, diff.label),
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
      () => auditCandidates(model, diff, auditedContexts, checks),
      {
        candidates: auditedContexts.length,
      },
    );
    const auditMs = Date.now() - auditStartedAt;

    const report: AnalysisReport = {
      run: {
        mode: command.kind,
        modelId: command.model,
        checkIds: checks.map((check) => check.id),
        sourceId: diff.id,
        label: diff.label,
        stats: diff.stats,
        batchesScanned: batches.length,
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

    console.log(renderReport(report, command));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
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
