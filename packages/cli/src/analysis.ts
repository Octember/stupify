import { judgmentPrompt } from "./prompts.js";
import { isJudgment, sanitizeJudgment } from "./sanitize.js";
import type { LocalModel } from "./model.js";
import type { DiffInput, Judgment } from "./types.js";

export async function judgeDiff(model: LocalModel, diff: DiffInput): Promise<Judgment> {
  const grammar = await model.llama.createGrammarForJsonSchema({
    type: "object",
    properties: {
      score: { type: "number" },
      why: { type: "string" },
      proof: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["score", "why", "proof", "confidence"],
    additionalProperties: false,
  });

  const raw = await model.session.prompt(judgmentPrompt(diff), { grammar, maxTokens: 180 });
  const parsed = parseModelJson(raw, grammar);
  if (!isJudgment(parsed)) {
    console.error("Raw model output:");
    console.error(raw);
    throw new Error("Model returned invalid judgment JSON.");
  }
  return sanitizeJudgment(parsed);
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
