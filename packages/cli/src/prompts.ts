import type { ModelInput, StupifyCheck } from "./types.js";

export function findingsPrompt(
  input: ModelInput,
  checks: readonly StupifyCheck[],
  options?: Readonly<{ secondPass?: boolean }>,
): string {
  return `You are Stupify.
Keep an eye out for the following antipatterns in code, and report them if you see them.
Use only the checks listed below.
Evaluate each check against the analysis artifact.
When the artifact matches a listed signal or example, set matched to true for that check.
The artifact itself is enough evidence; do not require project-wide context.
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

ANALYSIS INPUT ${input.id}:
${input.artifacts.map(formatArtifact).join("\n\n")}`;
}

function formatCheck(check: StupifyCheck): string {
  const matches = check.matchWhen.map((signal) => `- ${signal}`).join("\n");
  const noMatches = check.doNotMatchWhen.map((signal) => `- ${signal}`).join("\n");
  const matchExamples = check.examples?.match
    ?.map((example) => `- ${example}`)
    .join("\n") ?? "";
  const noMatchExamples = check.examples?.noMatch
    ?.map((example) => `- ${example}`)
    .join("\n") ?? "";

  return [`# ${check.name}
ID: ${check.id}
Q: ${check.question}
Match when:
${matches}`,
    noMatches ? `Do not match when:\n${noMatches}` : "",
    matchExamples ? `Match examples:\n${matchExamples}` : "",
    noMatchExamples ? `No-match examples:\n${noMatchExamples}` : "",
  ].filter(Boolean).join("\n");
}

function formatArtifact(artifact: ModelInput["artifacts"][number]): string {
  return `SOURCE ${artifact.id}
TITLE ${artifact.label}
${artifact.text}`;
}
