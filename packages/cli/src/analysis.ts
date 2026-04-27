import { auditPrompt, findingsAuditPrompt, scoutPrompt, semScoutPrompt } from "./prompts.ts";
import { cachedJson, fingerprint } from "./cache.ts";
import type { LocalModel } from "./model.ts";
import type {
  CandidateContext,
  CheckId,
  DiffBatch,
  AuditPromptName,
  AuditReviewResult,
  Finding,
  FindingsResult,
  NetDiff,
  SemCandidate,
  SemChangeSet,
  SemContext,
  SemContextPack,
  SourceId,
  StupifyCheck,
} from "./types.ts";

export async function scoutBatch(
  model: LocalModel,
  batch: DiffBatch,
  checks: readonly StupifyCheck[],
  sourceLabel: string,
): Promise<readonly string[]> {
  const raw = await runJsonPrompt(model, scoutPrompt(batch, checks, sourceLabel), scoutSchema(batch), 0);
  return uncheckedCandidates(raw);
}

export async function auditCandidates(
  model: LocalModel,
  diff: NetDiff,
  contexts: readonly CandidateContext[],
  checks: readonly StupifyCheck[],
): Promise<FindingsResult> {
  if (contexts.length === 0) return { findings: [], summary: "No candidate regions found." };

  const raw = await runJsonPrompt(model, auditPrompt(contexts, checks, diff.label), auditSchema(contexts), 0);
  return uncheckedRawAuditResult(raw, diff.id);
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
    0,
  );
  return uncheckedSemCandidates(raw, changeSet.id);
}

export async function runFindingsAudit(
  model: LocalModel,
  changeSet: SemChangeSet,
  contexts: readonly SemContext[],
  pack: SemContextPack,
  checks: readonly StupifyCheck[],
  request = findingsAuditRequest(changeSet, contexts, pack, checks),
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
    request.prompt,
    request.schema,
    0,
  );
  return uncheckedFindingsAuditResult(raw, changeSet.id, contexts);
}

export function findingsAuditRequest(
  changeSet: SemChangeSet,
  contexts: readonly SemContext[],
  pack: SemContextPack,
  checks: readonly StupifyCheck[],
  promptName: AuditPromptName = "strict",
): Readonly<{ prompt: string; schema: unknown }> {
  return {
    prompt: findingsAuditPrompt(contexts, pack, checks, changeSet.label, promptName),
    schema: findingsAuditSchema(contexts),
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

function findingsAuditSchema(contexts: readonly SemContext[]): unknown {
  const targetIds = contexts.map((context) => context.targetId);
  const findingItem = {
    type: "object",
    properties: {
      targetId: { type: "string", enum: targetIds },
      why: { type: "string" },
      proof: { type: "string" },
    },
    required: ["targetId", "why", "proof"],
    additionalProperties: false,
  };
  const uncertainItem = {
    type: "object",
    properties: {
      targetId: { type: "string", enum: targetIds },
      why: { type: "string" },
    },
    required: ["targetId", "why"],
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
      targets: {
        type: "array",
        maxItems: maxCandidates,
        items: {
          type: "object",
          properties: {
            entityId: { type: "string", enum: changeSet.changes.map((change) => change.entityId) },
            checkId: { type: "string", enum: checks.map((check) => check.id) },
            reason: { type: "string" },
          },
          required: ["entityId", "checkId", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["targets"],
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

type RawScoutOutput = Readonly<{ candidates?: readonly string[] }>;
type RawAuditOutput = Readonly<{
  findings?: readonly RawFinding[];
  summary?: string;
}>;
type RawSemScoutOutput = Readonly<{
  targets?: readonly RawSemCandidate[];
  candidates?: readonly RawSemCandidate[];
}>;
type RawSemCandidate = Readonly<{
  targetId?: string;
  entityId?: string;
  checkId?: string;
  checkIds?: readonly string[];
  reason?: string;
}>;
type RawFinding = Readonly<{
  checkId?: string;
  why?: string;
  proof?: string;
}>;
type RawFindingReview = RawFinding & Readonly<{ targetId?: string }>;
type RawFindingsAuditOutput = Readonly<{
  findings?: readonly RawFindingReview[];
  uncertain?: readonly RawFindingReview[];
}>;

function uncheckedCandidates(value: unknown): readonly string[] {
  return [...((value as RawScoutOutput).candidates ?? [])];
}

function uncheckedRawAuditResult(value: unknown, sourceId: SourceId): FindingsResult {
  const output = value as RawAuditOutput;
  const findings = (output.findings ?? []).map((finding): Finding => ({
    sourceId,
    checkId: (finding.checkId ?? "") as CheckId,
    why: finding.why ?? "",
    proof: finding.proof ?? "",
  }));
  return { findings, summary: output.summary ?? defaultSummary(findings.length) };
}

function uncheckedSemCandidates(value: unknown, sourceId: SourceId): readonly SemCandidate[] {
  const output = value as RawSemScoutOutput;
  const rawTargets = output.targets ?? output.candidates ?? [];
  return rawTargets.flatMap((candidate) => {
    if (candidate.checkId) {
      return [{
        sourceId,
        targetId: candidate.targetId ?? "",
        entityId: candidate.entityId ?? "",
        checkId: candidate.checkId as CheckId,
        reason: candidate.reason ?? "",
      }];
    }
    return (candidate.checkIds ?? []).map((checkId) => ({
      sourceId,
      targetId: candidate.targetId ?? "",
      entityId: candidate.entityId ?? "",
      checkId: checkId as CheckId,
      reason: candidate.reason ?? "",
    }));
  });
}

function uncheckedFindingsAuditResult(
  value: unknown,
  sourceId: SourceId,
  contexts: readonly SemContext[],
): AuditReviewResult {
  const output = value as RawFindingsAuditOutput;
  const targetsById = new Map(contexts.map((context) => [context.targetId, context]));
  const findings = (output.findings ?? []).map((finding): Finding => {
    const target = targetsById.get(finding.targetId ?? "");
    return {
      sourceId,
      checkId: (target?.checkId ?? "") as CheckId,
      why: finding.why ?? "",
      proof: finding.proof ?? "",
    };
  });
  const uncertain = output.uncertain?.length ?? 0;
  const totalTargets = contexts.length;
  return {
    findings,
    summary: defaultSummary(findings.length),
    stats: {
      totalTargets,
      finding: findings.length,
      clean: Math.max(0, totalTargets - findings.length - uncertain),
      uncertain,
      invalid: 0,
    },
  };
}

function defaultSummary(findingCount: number): string {
  return findingCount === 0
    ? "No clear judgment-offload signal found."
    : `${findingCount} finding review${findingCount === 1 ? "" : "s"} accepted.`;
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
