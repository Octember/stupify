#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { analyzePack } from "./analysis.js";
import { enabledChecks } from "./checks.js";
import { parseCommand } from "./command.js";
import { readDiffFromStdin } from "./diff.js";
import { readUnitForCommit, readUnitsForRecentCommits, unitFromStdinDiff } from "./git.js";
import { firstRunModelBootstrap, loadLocalModel } from "./model.js";
import { packDiffs } from "./pack.js";
import { helpText, renderFindings } from "./render.js";
import type { AnalyzeCommand, DiffPack, DiffUnit, FindingsResult, StupifyCheck } from "./types.js";

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
    const units = await readUnits(command);
    const packs = packDiffs(units, checks);
    const diffMs = Date.now() - diffStartedAt;

    const modelStartedAt = Date.now();
    const modelPath = await firstRunModelBootstrap();
    const model = await loadLocalModel(modelPath);
    const modelMs = Date.now() - modelStartedAt;

    const promptStartedAt = Date.now();
    const result = mergeResults(await analyzePacks(model, packs, checks));
    const promptMs = Date.now() - promptStartedAt;

    console.log(renderFindings(result, command));
    console.error(
      `Timing: total_ms=${Date.now() - startedAt} diff_ms=${diffMs} model_ms=${modelMs} prompt_ms=${promptMs} units=${units.length} packs=${packs.length} pack_bytes=${packs.reduce((total, pack) => total + pack.estimatedChars, 0)} checks=${checks.length}`,
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function readUnits(command: AnalyzeCommand): Promise<readonly DiffUnit[]> {
  if (command.kind === "commit") return [await readUnitForCommit(command.commit)];
  if (command.kind === "commits") return readUnitsForRecentCommits(command.count);

  const diff = await readDiffFromStdin();
  return [unitFromStdinDiff(diff.text)];
}

function mergeResults(results: readonly FindingsResult[]): FindingsResult {
  return { findings: results.flatMap((result) => result.findings) };
}

async function analyzePacks(
  model: Parameters<typeof analyzePack>[0],
  packs: readonly DiffPack[],
  checks: readonly StupifyCheck[],
): Promise<readonly FindingsResult[]> {
  const results: FindingsResult[] = [];
  for (const pack of packs) results.push(await analyzePack(model, pack, checks));
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
