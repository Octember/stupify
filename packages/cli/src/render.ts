import { VERSION } from "./constants.js";
import { toShareCardPayload } from "./share-card.js";
import type { Command, FindingsResult } from "./types.js";

export function renderFindings(result: FindingsResult, command: Command): string {
  if (command.kind === "help" || command.json) return JSON.stringify(toShareCardPayload(result), null, 2);

  if (result.findings.length === 0) {
    return `🧙 stupify 🪄
Findings:
  None.`;
  }

  return `🧙 stupify 🪄
Findings:
${result.findings
  .map((finding) => `- ${finding.sourceId} · ${finding.checkId}
  ${finding.why}
  Proof: ${finding.proof}`)
  .join("\n")}`;
}

export function helpText(): string {
  return `Stupify ${VERSION}

Usage:
  stupify
  stupify --commit <commit>
  stupify --commits <count>
  git diff HEAD~1..HEAD | stupify --stdin

Options:
  --checks <ids>        Comma-separated check ids.
  --model <id>          qwen3-4b-magicquant, qwen2.5-coder-7b, qwen2.5-coder-32b, or qwen2.5-coder-1.5b.
  --json                Print raw JSON findings.

Default:
  stupify is equivalent to stupify --commits 5.

Not included:
  Repo scanning, categories, baselines, sharing, server calls, Ollama, or BYO model setup.
`;
}
