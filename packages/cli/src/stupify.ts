#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { analyzePack } from "./analysis.ts";
import { enabledChecks } from "./checks.ts";
import { parseCommand } from "./command.ts";
import { readDiffFromStdin } from "./diff.ts";
import { readUnitForCommit, readUnitsForRecentCommits, unitFromStdinDiff } from "./git.ts";
import { firstRunModelBootstrap, loadLocalModel } from "./model.ts";
import { packDiffs } from "./pack.ts";
import { helpText, renderFindings } from "./render.ts";
import { trace } from "./trace.ts";
import type { AnalyzeCommand, DiffPack, DiffUnit, FindingsResult, StupifyCheck } from "./types.ts";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const command = parseCommand(argv);
    if (command.kind === "help") {
      console.log(helpText());
      return 0;
    }

    const checks = enabledChecks(command.checkIds);
    const units = await trace.trace("diff.readUnits", async () => {
      return await readUnits(command);
    });
    const packs = trace.traceSync("diff.pack", () => packDiffs(units, checks), {
      units: units.length,
      checks: checks.length,
    });

    const { modelPath, model } = await trace.trace("model.load", async () => {
      const modelPath = await firstRunModelBootstrap();
      const model = await loadLocalModel(modelPath);
      return { modelPath, model };
    });

    const result = await trace.trace(
      "analyze.packs",
      async () => {
        return mergeResults(await analyzePacks(model, packs, checks));
      },
      { packs: packs.length, units: units.length, checks: checks.length, modelPath },
    );

    console.log(renderFindings(result, command));
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
