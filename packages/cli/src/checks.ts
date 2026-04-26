import { checkId, type StupifyCheck } from "./types.js";

// KEEP CHECKS CONCISE! They run in every prompt. DO NOT duplicate prompting.
export const defaultChecks: readonly StupifyCheck[] = [
  {
    id: checkId("duplicated_schema"), name: "Duplicated schema",
    question: "Did the change copy an existing or typed shape into a new local type, payload, DTO, schema, or response object?",
    matchWhen: [
      "imports a shared or typed input and defines a local payload with matching fields",
      "maps fields one-for-one from an input object into an output object",
      "adds a type and a mapper that copy the same fields together",
      "adds a local type and mapper that copy the same property names even when the original type definition is not shown",
      "creates a response, payload, DTO, result, or schema shape without filtering, renaming, validating, or versioning fields",
    ],
    doNotMatchWhen: [
      "the output shape filters, renames, validates, versions, or intentionally hides fields",
      "the type is a test fixture or mock data shape",
    ],
    examples: {
      match: [
        "Receives a typed result, defines a local payload with the same fields, then maps each field across.",
        "Adds a new module that imports a typed input, defines a local output item type, and copies each item field into that output.",
        "Defines item and container payload types beside a mapper that copies matching fields from the input collection.",
        "Pattern: import a result type, define LocalItem with fields a/b/c, define LocalPayload with LocalItem[], then return input.items.map(item => ({ a: item.a, b: item.b, c: item.c })).",
      ],
      noMatch: [
        "Creates a response type that intentionally hides private fields.",
        "Defines a versioned external contract with renamed fields.",
      ],
    },
  },
  {
    id: checkId("unnecessary_complexity"), name: "Unnecessary complexity",
    question: "Did the change add structure without buying clarity?",
    matchWhen: ["simple logic split across layers", "wrapper/helper/service around one operation", "more files without clearer behavior"],
    doNotMatchWhen: [
      "the boundary isolates an external dependency",
      "the extraction removes duplication or makes behavior easier to test",
    ],
    examples: {
      match: [
        "Adds a helper, service, or wrapper around one direct operation without changing behavior.",
        "Moves a three-line calculation into a manager plus adapter plus factory.",
        "Introduces an orchestration layer that only forwards arguments.",
      ],
      noMatch: [
        "Extracts a reused calculation into a named function.",
        "Adds a boundary around a flaky external service.",
      ],
    },
  },
  {
    id: checkId("fake_precision_windowing"),
    name: "Fake precision windowing",
    question: "Did the change add elaborate counting, budgeting, batching, or accounting logic that pretends to manage model context more precisely than it actually can?",
    matchWhen: [
      "adds character-count budgets, ratios, estimates, or accounting fields around prompt/model-window management",
      "introduces reporting about estimated prompt size, merged counts, split counts, or context counts before the behavior is actually useful",
      "adds several types or fields to describe model batching without improving the user-facing judgment",
      "uses precise-looking counters as a substitute for a simpler fixed batching rule",
    ],
    doNotMatchWhen: [
      "the logic is a small fixed cap or simple chunking rule",
      "the accounting is required by an external API contract",
    ],
    examples: {
      match: [
        "Adds estimatedPromptChars, relatedContextCharCount, batchCount, splitSourceCount, and warnings around a simple model call loop.",
        "Computes several prompt budgets and ratios even though the model still just receives plain text.",
      ],
      noMatch: [
        "Limits each model call to a small fixed number of commits.",
        "Splits an obviously huge input into simple consecutive chunks.",
      ],
    },
  },
  {
    id: "coauthored_slop",
    name: "Coauthored slop",
    question: "Does author metadata contain co-author text?",
    matchWhen: [
      "author signal says author contains coauhtoried/coauthored/co-authored text",
    ],
    doNotMatchWhen: [
      "normal Co-authored-by trailer in the commit body",
    ],
  },
  {
    id: "mega_file",
    name: "Mega file",
    question: "Does the change create or keep a non-config file over 1000 LOC?",
    matchWhen: [
      "a touched source file is over 1000 lines",
    ],
    doNotMatchWhen: [
      "config, lock, generated, fixture, or vendored file",
    ],
  },
  {
    id: "over_commenting",
    name: "Over commenting",
    question: "Did the change add noisy comments?",
    matchWhen: [
      "comments restate obvious code",
      "step-by-step narration around simple logic",
    ],
    doNotMatchWhen: [
      "comment explains intent, constraint, workaround, or public API behavior",
    ],
  },
  {
    id: "lint_bypass",
    name: "Lint bypass",
    question: "Did the change bypass lint or type rules?",
    matchWhen: [
      "adds eslint-disable, biome-ignore, ts-ignore, ts-expect-error, any, or broad casts",
      "weakens lint, format, or typecheck config",
    ],
    doNotMatchWhen: [
      "narrow suppression with a reason, type-level test, or generated file convention",
    ],
  },
  {
    id: "inconsistent_patterns",
    name: "Inconsistent patterns",
    question: "Does the change clash with nearby patterns?",
    matchWhen: [
      "same job done differently than adjacent files",
      "new naming, error, state, import, or layout style without reason",
    ],
    doNotMatchWhen: [
      "external API requires it or change follows a newer local convention",
    ],
  },
  {
    id: "reinvented_utils",
    name: "Reinvented utils",
    question: "Did the change recreate an existing utility?",
    matchWhen: [
      "new helper duplicates local utility or standard library behavior",
      "one-off parse, format, normalize, path, date, or collection helper where shared one exists",
    ],
    doNotMatchWhen: [
      "existing utility has wrong contract or new helper is clearer as a tiny private expression",
    ],
  },
  {
    id: "operator_style_mismatch",
    name: "Operator style mismatch",
    question: "Does the change read unlike the surrounding code?",
    matchWhen: [
      "generic/template-like code next to direct local style",
      "names, abstractions, comments, or control flow feel alien in the touched package",
    ],
    doNotMatchWhen: [
      "generated, vendored, framework-required, or newer established local style",
    ],
  },
] as const;

export function enabledChecks(checkIds: readonly string[] | null): readonly StupifyCheck[] {
  if (!checkIds) return defaultChecks;

  const checksById = new Map<string, StupifyCheck>(defaultChecks.map((check) => [check.id, check]));
  return checkIds.map((id) => {
    const check = checksById.get(id);
    if (!check) throw new Error(`Unknown check: ${id}`);
    return check;
  });
}
