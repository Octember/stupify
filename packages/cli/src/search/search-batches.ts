import { searchRequest, type SearchRequest } from "../llm/analysis.ts";
import { emptyContextPack, repomixContextPack } from "../repomix/repomix-provider.ts";
import type {
  AiSlopCheck,
  SearchCommand,
  SearchProfile,
  SemContext,
  SemContextPack,
} from "../core/types.ts";

export type SearchBatch = Readonly<{
  contexts: readonly SemContext[];
  pack: SemContextPack;
  request: SearchRequest;
  estimatedInputTokens: number;
}>;

export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 3);
}

export async function buildSearchBatches(input: Readonly<{
  command: SearchCommand;
  changeSet: Parameters<typeof searchRequest>[0]["changeSet"];
  contexts: readonly SemContext[];
  initialPack: SemContextPack;
  checks: readonly AiSlopCheck[];
  profile: SearchProfile | null;
  includeCounterReasonInPrompt: boolean;
  maxSearchInputTokens: number;
  baseRepomixConfig: Parameters<typeof repomixContextPack>[3];
}>): Promise<Readonly<{
  batches: readonly SearchBatch[];
  estimatedInputTokens: number;
  skippedTargets: number;
  wasSplit: boolean;
}>> {
  const first = makeSearchBatch(input, input.contexts, input.initialPack);
  if (first.estimatedInputTokens <= input.maxSearchInputTokens) {
    return {
      batches: [first],
      estimatedInputTokens: first.estimatedInputTokens,
      skippedTargets: 0,
      wasSplit: false,
    };
  }

  const batches: SearchBatch[] = [];
  let skippedTargets = 0;
  let currentContexts: readonly SemContext[] = [];
  let currentBatch: SearchBatch | null = null;

  for (const context of input.contexts) {
    const candidateContexts = [...currentContexts, context];
    const candidateBatch = await makeSearchBatchWithPack(input, candidateContexts);
    if (candidateBatch.estimatedInputTokens <= input.maxSearchInputTokens) {
      currentContexts = candidateContexts;
      currentBatch = candidateBatch;
      continue;
    }

    if (currentBatch) {
      batches.push(currentBatch);
      currentContexts = [];
      currentBatch = null;
    }

    const singleBatch =
      candidateContexts.length === 1
        ? candidateBatch
        : await makeSearchBatchWithPack(input, [context]);
    if (singleBatch.estimatedInputTokens <= input.maxSearchInputTokens) {
      currentContexts = [context];
      currentBatch = singleBatch;
    } else {
      skippedTargets += 1;
    }
  }

  if (currentBatch) batches.push(currentBatch);

  return {
    batches,
    estimatedInputTokens: first.estimatedInputTokens,
    skippedTargets,
    wasSplit: true,
  };
}

function makeSearchBatch(
  input: Readonly<{
    changeSet: Parameters<typeof searchRequest>[0]["changeSet"];
    checks: readonly AiSlopCheck[];
    profile: SearchProfile | null;
    includeCounterReasonInPrompt: boolean;
  }>,
  contexts: readonly SemContext[],
  pack: SemContextPack,
): SearchBatch {
  const request = buildSearchRequest(
    input.changeSet,
    contexts,
    pack,
    input.checks,
    input.profile,
    input.includeCounterReasonInPrompt,
  );
  return {
    contexts,
    pack,
    request,
    estimatedInputTokens: estimatePromptTokens(request.prompt),
  };
}

async function makeSearchBatchWithPack(
  input: Readonly<{
    command: SearchCommand;
    changeSet: Parameters<typeof searchRequest>[0]["changeSet"];
    checks: readonly AiSlopCheck[];
    profile: SearchProfile | null;
    includeCounterReasonInPrompt: boolean;
    baseRepomixConfig: Parameters<typeof repomixContextPack>[3];
  }>,
  contexts: readonly SemContext[],
): Promise<SearchBatch> {
  const pack =
    input.profile?.context === "sem"
      ? emptyContextPack()
      : await repomixContextPack(
          input.changeSet.contextCwd,
          contexts,
          input.changeSet.changes,
          input.baseRepomixConfig,
        );
  return makeSearchBatch(input, contexts, pack);
}

function buildSearchRequest(
  changeSet: Parameters<typeof searchRequest>[0]["changeSet"],
  contexts: Parameters<typeof searchRequest>[0]["contexts"],
  pack: SemContextPack,
  patterns: readonly AiSlopCheck[],
  profile: SearchProfile | null,
  includeCounterReasonInPrompt: boolean,
) {
  return searchRequest({
    changeSet,
    contexts,
    pack,
    patterns,
    includeCounterReasonInPrompt: profile?.includeCounterReasonInPrompt ?? includeCounterReasonInPrompt,
  });
}
