import { checkId, type StupifyCheck } from "./types.ts";

// KEEP CHECKS CONCISE! They run in every prompt. DO NOT duplicate prompting.
export const defaultChecks: readonly StupifyCheck[] = [
  {
    id: checkId("duplicated_schema"),
    name: "Duplicated schema",
    question:
      "Did the change duplicate an existing type, schema, payload, or DTO shape?",
    matchWhen: [
      "local shape mirrors existing fields and maps them one-for-one",
      "new response/payload/schema adds no filtering, renaming, validation, or versioning",
    ],
    doNotMatchWhen: ["test fixture, mock, or intentional external contract"],
  },
  {
    id: checkId("unnecessary_complexity"),
    name: "Unnecessary complexity",
    question: "Did the change add structure without buying clarity?",
    matchWhen: [
      "helper, wrapper, service, layer, or extra file around simple logic without reuse",
    ],
    doNotMatchWhen: [
      "isolates dependency, removes duplication, or improves testability",
    ],
  },
  {
    id: checkId("fake_precision_windowing"),
    name: "Fake precision windowing",
    question: "Did the change add fake precision around model context?",
    matchWhen: [
      "precise-looking counts, budgets, ratios, reports, or batching fields without useful behavior",
    ],
    doNotMatchWhen: ["simple fixed cap/chunking or external API requirement"],
  },
  {
    id: checkId("coauthored_slop"),
    name: "Coauthored slop",
    question: "Does author metadata contain co-author text?",
    matchWhen: [
      "author signal contains coauhtoried/coauthored/co-authored text",
    ],
    doNotMatchWhen: [],
  },
  {
    id: checkId("mega_file"),
    name: "Mega file",
    question: "Is a touched non-config file over 1000 LOC?",
    matchWhen: ["touched non-config source file >1000 LOC"],
    doNotMatchWhen: ["config, lock, generated, fixture, or vendored file"],
  },
  {
    id: checkId("class_pile"),
    name: "Class pile",
    question: "Are unrelated classes crammed into one file?",
    matchWhen: ["multiple unrelated classes in one touched file"],
    doNotMatchWhen: ["small private helper class or generated file"],
  },
  {
    id: checkId("over_commenting"),
    name: "Over commenting",
    question: "Did the change add noisy comments?",
    matchWhen: ["comments restate obvious code or narrate simple logic"],
    doNotMatchWhen: [
      "comment explains intent, constraint, workaround, or public API behavior",
    ],
  },
  {
    id: checkId("fake_history"),
    name: "Fake history",
    question: "Does code or comments cite history that is not real?",
    matchWhen: ["claims 'we do this because X' but X is not in the artifact"],
    doNotMatchWhen: [
      "references visible code, issue IDs, docs, or real historical context",
    ],
  },
  {
    id: checkId("lint_bypass"),
    name: "Lint bypass",
    question: "Did the change bypass lint or type rules?",
    matchWhen: [
      "adds suppressions, any/broad casts, or weakens lint/typecheck config",
    ],
    doNotMatchWhen: [
      "narrow suppression with a reason, type-level test, or generated file convention",
    ],
  },
  {
    id: checkId("bad_names"),
    name: "Bad names",
    question: "Did the change add short non-descriptive names?",
    matchWhen: ["new names like tmp/res/obj/data/val/x hide intent"],
    doNotMatchWhen: ["tiny loop index or established local abbreviation"],
  },
  {
    id: checkId("inconsistent_patterns"),
    name: "Inconsistent patterns",
    question: "Does the change clash with nearby patterns?",
    matchWhen: [
      "same job uses different naming, errors, state, imports, or layout than nearby files",
    ],
    doNotMatchWhen: [
      "external API requires it or change follows a newer local convention",
    ],
  },
  {
    id: checkId("reinvented_utils"),
    name: "Reinvented utils",
    question: "Did the change recreate an existing utility?",
    matchWhen: [
      "new helper duplicates local, standard, or well-known library behavior",
    ],
    doNotMatchWhen: [
      "existing utility has wrong contract or new helper is clearer as a tiny private expression",
    ],
  },
  {
    id: checkId("clever_loop"),
    name: "Clever loop",
    question: "Did the change over-optimize loop code?",
    matchWhen: ["manual/clever loop where simple iteration would be clearer"],
    doNotMatchWhen: [
      "measured hot path or simpler than available abstractions",
    ],
  },
  {
    id: checkId("imaginary_edges"),
    name: "Imaginary edges",
    question: "Did the change handle exception cases nobody cares about?",
    matchWhen: ["branches, fallbacks, or states for unrealistic edge cases"],
    doNotMatchWhen: [
      "real user, API, security, data-loss, or compatibility case",
    ],
  },
  {
    id: checkId("operator_style_mismatch"),
    name: "Operator style mismatch",
    question: "Does the change read unlike the surrounding code?",
    matchWhen: [
      "generic/template-like names, abstractions, comments, or control flow clash with local style",
    ],
    doNotMatchWhen: [
      "generated, vendored, framework-required, or newer established local style",
    ],
  },
] as const;

export function enabledChecks(
  checkIds: readonly string[] | null,
): readonly StupifyCheck[] {
  if (!checkIds) return defaultChecks;

  const checksById = new Map<string, StupifyCheck>(
    defaultChecks.map((check) => [check.id, check]),
  );
  return checkIds.map((id) => {
    const check = checksById.get(id);
    if (!check) throw new Error(`Unknown check: ${id}`);
    return check;
  });
}
