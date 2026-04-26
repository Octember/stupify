import { findingsPrompt } from "./prompts.ts";
import { isFindingsResult, sanitizeFindingsResult } from "./sanitize.ts";
import type { LocalModel } from "./model.ts";
import type { DiffPack, FindingsResult, StupifyCheck } from "./types.ts";

export async function analyzePack(
  model: LocalModel,
  pack: DiffPack,
  checks: readonly StupifyCheck[],
): Promise<FindingsResult> {
  const grammar = await model.llama.createGrammarForJsonSchema({
    type: "object",
    properties: {
      findings: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            sourceId: { type: "string" },
            checkId: { type: "string" },
            score: { type: "number" },
            confidence: { type: "number" },
            why: { type: "string" },
            proof: { type: "string" },
          },
          required: ["sourceId", "checkId", "score", "confidence", "why", "proof"],
          additionalProperties: false,
        },
      },
    },
    required: ["findings"],
    additionalProperties: false,
  });

  const raw = await model.session.prompt(findingsPrompt(pack, checks), { grammar, maxTokens: 420 });
  const parsed = parseModelJson(raw, grammar);
  if (!isFindingsResult(parsed)) {
    console.error("Raw model output:");
    console.error(raw);
    throw new Error("Model returned invalid findings JSON.");
  }
  return sanitizeFindingsResult(parsed, checks, pack);
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
