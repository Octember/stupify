import { checkId, type StupifyCheck } from "./types.js";

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
    question: "Does the change metadata make authorship look untrustworthy by putting co-author wording in the author identity?",
    matchWhen: [
      "author metadata or an author signal says the author contains 'coauhtoried by'",
      "the author identity itself includes coauthored-by, co-authored-by, or similar co-author trailer text",
      "commit metadata makes it unclear who really wrote the code by putting co-author wording in the author field",
    ],
    doNotMatchWhen: [
      "a normal commit message body has a Co-authored-by trailer outside the author identity",
      "the diff only documents Git co-author trailer syntax",
    ],
    examples: {
      match: [
        "Author signal: author contains 'coauhtoried by'.",
        "The author identity contains Co-authored-by-style text instead of a clear author.",
      ],
      noMatch: [
        "A commit message has a normal Co-authored-by trailer in the body.",
        "Documentation explains how to add a Co-authored-by trailer.",
      ],
    },
  },
  {
    id: "mega_file",
    name: "Mega file",
    question: "Did the change cram too many classes, components, or responsibilities into one file?",
    matchWhen: [
      "adds multiple classes, components, services, or adapters to one new file when they have separate responsibilities",
      "turns one file into a catch-all module with unrelated types, helpers, state, and behavior",
      "creates a large file instead of extending the existing module boundaries nearby",
      "puts all classes in one file without a clear local convention requiring it",
    ],
    doNotMatchWhen: [
      "the file is a small barrel, fixture, or generated artifact",
      "the surrounding codebase already uses a single-file pattern for the same small unit",
      "the classes are tightly coupled implementation details of one small abstraction",
    ],
    examples: {
      match: [
        "Adds a repository, parser, validator, renderer, and CLI command class in one new module.",
        "Introduces several unrelated React components plus data helpers in one page file.",
      ],
      noMatch: [
        "Keeps a tiny helper class beside the only function that uses it.",
        "Adds a generated schema file that is intentionally monolithic.",
      ],
    },
  },
  {
    id: "over_commenting",
    name: "Over commenting",
    question: "Did the change add comments that narrate obvious code instead of explaining real intent?",
    matchWhen: [
      "adds comments before simple assignments, branches, imports, or function calls that are already self-explanatory",
      "uses comments as a substitute for clearer names or simpler structure",
      "adds dense step-by-step narration around straightforward implementation code",
      "leaves noisy comments that restate what the next line literally does",
    ],
    doNotMatchWhen: [
      "the comment explains a surprising constraint, external contract, workaround, or security decision",
      "the comment documents public API behavior that callers need",
      "the comment preserves context that cannot be represented in names or types",
    ],
    examples: {
      match: [
        "Adds comments like 'loop over items', 'return the result', or 'set the variable' around obvious code.",
        "Prefixes each small block in a short function with a comment that repeats the implementation.",
      ],
      noMatch: [
        "Explains why a non-obvious timeout matches a third-party service limit.",
        "Documents a public option whose behavior is not obvious from its name.",
      ],
    },
  },
  {
    id: "lint_bypass",
    name: "Lint bypass",
    question: "Did the change bypass lint or type rules instead of fixing the underlying issue?",
    matchWhen: [
      "adds eslint-disable, biome-ignore, ts-ignore, ts-expect-error, or similar suppression without a narrow explanation",
      "uses any, unknown casts, non-null assertions, or broad type assertions to silence a type problem",
      "turns off a rule for a file, block, or generated-looking section to make the change pass",
      "weakens lint, formatter, or typecheck configuration so new code avoids existing standards",
    ],
    doNotMatchWhen: [
      "the suppression is narrow, local, and explains an unavoidable external typing bug",
      "the file is generated and already excluded by project convention",
      "the change replaces a broad suppression with a narrower one",
    ],
    examples: {
      match: [
        "Adds // eslint-disable-next-line with no reason before new code.",
        "Adds // @ts-ignore to call an API instead of modeling the correct type.",
      ],
      noMatch: [
        "Uses @ts-expect-error in a type-level test that intentionally asserts a compiler error.",
        "Documents a third-party type defect next to a one-line suppression.",
      ],
    },
  },
  {
    id: "inconsistent_patterns",
    name: "Inconsistent patterns",
    question: "Did the change introduce patterns that clash with nearby files doing the same kind of work?",
    matchWhen: [
      "implements a workflow differently from adjacent modules without a clear reason",
      "mixes naming, error handling, state management, imports, or file layout styles across similar files",
      "uses a new abstraction shape where an existing local pattern already covers the same job",
      "adds code that looks copied from another stack or project instead of following this repository",
    ],
    doNotMatchWhen: [
      "the new pattern is isolated behind a deliberate boundary and removes real duplication",
      "the surrounding files are already inconsistent and the change follows the most recent local convention",
      "the difference is required by an external API or framework contract",
    ],
    examples: {
      match: [
        "Adds a new command parser style beside existing commands that use a shared parse helper.",
        "Handles errors with ad hoc strings in one file while sibling files return typed results.",
      ],
      noMatch: [
        "Introduces one adapter boundary around a genuinely different external SDK.",
        "Migrates all touched call sites to a single clearer pattern.",
      ],
    },
  },
  {
    id: "reinvented_utils",
    name: "Reinvented utils",
    question: "Did the change recreate utility logic that already exists in the repository or platform?",
    matchWhen: [
      "adds a new helper that duplicates an existing local utility, parser, formatter, validator, or adapter",
      "reimplements standard library behavior with custom code without adding domain-specific behavior",
      "copies small utility logic into a feature file instead of using the package-owned helper",
      "adds one-off normalization, parsing, date, path, or collection helpers while a nearby shared utility exists",
    ],
    doNotMatchWhen: [
      "the existing utility has the wrong contract or unsafe side effects for this caller",
      "the new helper is a small private expression that is clearer than importing shared machinery",
      "the change deletes or consolidates duplicate utility code",
    ],
    examples: {
      match: [
        "Adds a local slugify, clamp, parseJson, or path join helper when the repo already exports one.",
        "Implements custom array grouping beside an existing groupBy utility with the same behavior.",
      ],
      noMatch: [
        "Adds a domain-specific formatter whose output differs from the shared generic helper.",
        "Inlines a one-line predicate used only once.",
      ],
    },
  },
  {
    id: "operator_style_mismatch",
    name: "Operator style mismatch",
    question: "Does the change read unlike the established style of the surrounding code?",
    matchWhen: [
      "new code uses names, abstractions, comments, file structure, or control flow that feel alien next to nearby code",
      "the change is mechanically correct but lacks the concise, local style already present in the touched package",
      "the implementation sounds generic or template-like where surrounding code is direct and opinionated",
      "the change introduces a different engineering voice without a functional reason",
    ],
    doNotMatchWhen: [
      "the style difference comes from generated code, vendored code, or an external API shape",
      "the change intentionally follows a newer convention already established elsewhere in the repo",
      "the difference is limited to names required by a framework or protocol",
    ],
    examples: {
      match: [
        "Adds enterprise-style manager/factory naming in a package that uses small direct functions.",
        "Introduces generic tutorial-like comments and abstractions beside terse local implementation code.",
      ],
      noMatch: [
        "Uses framework-required route names that differ from internal helper naming.",
        "Updates old code to match a newer pattern already used in sibling modules.",
      ],
    },
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
