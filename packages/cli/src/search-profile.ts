import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultChecks, searchChecks } from "./checks.ts";
import type {
  RepomixSearchConfig,
  SearchProfile,
  SearchProfilePattern,
  StupifyCheck,
} from "./types.ts";

export async function loadSearchProfile(profilePath: string | null): Promise<SearchProfile | null> {
  if (!profilePath) return null;
  const fullPath = path.resolve(profilePath);
  const value = JSON.parse(await readFile(fullPath, "utf8")) as SearchProfile;
  if (!value || typeof value !== "object" || typeof value.id !== "string" || value.id.length === 0) {
    throw new Error(`Invalid search profile: ${profilePath}`);
  }
  return value;
}

export function effectiveSearchChecks(
  explicitCheckIds: readonly string[] | null,
  profile: SearchProfile | null,
): readonly StupifyCheck[] {
  const checks = explicitCheckIds
    ? searchChecks(explicitCheckIds)
    : profilePatternIds(profile).length > 0
      ? checksById(profilePatternIds(profile))
      : searchChecks(null);

  if (!profile?.patterns) return checks;
  return checks.map((check) => applyPatternOverride(check, profile.patterns?.[check.id]));
}

export function effectiveMaxCandidates(defaultValue: number, profile: SearchProfile | null): number {
  return positiveInteger(profile?.maxCandidates) ?? defaultValue;
}

export function effectiveMaxSearchInputTokens(defaultValue: number, profile: SearchProfile | null): number {
  return positiveInteger(profile?.maxSearchInputTokens) ?? defaultValue;
}

export function effectiveRepomixConfig(
  defaultValue: RepomixSearchConfig,
  profile: SearchProfile | null,
): RepomixSearchConfig {
  const override = profile?.repomix;
  if (!override) return defaultValue;
  return {
    compress: override.compress ?? defaultValue.compress,
    showLineNumbers: override.showLineNumbers ?? defaultValue.showLineNumbers,
    removeEmptyLines: override.removeEmptyLines ?? defaultValue.removeEmptyLines,
    maxFileSizeBytes: positiveInteger(override.maxFileBytes) ?? defaultValue.maxFileSizeBytes,
    maxTotalSizeBytes: positiveInteger(override.maxTotalBytes) ?? defaultValue.maxTotalSizeBytes,
    ignorePatterns: override.ignorePatterns ?? defaultValue.ignorePatterns,
  };
}

function profilePatternIds(profile: SearchProfile | null): readonly string[] {
  if (!profile?.patterns) return [];
  return Object.entries(profile.patterns)
    .filter(([, pattern]) => pattern.enabled === true)
    .map(([id]) => id);
}

function checksById(ids: readonly string[]): readonly StupifyCheck[] {
  const byId = new Map<string, StupifyCheck>(defaultChecks.map((check) => [check.id, check]));
  return ids.map((id) => {
    const check = byId.get(id);
    if (!check) throw new Error(`Unknown check in search profile: ${id}`);
    return check;
  });
}

function applyPatternOverride(check: StupifyCheck, override: SearchProfilePattern | undefined): StupifyCheck {
  if (!override) return check;
  return {
    ...check,
    searchPrompt: override.searchPrompt ?? check.searchPrompt,
    searchExamples: {
      match: override.matchExamples ?? check.searchExamples?.match ?? check.examples?.match ?? [],
      nonMatch: override.nonMatchExamples ?? check.searchExamples?.nonMatch ?? check.examples?.noMatch ?? [],
    },
  };
}

function positiveInteger(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}
