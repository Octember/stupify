import assert from "node:assert/strict";
import test from "node:test";
import { renderSearchRun } from "../src/render.ts";
import { checkId, type SearchCommand, type SearchRunJson } from "../src/types.ts";

const command: SearchCommand = {
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
};

test("renders oversized staged search as skipped, not clean", () => {
  const run: SearchRunJson = {
    schemaVersion: "search.v1",
    mode: "search",
    source: "staged",
    model: { id: "gemma-4-e2b" },
    patterns: [checkId("unnecessary_complexity")],
    stats: {
      elapsedMs: 123,
      modelCalls: 0,
      inputTokens: 18_400,
      inputTokenCap: 12_000,
      skipped: true,
      skipReason: "input_too_large",
    },
    matches: [],
  };

  const output = stripAnsi(renderSearchRun(run, command));

  assert.match(output, /Search skipped/);
  assert.match(output, /Size: ~18400 tokens/);
  assert.match(output, /Limit: 12000 tokens/);
  assert.match(output, /skipped the search/);
  assert.doesNotMatch(output, /No judgment-offload signals found/);
});

test("search JSON includes skip stats without human text", () => {
  const run: SearchRunJson = {
    schemaVersion: "search.v1",
    mode: "search",
    source: "staged",
    model: { id: "gemma-4-e2b" },
    patterns: [checkId("unnecessary_complexity")],
    stats: {
      elapsedMs: 123,
      modelCalls: 0,
      inputTokens: 18_400,
      inputTokenCap: 12_000,
      skipped: true,
      skipReason: "input_too_large",
    },
    matches: [],
  };

  const parsed = JSON.parse(renderSearchRun(run, { ...command, json: true })) as SearchRunJson;

  assert.equal(parsed.stats.skipped, true);
  assert.equal(parsed.stats.skipReason, "input_too_large");
  assert.equal(parsed.stats.modelCalls, 0);
  assert.deepEqual(parsed.matches, []);
});

test("renders matches as slop report fields", () => {
  const run: SearchRunJson = {
    schemaVersion: "search.v1",
    mode: "search",
    source: "staged",
    model: { id: "gemma-4-e2b" },
    patterns: [checkId("duplicated_schema")],
    stats: {
      elapsedMs: 123,
      modelCalls: 1,
      committers: ["Noah Lindner <noah@example.com>", "GitHub <noreply@github.com>"],
    },
    matches: [{
      targetId: "t001",
      patternId: checkId("duplicated_schema"),
      checkWhy: "Duplicated shapes drift.",
      reason: "Payload repeats the same fields.",
      proof: "src/foo.ts::type::FooPayload",
      snapshot: "type FooPayload = { id: string };",
    }],
  };

  const output = stripAnsi(renderSearchRun(run, command));

  assert.match(output, /AI SLOP DETECTED/);
  assert.match(output, /================/);
  assert.match(output, /1 signal across 1 file/);
  assert.match(output, /Noah Lindner · staged/);
  assert.match(output, /Warn-only\. Nothing blocked\./);
  assert.doesNotMatch(output, /GitHub/);
  assert.match(output, /duplicated_schema 1/);
  assert.match(output, /src\/foo\.ts/);
  assert.match(output, /1\. duplicated_schema/);
  assert.match(output, /Payload repeats the same fields\./);
  assert.match(output, /```\ntype FooPayload = \{ id: string \};\n```/);
  assert.match(output, /::type::FooPayload/);
  assert.match(output, /Duplicated shapes drift\./);
  assert.match(output, /1 signal\. Warn-only\. Nothing blocked\./);
  assert.doesNotMatch(output, /who:/);
  assert.doesNotMatch(output, /what:/);
  assert.doesNotMatch(output, /where:/);
});

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

test("renders since windows as short human labels", () => {
  const run: SearchRunJson = {
    schemaVersion: "search.v1",
    mode: "search",
    source: "since",
    model: { id: "gemma-4-e2b" },
    patterns: [checkId("duplicated_schema")],
    stats: {
      elapsedMs: 123,
      modelCalls: 1,
      committers: ["Noah Lindner <noah@example.com>"],
    },
    matches: [{
      targetId: "t001",
      patternId: checkId("duplicated_schema"),
      checkWhy: "Duplicated shapes drift.",
      reason: "Payload repeats the same fields.",
      proof: "src/foo.ts::type::FooPayload",
    }],
  };

  const output = renderSearchRun(run, { ...command, kind: "since", source: "since", since: "2 weeks ago" });

  assert.match(output, /Noah Lindner · last 2 weeks/);
});
