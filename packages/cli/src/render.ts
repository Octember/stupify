import { VERSION } from "./constants.ts";
import type { AnalyzeCommand, FindingsResult } from "./types.ts";

export function renderFindings(result: FindingsResult, command: AnalyzeCommand): string {
  if (command.json) return JSON.stringify(result, null, 2);

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
  Options such as --json and --checks keep that default input mode unless --stdin, --commit, or --commits is provided.

Not included:
  Baselines, sharing, server calls, Ollama, BYO model setup, or a search/judge pipeline.
`;
}
