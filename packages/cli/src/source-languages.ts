import type { AiSlopCheck, AiSlopCheckSearch, SourceLanguageId } from "./core/types.ts";

export type SourceLanguage = Readonly<{
  id: SourceLanguageId;
  name: string;
  extensions: readonly string[];
}>;

export const sourceLanguages: readonly SourceLanguage[] = [
  { id: "typescript", name: "TypeScript", extensions: [".ts", ".tsx", ".mts", ".cts"] },
  { id: "javascript", name: "JavaScript", extensions: [".js", ".jsx", ".mjs", ".cjs"] },
  { id: "python", name: "Python", extensions: [".py", ".pyw"] },
  { id: "rust", name: "Rust", extensions: [".rs"] },
  { id: "go", name: "Go", extensions: [".go"] },
  { id: "ruby", name: "Ruby", extensions: [".rb"] },
  { id: "java", name: "Java", extensions: [".java"] },
  { id: "kotlin", name: "Kotlin", extensions: [".kt", ".kts"] },
  { id: "swift", name: "Swift", extensions: [".swift"] },
  { id: "csharp", name: "C#", extensions: [".cs"] },
  { id: "php", name: "PHP", extensions: [".php"] },
  { id: "elixir", name: "Elixir", extensions: [".ex", ".exs"] },
] as const;

const extensionToLanguage = new Map(
  sourceLanguages.flatMap((language) => language.extensions.map((extension) => [extension, language] as const)),
);

export function sourceLanguageForPath(filePath: string): SourceLanguage | null {
  const normalized = filePath.toLowerCase();
  if (isIgnoredSourcePath(normalized)) return null;
  for (const [extension, language] of extensionToLanguage) {
    if (normalized.endsWith(extension)) return language;
  }
  return null;
}

export function searchImplForLanguage(
  check: AiSlopCheck,
  languageId: SourceLanguageId | null,
): AiSlopCheckSearch {
  const base = check.search ?? {};
  const override = languageId ? check.languageOverrides?.[languageId] : undefined;
  return {
    ...base,
    ...override,
    lookFor: override?.lookFor ?? base.lookFor,
    ignoreWhen: override?.ignoreWhen ?? base.ignoreWhen,
    counter: {
      ...base.counter,
      ...override?.counter,
    },
    examples: {
      match: override?.examples?.match ?? base.examples?.match,
      nonMatch: override?.examples?.nonMatch ?? base.examples?.nonMatch,
    },
  };
}

export function checkAppliesToLanguage(check: AiSlopCheck, languageId: SourceLanguageId): boolean {
  return searchImplForLanguage(check, languageId).enabled === true;
}

function isIgnoredSourcePath(filePath: string): boolean {
  if (/(^|\/)(bun|package-lock|pnpm-lock|yarn)\.lock$/.test(filePath)) return true;
  if (/(^|\/)(cargo|gemfile|poetry|mix|composer)\.lock$/.test(filePath)) return true;
  if (/(^|\/)go\.sum$/.test(filePath)) return true;
  if (/(^|\/)(node_modules|dist|build|coverage|generated|vendor|fixtures?|snapshots?)(\/|$)/.test(filePath)) return true;
  if (/(^|\/)(__pycache__|target|\.gradle|bin|obj|deps|_build)(\/|$)/.test(filePath)) return true;
  if (/\.(md|mdx|txt|json|jsonc|ya?ml|toml|lock|csv|svg|png|jpe?g|gif|webp)$/i.test(filePath)) return true;
  if (/\.(test|spec|fixture)\.[cm]?[jt]sx?$/i.test(filePath)) return true;
  if (/(^|\/)(test|tests|spec|specs|fixtures?)(\/|$)/.test(filePath)) return true;
  return false;
}
