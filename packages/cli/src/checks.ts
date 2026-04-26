import type { StupifyCheck } from "./types.js";

export const defaultChecks: readonly StupifyCheck[] = [
  {
    id: "duplicated_schema", name: "Duplicated schema",
    question: "Did the change copy an existing or typed shape into a new local type, payload, DTO, schema, or response object?",
    signals: [
      "imports a shared or typed input and defines a local payload with matching fields",
      "maps fields one-for-one from an input object into an output object",
      "adds a type and a mapper that copy the same fields together",
      "adds a local type and mapper that copy the same property names even when the original type definition is not shown",
      "creates a response, payload, DTO, result, or schema shape without filtering, renaming, validating, or versioning fields",
    ],
    examples: [
      "Receives a typed result, defines a local payload with the same fields, then maps each field across.",
      "Adds a new module that imports a typed input, defines a local output item type, and copies each item field into that output.",
      "Defines item and container payload types beside a mapper that copies matching fields from the input collection.",
      "Pattern: import a result type, define LocalItem with fields a/b/c, define LocalPayload with LocalItem[], then return input.items.map(item => ({ a: item.a, b: item.b, c: item.c })).",
      "Creates a boundary payload that mirrors the input type without changing the shape.",
      "Adds a validation schema that repeats an existing DTO field-for-field.",
      "Creates an API response type that mirrors the domain model without transformation.",
    ],
  },
  {
    id: "unnecessary_complexity", name: "Unnecessary complexity",
    question: "Did the change add structure without buying clarity?",
    signals: ["simple logic split across layers", "wrapper/helper/service around one operation", "more files without clearer behavior"],
    examples: [
      "Adds a helper, service, or wrapper around one direct operation without changing behavior.",
      "Moves a three-line calculation into a manager plus adapter plus factory.",
      "Introduces an orchestration layer that only forwards arguments.",
    ],
  },
] as const;

export function enabledChecks(checkIds: readonly string[] | null): readonly StupifyCheck[] {
  if (!checkIds) return defaultChecks;

  const checksById = new Map(defaultChecks.map((check) => [check.id, check]));
  return checkIds.map((id) => {
    const check = checksById.get(id);
    if (!check) throw new Error(`Unknown check: ${id}`);
    return check;
  });
}
