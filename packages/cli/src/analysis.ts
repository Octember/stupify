import { findingsPrompt } from "./prompts.js";
import { validateFindingsResult } from "./validate.js";
import type { LocalModel } from "./model.js";
import type { DiffPack, FindingsResult, StupifyCheck } from "./types.js";

export async function analyzePack(
  model: LocalModel,
  pack: DiffPack,
  checks: readonly StupifyCheck[],
): Promise<FindingsResult> {
  const first = await runPrompt(model, findingsPrompt(pack, checks));
  const firstResult = parseFindings(first.raw, first.grammar, checks, pack);
  if (firstResult.findings.length > 0) return firstResult;

  const second = await runPrompt(model, findingsPrompt(pack, checks, { secondPass: true }));
  return parseFindings(second.raw, second.grammar, checks, pack);
}

async function runPrompt(
  model: LocalModel,
  prompt: string,
): Promise<Readonly<{ raw: string; grammar: { parse(input: string): unknown } }>> {
  const grammar = await model.llama.createGrammarForJsonSchema({
    type: "object",
    properties: {
      checks: {
        type: "array",
        minItems: 1,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            sourceId: { type: "string" },
            checkId: { type: "string" },
            matched: { type: "boolean" },
            why: { type: "string" },
            proof: { type: "string" },
          },
          required: ["sourceId", "checkId", "matched", "why", "proof"],
          additionalProperties: false,
        },
      },
    },
    required: ["checks"],
    additionalProperties: false,
  });

  if (process.env.STUPIFY_DEBUG_PROMPT === "1") {
    console.error("Model prompt:");
    console.error(prompt);
  }

  const raw = await model.session.prompt(prompt, {
    grammar,
    maxTokens: 420,
    temperature: 1,
  });
  return { raw, grammar };
}

function parseFindings(
  raw: string,
  grammar: { parse(input: string): unknown },
  checks: readonly StupifyCheck[],
  pack: DiffPack,
): FindingsResult {
  const parsed = parseModelJson(raw, grammar);
  if (!isCheckResult(parsed)) {
    console.error("Raw model output:");
    console.error(raw);
    throw new Error("Model returned invalid findings JSON.");
  }
  if (process.env.STUPIFY_DEBUG_MODEL === "1") {
    console.error("Parsed model findings:");
    console.error(JSON.stringify(parsed, null, 2));
  }
  return validateFindingsResult(decisionsToFindings(parsed), checks, pack);
}

type CheckDecision = Readonly<{
  sourceId: string;
  checkId: string;
  matched: boolean;
  why: string;
  proof: string;
}>;

type CheckResult = Readonly<{
  checks: readonly CheckDecision[];
}>;

function isCheckResult(value: unknown): value is CheckResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.checks) && record.checks.every(isCheckDecision);
}

function isCheckDecision(value: unknown): value is CheckDecision {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.checkId === "string" &&
    typeof record.sourceId === "string" &&
    typeof record.matched === "boolean" &&
    typeof record.why === "string" &&
    typeof record.proof === "string"
  );
}

function decisionsToFindings(result: CheckResult): FindingsResult {
  return {
    findings: result.checks
      .filter((decision) => decision.matched)
      .map(({ sourceId, checkId, why, proof }) => ({ sourceId, checkId, why, proof })),
  };
}

function parseModelJson(raw: string, grammar: { parse(input: string): unknown }): unknown {
  try {
    return grammar.parse(raw);
  } catch (error) {
    console.error("Raw model output:");
    console.error(raw);
    throw error;
  }
}
