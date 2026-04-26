import type { StupifyCheck } from "./types.ts";

export const defaultChecks: readonly StupifyCheck[] = [
  {
    id: "duplicated_schema",
    name: "Duplicated schema",
    question:
      "Does the diff recreate a schema, type, DTO, shape, or validation object that probably should have been imported, derived, or reused?",
    strongSignals: [
      "new type/interface/schema mirrors another shape",
      "manual field mapping between nearly identical objects",
      "new DTO or payload duplicates an existing domain model",
      "validation schema recreated instead of shared",
    ],
    weakSignals: ["a new type exists", "a schema was added", "fields have similar names"],
    falsePositives: [
      "intentional API boundary",
      "external contract",
      "security filtering",
      "versioned schema",
      "test fixture",
    ],
  },
  {
    id: "unnecessary_complexity",
    name: "Unnecessary complexity",
    question:
      "Does the diff add indirection, boundaries, helpers, layers, abstractions, or ceremony that do not appear to buy clarity, correctness, reuse, or isolation?",
    strongSignals: [
      "simple logic split across multiple new layers",
      "new abstraction with unclear pressure",
      "helper/wrapper/service added around one obvious operation",
      "boundary makes the decision harder to see",
      "more files but not more clarity",
    ],
    weakSignals: ["new helper function", "new class", "new file", "renaming or moving code"],
    falsePositives: [
      "real external dependency boundary",
      "security boundary",
      "framework-required structure",
      "testability improvement",
      "complexity removed elsewhere",
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
