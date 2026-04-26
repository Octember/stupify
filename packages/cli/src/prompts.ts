import type { DiffPack, StupifyCheck } from "./types.js";

export function findingsPrompt(
  pack: DiffPack,
  checks: readonly StupifyCheck[],
  options?: Readonly<{ secondPass?: boolean }>,
): string {
  return `You are Stupify.
Keep an eye out for the following antipatterns in code, and report them if you see them.
Use only the checks listed below.
Evaluate each check against the diff.
When the diff matches a listed signal or example, set matched to true for that check.
The diff itself is enough evidence; do not require project-wide context.
This is a recall-oriented audit: prefer flagging subtle local patterns over silence.
${options?.secondPass ? "Second pass: look again for subtle one-for-one type, payload, schema, and mapper duplication.\n" : ""}sourceId must be the SOURCE value.
checkId must be the check ID.
proof should be the best hunk label.
Signals and examples are enough for a match.

Return JSON only:
{
  "checks": [
    {
      "sourceId": "SOURCE value",
      "checkId": "check ID",
      "matched": true,
      "why": "one sentence",
      "proof": "short pointer like hunk-2"
    }
  ]
}

${checks.map(formatCheck).join("\n\n")}

PACK ${pack.id}:
${pack.units.map(formatUnit).join("\n\n")}`;
}

function formatCheck(check: StupifyCheck): string {
  const signals = check.signals.map((signal) => `- ${signal}`).join("\n");
  const examples = check.examples
    ?.map((example) => `- ${example}`)
    .join("\n") ?? "";

  return `# ${check.name}
ID: ${check.id}
Q: ${check.question}
Signals:
${signals}
Examples:
${examples}`;
}

function formatUnit(unit: DiffPack["units"][number]): string {
  return `SOURCE ${unit.id}
TITLE ${unit.label}
${unit.text}`;
}
