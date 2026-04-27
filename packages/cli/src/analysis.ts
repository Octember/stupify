import { auditPrompt, scoutPrompt, semAuditPrompt, semScoutPrompt } from "./prompts.ts";
import { cachedJson, fingerprint } from "./cache.ts";
import {
  validateAuditResult,
  validateScoutResult,
  validateSemAuditResult,
  validateSemScoutResult,
} from "./validate.ts";
import type { LocalModel } from "./model.ts";
import type {
  CandidateContext,
  DiffBatch,
  AuditReviewResult,
  FindingsResult,
  NetDiff,
  SemCandidate,
  SemChangeSet,
  SemContext,
  SemContextPack,
  StupifyCheck,
} from "./types.ts";

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

export async function scoutSemChanges(
  model: LocalModel,
  changeSet: SemChangeSet,
  checks: readonly StupifyCheck[],
  maxCandidates: number,
): Promise<readonly SemCandidate[]> {
  const raw = await runJsonPrompt(
    model,
    semScoutPrompt(changeSet, checks, maxCandidates),
    semScoutSchema(changeSet, checks, maxCandidates),
    Math.max(1_500, maxCandidates * 180),
    0,
  );
  return validateSemScoutResult(raw, changeSet, checks, maxCandidates);
}

export async function auditSemContexts(
  model: LocalModel,
  changeSet: SemChangeSet,
  contexts: readonly SemContext[],
  pack: SemContextPack,
  checks: readonly StupifyCheck[],
): Promise<AuditReviewResult> {
  if (contexts.length === 0) {
    return {
      findings: [],
      summary: "No candidate entities found.",
      stats: { totalTargets: 0, finding: 0, clean: 0, uncertain: 0, invalid: 0 },
    };
  }

  const raw = await runJsonPrompt(
    model,
    semAuditPrompt(contexts, pack, checks, changeSet.label),
    semAuditSchema(contexts),
    semAuditMaxTokens(contexts),
    0,
  );
  return validateSemAuditResult(raw, changeSet.id, checks, contexts);
}

function semAuditMaxTokens(contexts: readonly SemContext[]): number {
  const targetCount = contexts.reduce((sum, context) => sum + context.checkIds.length, 0);
  return Math.max(1_500, targetCount * 120);
}

function semAuditSchema(contexts: readonly SemContext[]): unknown {
  const candidateIds = contexts.map((context) => context.candidateId);
  const checkIds = [...new Set(contexts.flatMap((context) => context.checkIds))];
  const findingItem = {
    type: "object",
    properties: {
      candidateId: { type: "string", enum: candidateIds },
      checkId: { type: "string", enum: checkIds },
      why: { type: "string" },
      proof: { type: "string" },
    },
    required: ["candidateId", "checkId", "why", "proof"],
    additionalProperties: false,
  };
  const uncertainItem = {
    type: "object",
    properties: {
      candidateId: { type: "string", enum: candidateIds },
      checkId: { type: "string", enum: checkIds },
      why: { type: "string" },
    },
    required: ["candidateId", "checkId", "why"],
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: findingItem,
      },
      uncertain: {
        type: "array",
        items: uncertainItem,
      },
    },
    additionalProperties: false,
  };
}

function auditSchema(contexts: readonly CandidateContext[]): unknown {
  return auditSchemaFromProofs(contexts.map((context) => context.pointer));
}

function auditSchemaFromProofs(proofs: readonly string[]): unknown {
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
            proof: { type: "string", enum: proofs },
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

function semScoutSchema(
  changeSet: SemChangeSet,
  checks: readonly StupifyCheck[],
  maxCandidates: number,
): unknown {
  return {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        maxItems: maxCandidates,
        items: {
          type: "object",
          properties: {
            entityId: { type: "string", enum: changeSet.changes.map((change) => change.entityId) },
            checkIds: {
              type: "array",
              items: { type: "string", enum: checks.map((check) => check.id) },
            },
          },
          required: ["entityId", "checkIds"],
          additionalProperties: false,
        },
      },
    },
    required: ["candidates"],
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
  return cachedJson(
    "model-json",
    fingerprint({
      version: 1,
      modelId: model.id,
      profile: model.profile,
      prompt,
      schema,
      maxTokens,
      temperature,
    }),
    () => runJsonPromptUncached(model, prompt, schema, maxTokens, temperature),
    process.env.STUPIFY_DEBUG_CACHE === "1",
  );
}

async function runJsonPromptUncached(
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
