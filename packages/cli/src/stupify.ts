#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCommand } from "./core/command.ts";
import { createCliUi } from "./core/ui.ts";
import { renderDoctorToUi, runDoctor } from "./operator/doctor.ts";
import { renderHookResultToUi, runHookCommand } from "./operator/hooks.ts";
import { helpText, renderSearchRun, renderSearchRunToUi } from "./render/render.ts";
import { runSearchCommand } from "./search/run-search-command.ts";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const startedAt = Date.now();
  let ui = createCliUi();
  try {
    const command = parseCommand(argv);
    if (command.kind === "help") {
      ui.intro("stupify");
      ui.note(helpText().trim(), "Help");
      ui.outro("Local-only. Warn-only.");
      return 0;
    }
    if (command.kind === "hook") {
      ui.intro("stupify");
      renderHookResultToUi(await runHookCommand(command.action), ui);
      ui.outro("Hook mode is warn-only. Commits are not blocked.");
      return 0;
    }
    if (command.kind === "doctor") {
      const result = await runDoctor();
      ui.intro("stupify");
      renderDoctorToUi(result, ui);
      ui.outro(result.exitCode === 0 ? "Ready." : "Fix missing required dependencies, then rerun doctor.");
      return result.exitCode;
    }
    if (command.kind === "bench-search") {
      const { runSearchBench } = await import("./search/search-bench.ts");
      ui.intro("stupify");
      ui.note(await runSearchBench(command.configPath), "Search bench");
      ui.outro("Bench complete.");
      return 0;
    }

    ui = createCliUi({ quiet: command.json });
    const run = await runSearchCommand(command, startedAt, ui);
    if (command.json) ui.writeStdout(renderSearchRun(run, command));
    else renderSearchRunToUi(run, command, ui);
    return 0;
  } catch (error) {
    ui.error(error instanceof Error ? error.message : String(error), { force: true });
    return 1;
  }
}

export { runSearchCommand } from "./search/run-search-command.ts";

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
