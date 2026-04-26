import { checkId, type StupifyCheck } from "./types.ts";

export const defaultChecks: readonly StupifyCheck[] = [
  {
    id: checkId("duplicated_schema"),
    name: "Duplicated schema",
    question: "Did the change copy an existing or typed shape into a new local type, payload, DTO, schema, or response object?",
    lookFor: [
      "imports a shared or typed input and defines a local payload with matching fields",
      "maps fields one-for-one from an input object into an output object",
      "adds a type and a mapper that copy the same fields together",
      "adds a local type and mapper that copy the same property names even when the original type definition is not shown",
      "creates a response, payload, DTO, result, or schema shape without filtering, renaming, validating, or versioning fields",
    ],
    ignoreWhen: [
      "the output shape filters, renames, validates, versions, or intentionally hides fields",
      "the type is a test fixture or mock data shape",
    ],
    examples: {
      match: [
        "Receives a typed result, defines a local payload with the same fields, then maps each field across.",
        "Adds a new module that imports a typed input, defines a local output item type, and copies each item field into that output.",
        "Defines item and container payload types beside a mapper that copies matching fields from the input collection.",
        "Pattern: import a result type, define a local item shape with fields a/b/c, define a local payload containing those items, then map each input item field across.",
      ],
      noMatch: [
        "Creates a response type that intentionally hides private fields.",
        "Defines a versioned external contract with renamed fields.",
      ],
    },
  },
  {
    id: checkId("unnecessary_complexity"),
    name: "Unnecessary complexity",
    question: "Did the change add structure without buying clarity?",
    lookFor: [
      "simple logic split across layers",
      "wrapper/helper/service around one operation",
      "more files without clearer behavior",
    ],
    ignoreWhen: [
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
