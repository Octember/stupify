import { auditPrompt, scoutPrompt } from "./prompts.ts";
import { validateAuditResult, validateScoutResult } from "./validate.ts";
import type { LocalModel } from "./model.ts";
import type { CandidateContext, DiffBatch, FindingsResult, NetDiff, StupifyCheck } from "./types.ts";

export async function scoutBatch(
  model: LocalModel,
  batch: DiffBatch,
  checks: readonly StupifyCheck[],
  sourceLabel: string,
): Promise<readonly string[]> {
  const raw = await runJsonPrompt(model, scoutPrompt(batch, checks, sourceLabel), scoutSchema(batch), 160, 0);
  return validateScoutResult(raw, batch);
}

export async function auditCandidates(
  model: LocalModel,
  diff: NetDiff,
  contexts: readonly CandidateContext[],
  checks: readonly StupifyCheck[],
): Promise<FindingsResult> {
  if (contexts.length === 0) return { findings: [], summary: "No candidate regions found." };

  const raw = await runJsonPrompt(model, auditPrompt(contexts, checks, diff.label), auditSchema(contexts), 520, 0);
  return validateAuditResult(raw, diff, checks, contexts.map((context) => context.pointer));
}

function auditSchema(contexts: readonly CandidateContext[]): unknown {
  return {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            checkId: { type: "string" },
            why: { type: "string" },
            proof: { type: "string", enum: contexts.map((context) => context.pointer) },
          },
          required: ["checkId", "why", "proof"],
          additionalProperties: false,
        },
      },
      summary: { type: "string" },
    },
    required: ["findings", "summary"],
    additionalProperties: false,
  };
}

function scoutSchema(batch: DiffBatch): unknown {
  return {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        maxItems: 3,
        items: { type: "string", enum: batch.hunks.map((hunk) => hunk.pointer) },
      },
    },
    required: ["candidates"],
    additionalProperties: false,
  };
}

async function runJsonPrompt(
  model: LocalModel,
  prompt: string,
  schema: unknown,
  maxTokens: number,
  temperature: number,
): Promise<unknown> {
  if (process.env.STUPIFY_DEBUG_PROMPT === "1") {
    console.error("Model prompt:");
    console.error(prompt);
  }

  const first = await complete(model, prompt, schema, maxTokens, temperature);
  const parsed = parseJson(first);
  if (parsed.ok) return parsed.value;

  const retry = await complete(model, `${prompt}

Your previous response was not valid JSON. Return the requested JSON object only.`, schema, maxTokens, temperature);
  const retryParsed = parseJson(retry);
  if (retryParsed.ok) return retryParsed.value;

  console.error("Raw model output:");
  console.error(retry);
  throw new Error("Model returned invalid JSON.");
}

async function complete(
  model: LocalModel,
  prompt: string,
  schema: unknown,
  maxTokens: number,
  temperature: number,
): Promise<string> {
  const response = await fetch(`${model.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: model.id,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature,
      response_format: {
        type: "json_object",
        schema,
      },
    }),
  });

  if (!response.ok) throw new Error(`llama-server request failed: HTTP ${response.status} ${await response.text()}`);

  const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("llama-server returned no message content.");
  return content;
}

function parseJson(raw: string): Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }> {
  try {
    const value = JSON.parse(raw);
    if (process.env.STUPIFY_DEBUG_MODEL === "1") {
      console.error("Parsed model JSON:");
      console.error(JSON.stringify(value, null, 2));
    }
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}
