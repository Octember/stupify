import { checkId, type AiSlopCheck } from "./types.ts";

export const defaultChecks: readonly AiSlopCheck[] = [
  {
    id: checkId("duplicated_schema"),
    name: "Duplicated schema",
    question: "Did the change duplicate an existing type, schema, payload, or DTO shape?",
    why: "Duplicated shapes make it easier for AI-assisted changes to drift away from the real source of truth.",
    lookFor: [
      "local shape mirrors existing fields and maps them one-for-one",
      "new response, payload, schema, or DTO adds no filtering, renaming, validation, or versioning",
    ],
    ignoreWhen: [
      "test fixture, mock, or intentional external contract",
      "public API DTO filters, omits, protects, renames, or versions fields",
    ],
    searchDefault: true,
    search: { enabled: false },
    languageOverrides: {
      typescript: {
        enabled: true,
        prompt: "Find only local/private payload or schema shapes that clearly copy another local shape one-for-one without creating a boundary. Do not match ordinary Input/Output/Request/Response types by name alone, public DTOs, external contracts, client types, or types that omit/protect private fields.",
        examples: {
          match: [
            "LocalUserPayload repeats User fields and maps id/email/displayName one-for-one.",
          ],
          nonMatch: [
            "PublicWebhookDto omits privateNotes from InternalJob.",
            "A client type describes an external dependency boundary.",
          ],
        },
      },
      javascript: {
        enabled: true,
        prompt: "Find only local/private payload or schema object shapes that clearly copy another local shape one-for-one without creating a boundary. Do not match public DTOs, external contracts, client types, or shapes that omit/protect private fields.",
        examples: {
          match: [
            "localUserPayload repeats user.id/user.email/user.displayName one-for-one.",
          ],
          nonMatch: [
            "Public webhook payload omits private notes from an internal job.",
          ],
        },
      },
    },
  },
  {
    id: checkId("unnecessary_complexity"),
    name: "Unnecessary complexity",
    question: "Did the change add structure without buying clarity?",
    why: "Extra indirection can hide simple decisions and make the code feel more designed than understood.",
    lookFor: [
      "helper, wrapper, manager, adapter, resolver, orchestrator, or extra file around simple logic without reuse",
    ],
    ignoreWhen: [
      "isolates dependency, removes duplication, or improves testability",
    ],
    searchDefault: true,
    search: {
      enabled: true,
      prompt: `Find staged changes where a locally simple decision is made harder to understand by new indirection.
Only match when the staged diff clearly shows:
- a new named helper, wrapper, manager, adapter, resolver, orchestrator, boundary, or abstraction
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
      counter: {
        ignoreEntityKindPattern: /^(field|interface|type)$/i,
      },
      examples: {
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
    languageOverrides: {
      rust: {
        counter: {
          ignoreEntityKindPattern: /^(field|interface|type)$/i,
          ignoreEntityNamePattern: /^test_/i,
          ignoreContentPattern: /#\s*\[\s*(tokio::)?test\s*\]/i,
        },
      },
    },
  },
  {
    id: checkId("fake_precision_windowing"),
    name: "Fake precision windowing",
    question: "Did the change add fake precision around model context?",
    why: "Precise-looking bookkeeping can create confidence without improving the actual behavior.",
    lookFor: [
      "precise-looking counts, budgets, ratios, reports, or batching fields without useful behavior",
    ],
    ignoreWhen: [
      "simple fixed cap or chunking",
      "external API requirement",
    ],
    search: { enabled: true },
  },
  {
    id: checkId("coauthored_slop"),
    name: "Coauthored slop",
    question: "Does author metadata contain co-author text?",
    why: "Careless metadata is a cheap signal that the change may not have been reviewed with intent.",
    lookFor: [
      "author signal contains coauhtoried, coauthored, or co-authored text",
    ],
    ignoreWhen: [
      "normal Co-authored-by trailer in the commit body",
    ],
    search: { enabled: true },
  },
  {
    id: checkId("mega_file"),
    name: "Mega file",
    question: "Is a touched non-config file over 1000 LOC?",
    why: "Large files make judgment harder by concentrating unrelated decisions in one place.",
    lookFor: [
      "touched non-config source file over 1000 LOC",
    ],
    ignoreWhen: [
      "config, lock, generated, fixture, or vendored file",
    ],
    search: { enabled: true },
  },
  {
    id: checkId("over_commenting"),
    name: "Over commenting",
    question: "Did the change add noisy comments?",
    why: "Narrative comments can make routine code look deliberate without clarifying the underlying tradeoff.",
    lookFor: [
      "comments restate obvious code or narrate simple logic",
    ],
    ignoreWhen: [
      "comment explains intent, constraint, workaround, or public API behavior",
    ],
    searchDefault: true,
    search: {
      enabled: true,
      prompt: "Find staged changes where comments appear to substitute for judgment rather than clarify it.",
      examples: {
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
          "Comments explain provider, finance, reconciliation, timezone, or ledger behavior.",
        ],
      },
    },
    languageOverrides: {
      python: { enabled: false },
      ruby: { enabled: false },
      rust: {
        counter: {
          ignoreEntityNamePattern: /^test_/i,
          ignoreContentPattern: /#\s*\[\s*(tokio::)?test\s*\]/i,
        },
      },
    },
  },
  {
    id: checkId("lint_bypass"),
    name: "Lint bypass",
    question: "Did the change bypass lint or type rules?",
    why: "Unexplained suppressions remove useful feedback exactly where a change needs more scrutiny.",
    lookFor: [
      "adds suppressions, any, broad casts, or weakens lint/typecheck config",
    ],
    ignoreWhen: [
      "narrow suppression with a reason",
      "type-level test",
      "generated file convention",
    ],
    searchDefault: true,
    search: { enabled: false },
    languageOverrides: {
      typescript: {
        enabled: true,
        prompt: "Find only broad lint/type bypasses that hide useful feedback. Match bare @ts-ignore, bare @ts-expect-error, broad casts, any, or eslint/biome suppressions without a concrete inline reason. Do not match targeted suppressions that include a reason for a known framework, test, mock, or external-library limitation.",
        examples: {
          match: [
            "A bare // @ts-ignore hides property access on unknown input.",
          ],
          nonMatch: [
            "// @ts-expect-error explains a known external library typing gap.",
          ],
        },
      },
      javascript: {
        enabled: true,
        prompt: "Find only broad lint bypasses that hide useful feedback. Match bare eslint-disable or biome-ignore comments without a concrete inline reason. Do not match targeted suppressions that explain a known framework, test, mock, or external-library limitation.",
        examples: {
          match: [
            "A bare // eslint-disable-next-line hides an unsafe access.",
          ],
          nonMatch: [
            "// eslint-disable-next-line no-console -- CLI intentionally writes progress.",
          ],
        },
      },
    },
  },
  {
    id: checkId("inconsistent_patterns"),
    name: "Inconsistent patterns",
    question: "Does the change clash with nearby patterns?",
    why: "Pattern drift can signal that a change followed generic suggestions instead of local codebase judgment.",
    lookFor: [
      "same job uses different naming, errors, state, imports, or layout than nearby files",
    ],
    ignoreWhen: [
      "external API requires it",
      "change follows a newer local convention",
    ],
    search: { enabled: true },
  },
  {
    id: checkId("reinvented_utils"),
    name: "Reinvented utils",
    question: "Did the change recreate an existing utility?",
    why: "Generic helper reinvention can be a sign that the change optimized for plausible code over local reuse.",
    lookFor: [
      "new helper duplicates local utility or standard library behavior",
    ],
    ignoreWhen: [
      "existing utility has wrong contract",
      "new helper is clearer as a tiny private expression",
      "helper is domain-specific or used by multiple local call sites",
    ],
    searchDefault: true,
    search: {
      enabled: true,
      prompt: "Find only tiny generic utility functions that recreate common helpers such as clamp, debounce, throttle, slugify, sort, pick, omit, uniq, or shuffle without domain-specific behavior. Do not match group/resolve/parse/format helpers, domain formatting, feature constants, or helpers with multiple obvious call sites.",
      examples: {
        match: [
          "clampValue returns min, max, or value.",
        ],
        nonMatch: [
          "formatCurrencyHelper is used by invoice and refund labels.",
          "Subscription tier constants encode domain configuration.",
        ],
      },
    },
  },
  {
    id: checkId("operator_style_mismatch"),
    name: "Operator style mismatch",
    question: "Does the change read unlike the surrounding code?",
    why: "Style mismatch can reveal generic generated code that was not reconciled with nearby conventions.",
    lookFor: [
      "generic or template-like names, abstractions, comments, or control flow clash with local style",
    ],
    ignoreWhen: [
      "generated, vendored, framework-required, or newer established local style",
    ],
    enabledByDefault: false,
    search: { enabled: true },
  },
] as const;

export function enabledChecks(checkIds: readonly string[] | null): readonly AiSlopCheck[] {
  if (!checkIds) return defaultChecks.filter((check) => check.enabledByDefault !== false);

  return checksById(checkIds);
}

export function searchChecks(checkIds: readonly string[] | null): readonly AiSlopCheck[] {
  if (!checkIds) return defaultChecks.filter((check) => check.searchDefault === true);

  return checksById(checkIds);
}

function checksById(checkIds: readonly string[]): readonly AiSlopCheck[] {
  const checksById = new Map<string, AiSlopCheck>(defaultChecks.map((check) => [check.id, check]));
  return checkIds.map((id) => {
    const check = checksById.get(id);
    if (!check) throw new Error(`Unknown check: ${id}`);
    return check;
  });
}
