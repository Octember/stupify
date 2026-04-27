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
  maxSearchInputTokens: 12_000,
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

  const output = renderSearchRun(run, command);

  assert.match(output, /too large for precise hook search/);
  assert.match(output, /skipped the hook scan/);
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
