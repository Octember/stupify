import { VERSION } from "./constants.ts";
import type { Command, FindingsResult } from "./types.ts";

export function renderFindings(result: FindingsResult, command: Command): string {
  if (command.kind === "help" || command.json) return JSON.stringify(result, null, 2);

  if (result.findings.length === 0) {
    return `STUPIFY
Findings:
  None.`;
  }

  return `STUPIFY
Findings:
${result.findings
  .map(
    (finding, index) => `${index + 1}. ${finding.checkId} · ${finding.score}/10 · confidence ${finding.confidence}
   Source: ${finding.sourceId}
   ${finding.why}
   Proof: ${finding.proof}`,
  )
  .join("\n")}`;
}

export function helpText(): string {
  return `Stupify ${VERSION}

Usage:
  stupify --commit <commit>
  stupify --commits <count>
  git diff HEAD~1..HEAD | stupify --stdin

Options:
  --checks <ids>        Comma-separated check ids.
  --json                Print raw JSON findings.

Output:
  Findings from the enabled check registry.

Not included:
  Repo scanning, categories, baselines, sharing, server calls, Ollama, or BYO model setup.
`;
}
