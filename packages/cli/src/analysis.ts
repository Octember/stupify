import { cachedJson, fingerprint } from "./cache.ts";
import type { LocalModel } from "./model.ts";
import { searchPrompt } from "./prompts.ts";
import type { SearchMatch, SemChangeSet, SemContext, SemContextPack, StupifyCheck } from "./types.ts";

export async function runSearch(
  model: LocalModel,
  request: SearchRequest,
): Promise<readonly SearchMatch[]> {
  const raw = await runJsonPrompt(model, request.prompt, request.schema, 0);
  return uncheckedSearchMatches(raw, request.contexts);
}

export type SearchRequest = Readonly<{
  prompt: string;
  schema: unknown;
  contexts: readonly SemContext[];
}>;

export function searchRequest(input: Readonly<{
  changeSet: SemChangeSet;
  contexts: readonly SemContext[];
  pack: SemContextPack;
  patterns: readonly StupifyCheck[];
  includeCounterReasonInPrompt?: boolean;
}>): SearchRequest {
  return {
    prompt: searchPrompt({
      ...input,
      includeCounterReason: input.includeCounterReasonInPrompt ?? false,
    }),
    schema: searchSchema(input.contexts),
    contexts: input.contexts,
  };
}

export async function countPromptTokens(model: LocalModel, prompt: string): Promise<number> {
  const cached = await cachedJson(
    "prompt-tokens",
    fingerprint({
      version: 1,
      modelId: model.id,
      profile: model.profile,
      prompt,
    }),
    async () => {
      const response = await fetch(`${model.baseUrl}/tokenize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: prompt }),
      });
      if (!response.ok) {
        throw new Error(`llama-server tokenize failed: HTTP ${response.status} ${await response.text()}`);
      }
      const body = await response.json() as { tokens?: unknown };
      if (!Array.isArray(body.tokens)) throw new Error("llama-server tokenize returned no tokens.");
      return { count: body.tokens.length };
    },
  );
  return cached.count;
}

function searchSchema(contexts: readonly SemContext[]): unknown {
  return {
    type: "object",
    properties: {
      matches: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            targetId: { type: "string", enum: contexts.map((context) => context.targetId) },
            reason: { type: "string" },
            proof: { type: "string" },
          },
          required: ["targetId", "reason", "proof"],
          additionalProperties: false,
        },
      },
    },
    required: ["matches"],
    additionalProperties: false,
  };
}

type RawSearchOutput = Readonly<{
  matches?: readonly RawSearchMatch[];
}>;
type RawSearchMatch = Readonly<{
  targetId?: string;
  reason?: string;
  proof?: string;
}>;

function uncheckedSearchMatches(value: unknown, contexts: readonly SemContext[]): readonly SearchMatch[] {
  const output = value as RawSearchOutput;
  const contextsByTargetId = new Map(contexts.map((context) => [context.targetId, context]));
  return (output.matches ?? []).flatMap((match): readonly SearchMatch[] => {
    const targetId = match.targetId ?? "";
    const context = contextsByTargetId.get(targetId);
    if (!context) return [];
    return [{
      targetId,
      patternId: context.checkId,
      reason: match.reason ?? "",
      proof: sourcePointer(context),
    }];
  });
}

function sourcePointer(context: SemContext): string {
  const file = context.filePath ?? "(unknown)";
  return `${file}::${context.entityKind || "entity"}::${context.entityName || context.entityId}`;
}

async function runJsonPrompt(
  model: LocalModel,
  prompt: string,
  schema: unknown,
  temperature: number,
): Promise<unknown> {
  return cachedJson(
    "model-json",
    fingerprint({
      version: 1,
      modelId: model.id,
      profile: model.profile,
      prompt,
      schema,
      temperature,
    }),
    () => runJsonPromptUncached(model, prompt, schema, temperature),
  );
}

async function runJsonPromptUncached(
  model: LocalModel,
  prompt: string,
  schema: unknown,
  temperature: number,
): Promise<unknown> {
  const first = await complete(model, prompt, schema, temperature);
  const parsed = parseJson(first);
  if (parsed.ok) return parsed.value;

  const retry = await complete(model, `${prompt}

Your previous response was not valid JSON. Return the requested JSON object only.`, schema, temperature);
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
  temperature: number,
): Promise<string> {
  const response = await fetch(`${model.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: model.id,
      messages: [{ role: "user", content: prompt }],
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
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}
