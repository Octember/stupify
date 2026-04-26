#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { analyzeInput } from "./analysis.ts";
import { projectChange } from "./change-projector.ts";
import { enabledChecks } from "./checks.ts";
import { parseCommand } from "./command.ts";
import { MODEL_REGISTRY } from "./constants.ts";
import { artifactFromStdinDiff } from "./diff.ts";
import { projectionForCommit, projectionForRecentCommits } from "./git.ts";
import { firstRunModelBootstrap, loadLocalModel } from "./model.ts";
import { artifactFromProjectedChange } from "./repomix-adapter.ts";
import { helpText, renderFindings } from "./render.ts";
import { trace } from "./trace.ts";
import type { AnalyzeCommand, ChangeArtifact, ModelInput } from "./types.ts";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const startedAt = Date.now();
  try {
    const command = parseCommand(argv);
    if (command.kind === "help") {
      console.log(helpText());
      return 0;
    }

    const checks = enabledChecks(command.checkIds);
    const artifactStartedAt = Date.now();
    const input = await trace.trace("change.artifact", () => modelInput(command), {
      checks: checks.length,
    });
    const artifactMs = Date.now() - artifactStartedAt;
    printRunPlan(command, input);

    const modelStartedAt = Date.now();
    const { modelPath, model } = await trace.trace("model.load", async () => {
      const modelPath = await firstRunModelBootstrap(command.model);
      const model = await loadLocalModel(modelPath, MODEL_REGISTRY[command.model].name);
      return { modelPath, model };
    });
    const modelMs = Date.now() - modelStartedAt;

    const promptStartedAt = Date.now();
    const result = await trace.trace("analyze.change", () => analyzeInput(model, input, checks), {
      artifacts: input.artifacts.length,
      checks: checks.length,
      modelPath,
    });
    const promptMs = Date.now() - promptStartedAt;

    console.log(renderFindings(result, command));
    console.error(
      `Timing: total_ms=${Date.now() - startedAt} artifact_ms=${artifactMs} model_ms=${modelMs} prompt_ms=${promptMs} sources=${input.artifacts.length} model_calls=1 checks=${checks.length} model=${command.model}`,
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function printRunPlan(command: AnalyzeCommand, input: ModelInput): void {
  console.error("🧙 stupify 🪄");
  console.error(`Loading local model: ${MODEL_REGISTRY[command.model].name}`);
  if (command.kind === "commits") {
    console.error(`Analyzing last ${command.count} commits as one projected change.`);
  } else if (command.kind === "commit") {
    console.error(`Analyzing commit ${command.commit} as one projected change.`);
  } else {
    console.error("Analyzing stdin diff in one local process.");
  }
  console.error(`Source: ${input.artifacts.map((artifact) => artifact.id).join(", ")}`);
  console.error("Model calls: 1.");
}

async function modelInput(command: AnalyzeCommand): Promise<ModelInput> {
  const artifact = await changeArtifact(command);
  return { id: "change-001", artifacts: [artifact] };
}

async function changeArtifact(command: AnalyzeCommand): Promise<ChangeArtifact> {
  if (command.kind === "stdin") return artifactFromStdinDiff();

  const projection = command.kind === "commit"
    ? await projectionForCommit(command.commit)
    : await projectionForRecentCommits(command.count);
  const projected = await projectChange(projection);
  try {
    return await artifactFromProjectedChange(projected);
  } finally {
    await projected.cleanup();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
