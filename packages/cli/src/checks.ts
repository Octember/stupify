import { checkId, type StupifyCheck } from "./types.ts";

export const defaultChecks: readonly StupifyCheck[] = [
  {
    id: checkId("duplicated_schema"),
    name: "Duplicated schema",
    question: "Did the change duplicate an existing type, schema, payload, or DTO shape?",
    lookFor: [
      "local shape mirrors existing fields and maps them one-for-one",
      "new response, payload, schema, or DTO adds no filtering, renaming, validation, or versioning",
    ],
    ignoreWhen: [
      "test fixture, mock, or intentional external contract",
    ],
  },
  {
    id: checkId("unnecessary_complexity"),
    name: "Unnecessary complexity",
    question: "Did the change add structure without buying clarity?",
    lookFor: [
      "helper, wrapper, service, layer, or extra file around simple logic without reuse",
    ],
    ignoreWhen: [
      "isolates dependency, removes duplication, or improves testability",
    ],
    hookMode: "warn",
    searchPrompt: `Find staged changes where a locally simple decision is made harder to understand by new indirection.
Only match when the staged diff clearly shows:
- a new named helper, wrapper, service, adapter, boundary, or abstraction
- and the surrounding change still appears locally simple
- and the new structure makes the decision harder to see
Do not match:
- plain conditionals, guard clauses, skip paths, or error handling
- normal feature structure
- exported utilities that are part of a real feature
- command plumbing
- prompt/instruction files
- domain configuration
- refactors that make ownership clearer
- changes where the payoff is unclear from the diff
Prefer no match over a weak match.`,
    searchExamples: {
      match: [
        "A small inline operation becomes a helper/service/wrapper with one obvious caller.",
        "A straightforward flow is split across files in a way that hides the decision.",
        "A new abstraction appears before there is evidence it buys clarity, correctness, reuse, or isolation.",
      ],
      nonMatch: [
        "A real external dependency boundary is isolated.",
        "A security/auth boundary becomes clearer.",
        "A refactor removes larger complexity elsewhere.",
        "Framework-required structure is added.",
      ],
    },
  },
  {
    id: checkId("fake_precision_windowing"),
    name: "Fake precision windowing",
    question: "Did the change add fake precision around model context?",
    lookFor: [
      "precise-looking counts, budgets, ratios, reports, or batching fields without useful behavior",
    ],
    ignoreWhen: [
      "simple fixed cap or chunking",
      "external API requirement",
    ],
  },
  {
    id: checkId("coauthored_slop"),
    name: "Coauthored slop",
    question: "Does author metadata contain co-author text?",
    lookFor: [
      "author signal contains coauhtoried, coauthored, or co-authored text",
    ],
    ignoreWhen: [
      "normal Co-authored-by trailer in the commit body",
    ],
  },
  {
    id: checkId("mega_file"),
    name: "Mega file",
    question: "Is a touched non-config file over 1000 LOC?",
    lookFor: [
      "touched non-config source file over 1000 LOC",
    ],
    ignoreWhen: [
      "config, lock, generated, fixture, or vendored file",
    ],
  },
  {
    id: checkId("over_commenting"),
    name: "Over commenting",
    question: "Did the change add noisy comments?",
    lookFor: [
      "comments restate obvious code or narrate simple logic",
    ],
    ignoreWhen: [
      "comment explains intent, constraint, workaround, or public API behavior",
    ],
    searchPrompt: "Find staged changes where comments appear to substitute for judgment rather than clarify it.",
    searchExamples: {
      match: [
        "New comments narrate obvious code instead of explaining tradeoffs.",
        "A simple change gains multiple generic comments that restate control flow.",
        "Comments make the code look more deliberate without adding useful reasoning.",
      ],
      nonMatch: [
        "Comments explain a real domain constraint.",
        "Comments document an external API quirk.",
        "Comments clarify a surprising edge case.",
        "Comments are sparse and specific.",
      ],
    },
  },
  {
    id: checkId("lint_bypass"),
    name: "Lint bypass",
    question: "Did the change bypass lint or type rules?",
    lookFor: [
      "adds suppressions, any, broad casts, or weakens lint/typecheck config",
    ],
    ignoreWhen: [
      "narrow suppression with a reason",
      "type-level test",
      "generated file convention",
    ],
  },
  {
    id: checkId("inconsistent_patterns"),
    name: "Inconsistent patterns",
    question: "Does the change clash with nearby patterns?",
    lookFor: [
      "same job uses different naming, errors, state, imports, or layout than nearby files",
    ],
    ignoreWhen: [
      "external API requires it",
      "change follows a newer local convention",
    ],
  },
  {
    id: checkId("reinvented_utils"),
    name: "Reinvented utils",
    question: "Did the change recreate an existing utility?",
    lookFor: [
      "new helper duplicates local utility or standard library behavior",
    ],
    ignoreWhen: [
      "existing utility has wrong contract",
      "new helper is clearer as a tiny private expression",
    ],
  },
  {
    id: checkId("operator_style_mismatch"),
    name: "Operator style mismatch",
    question: "Does the change read unlike the surrounding code?",
    lookFor: [
      "generic or template-like names, abstractions, comments, or control flow clash with local style",
    ],
    ignoreWhen: [
      "generated, vendored, framework-required, or newer established local style",
    ],
    enabledByDefault: false,
  },
] as const;

export function enabledChecks(checkIds: readonly string[] | null): readonly StupifyCheck[] {
  if (!checkIds) return defaultChecks.filter((check) => check.enabledByDefault !== false);

  return checksById(checkIds);
}

export function searchChecks(checkIds: readonly string[] | null): readonly StupifyCheck[] {
  if (!checkIds) return defaultChecks.filter((check) => check.hookMode === "warn");

  return checksById(checkIds);
}

function checksById(checkIds: readonly string[]): readonly StupifyCheck[] {
  const checksById = new Map<string, StupifyCheck>(defaultChecks.map((check) => [check.id, check]));
  return checkIds.map((id) => {
    const check = checksById.get(id);
    if (!check) throw new Error(`Unknown check: ${id}`);
    return check;
  });
}
