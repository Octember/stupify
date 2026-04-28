import assert from "node:assert/strict";
import test from "node:test";
import { parseCommand } from "../src/core/command.ts";
import { searchChecks } from "../src/core/checks.ts";

test("parses --staged as search mode", () => {
  assert.deepEqual(parseCommand(["--staged"]), {
    kind: "staged",
    mode: "search",
    source: "staged",
    checkIds: null,
    json: false,
    model: "gemma-4-e2b",
    debugSem: false,
    maxCandidates: 50,
    maxSearchInputTokens: 12_000,
    searchProfilePath: null,
    includeCounterReasonInPrompt: false,
  });
});

test("parses explicit search mode over staged changes", () => {
  assert.deepEqual(parseCommand(["--mode", "search", "--staged", "--json"]), {
    kind: "staged",
    mode: "search",
    source: "staged",
    checkIds: null,
    json: true,
    model: "gemma-4-e2b",
    debugSem: false,
    maxCandidates: 50,
    maxSearchInputTokens: 12_000,
    searchProfilePath: null,
    includeCounterReasonInPrompt: false,
  });
});

test("parses search profile and bench commands", () => {
  assert.deepEqual(parseCommand(["--staged", "--search-profile", "experiments/profiles/current_default.json"]), {
    kind: "staged",
    mode: "search",
    source: "staged",
    checkIds: null,
    json: false,
    model: "gemma-4-e2b",
    debugSem: false,
    maxCandidates: 50,
    maxSearchInputTokens: 12_000,
    searchProfilePath: "experiments/profiles/current_default.json",
    includeCounterReasonInPrompt: false,
  });
  assert.deepEqual(parseCommand(["bench", "search", "experiments/search-bench.json"]), {
    kind: "bench-search",
    configPath: "experiments/search-bench.json",
  });
});

test("counter reason prompt input is explicitly opt-in", () => {
  const command = parseCommand(["--staged", "--include-counter-reason-in-prompt"]);
  assert.equal(command.kind, "staged");
  if (command.kind === "staged") assert.equal(command.includeCounterReasonInPrompt, true);
});

test("parses hook subcommands", () => {
  assert.deepEqual(parseCommand(["hook", "status"]), { kind: "hook", action: "status" });
  assert.deepEqual(parseCommand(["hook", "install"]), { kind: "hook", action: "install" });
  assert.deepEqual(parseCommand(["hook", "uninstall"]), { kind: "hook", action: "uninstall" });
});

test("parses doctor command", () => {
  assert.deepEqual(parseCommand(["doctor"]), { kind: "doctor" });
});

test("default staged search patterns are graduated hook-safe checks", () => {
  assert.deepEqual(searchChecks(null).map((check) => check.id), [
    "duplicated_schema",
    "unnecessary_complexity",
    "over_commenting",
    "lint_bypass",
    "reinvented_utils",
  ]);
});

test("explicit checks can opt in non-default hook patterns", () => {
  assert.deepEqual(searchChecks(["operator_style_mismatch"]).map((check) => check.id), ["operator_style_mismatch"]);
  assert.deepEqual(searchChecks(["mega_file"]).map((check) => check.id), ["mega_file"]);
});
