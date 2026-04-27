import assert from "node:assert/strict";
import test from "node:test";
import { parseCommand } from "../src/command.ts";
import { searchChecks } from "../src/checks.ts";

test("parses --staged as search mode", () => {
  assert.deepEqual(parseCommand(["--staged"]), {
    kind: "staged",
    mode: "search",
    source: "staged",
    checkIds: null,
    json: false,
    model: "gemma-4-e2b",
    maxSearchInputTokens: 12_000,
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
    maxSearchInputTokens: 12_000,
  });
});

test("parses hook subcommands", () => {
  assert.deepEqual(parseCommand(["hook", "status"]), { kind: "hook", action: "status" });
  assert.deepEqual(parseCommand(["hook", "install"]), { kind: "hook", action: "install" });
  assert.deepEqual(parseCommand(["hook", "uninstall"]), { kind: "hook", action: "uninstall" });
});

test("default staged search patterns are intentionally narrow", () => {
  assert.deepEqual(searchChecks(null).map((check) => check.id), [
    "unnecessary_complexity",
  ]);
});

test("explicit checks can opt in non-default hook patterns", () => {
  assert.deepEqual(searchChecks(["lint_bypass"]).map((check) => check.id), ["lint_bypass"]);
  assert.deepEqual(searchChecks(["over_commenting"]).map((check) => check.id), ["over_commenting"]);
});
