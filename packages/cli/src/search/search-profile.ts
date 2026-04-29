import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultChecks, searchChecks } from "../core/checks.ts";
import type {
  AiSlopCheck,
  AiSlopCheckSearch,
  RepomixSearchConfig,
  SearchProfile,
  SearchProfilePattern,
} from "../core/types.ts";

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
): readonly AiSlopCheck[] {
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

function checksById(ids: readonly string[]): readonly AiSlopCheck[] {
  const byId = new Map<string, AiSlopCheck>(defaultChecks.map((check) => [check.id, check]));
  return ids.map((id) => {
    const check = byId.get(id);
    if (!check) throw new Error(`Unknown check in search profile: ${id}`);
    return check;
  });
}

function applyPatternOverride(check: AiSlopCheck, override: SearchProfilePattern | undefined): AiSlopCheck {
  if (!override) return check;
  const applyOverride = (search: AiSlopCheckSearch = {}): AiSlopCheckSearch => ({
    ...search,
    prompt: override.searchPrompt ?? search.prompt,
    examples: {
      match: override.matchExamples ?? search.examples?.match ?? check.examples?.match ?? [],
      nonMatch: override.nonMatchExamples ?? search.examples?.nonMatch ?? check.examples?.noMatch ?? [],
    },
  });
  return {
    ...check,
    search: applyOverride(check.search),
    languageOverrides: Object.fromEntries(
      Object.entries(check.languageOverrides ?? {}).map(([languageId, search]) => [languageId, applyOverride(search)]),
    ),
  };
}

function positiveInteger(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}
