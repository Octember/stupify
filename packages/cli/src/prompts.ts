import type { DiffPack, StupifyCheck } from "./types.ts";

export function findingsPrompt(pack: DiffPack, checks: readonly StupifyCheck[]): string {
  return `You are Stupify.
Stupify checks whether AI may be making a developer dumber by looking at a git diff.
You will receive:
1. A registry of checks.
2. One packed input containing one or more commit diffs.
Use only the checks in the registry.
Do not invent new check types.
Return findings only when the evidence is meaningful.
Prefer no finding over a weak finding.
For each check:
- strongSignals describe what should count
- weakSignals are not enough by themselves
- falsePositives are reasons to avoid flagging something
Return JSON only:
{
  "findings": [
    {
      "sourceId": "commit sha or part id",
      "checkId": "string",
      "score": 0,
      "confidence": 0,
      "why": "one sentence",
      "proof": "short pointer"
    }
  ]
}
Rules:
- max 5 findings
- Do not quote code.
- Do not include long identifiers.
- Do not moralize.
- If nothing meaningful is found, return { "findings": [] }.
- Use the provided source id for sourceId.

CHECK REGISTRY:
${JSON.stringify(checks, null, 2)}

PACK ${pack.id}:
${pack.units.map(formatUnit).join("\n\n")}`;
}

function formatUnit(unit: DiffPack["units"][number]): string {
  return `SOURCE ${unit.id}
TITLE ${unit.label}
${unit.text}`;
}
