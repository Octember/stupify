import { VERSION } from "./constants.js";
import type { Judgment } from "./types.js";

export function renderJudgment(judgment: Judgment): string {
  return JSON.stringify(judgment, null, 2);
}

export function helpText(): string {
  return `Stupify ${VERSION}

Usage:
  stupify --commit <commit>
  git diff HEAD~1..HEAD | stupify --stdin

Output:
  One structured JSON judgment.

Not included:
  Repo scanning, categories, baselines, sharing, server calls, Ollama, or BYO model setup.
`;
}
