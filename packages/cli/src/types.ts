declare const brand: unique symbol;

type Brand<Value, Name extends string> = Value & { readonly [brand]: Name };

export type SourceId = Brand<string, "SourceId">;
export type CheckId = Brand<string, "CheckId">;

export function sourceId(value: string): SourceId {
  return value as SourceId;
}

export function checkId(value: string): CheckId {
  return value as CheckId;
}

export type Command =
  | Readonly<{ kind: "help" }>
  | Readonly<{ kind: "since"; since: string; checkIds: readonly string[] | null; json: boolean; model: ModelId }>
  | Readonly<{ kind: "stdin"; checkIds: readonly string[] | null; json: boolean; model: ModelId }>
  | Readonly<{ kind: "commit"; commit: string; checkIds: readonly string[] | null; json: boolean; model: ModelId }>
  | Readonly<{ kind: "commits"; count: number; checkIds: readonly string[] | null; json: boolean; model: ModelId }>;

export type AnalyzeCommand = Exclude<Command, Readonly<{ kind: "help" }>>;

export type StupifyCheck = Readonly<{
  id: CheckId;
  name: string;
  question: string;
  lookFor: readonly string[];
  ignoreWhen: readonly string[];
  examples?: Readonly<{
    match?: readonly string[];
    noMatch?: readonly string[];
  }>;
}>;

export type FindingCandidate = Readonly<{
  checkId: string;
  why: string;
  proof: string;
}>;

export type Finding = Readonly<{
  sourceId: SourceId;
  checkId: CheckId;
  why: string;
  proof: string;
}>;

export type FindingsResult = Readonly<{
  findings: readonly Finding[];
  summary?: string;
}>;

export type NetDiffStats = Readonly<{
  filesChanged: number;
  additions: number;
  deletions: number;
}>;

export type NetDiff = Readonly<{
  id: SourceId;
  label: string;
  base: string;
  target: string;
  text: string;
  stats: NetDiffStats;
}>;

export type DiffHunk = Readonly<{
  pointer: string;
  batchId: string;
  fileId: string;
  hunkId: string;
  filePath: string;
  lineCount: number;
  text: string;
}>;

export type DiffBatch = Readonly<{
  id: string;
  hunks: readonly DiffHunk[];
  text: string;
}>;

export type CandidateContext = Readonly<{
  pointer: string;
  text: string;
}>;

export type AnalysisRun = Readonly<{
  mode: AnalyzeCommand["kind"];
  modelId: ModelId;
  checkIds: readonly CheckId[];
  sourceId: SourceId;
  label: string;
  stats: NetDiffStats;
  batchesScanned: number;
  candidateCount: number;
  auditedCandidateCount: number;
  scoutModelCalls: number;
  auditModelCalls: number;
  timingsMs: Readonly<{
    diff: number;
    modelLoad: number;
    search: number;
    audit: number;
    total: number;
  }>;
  warnings: readonly string[];
}>;

export type AnalysisReport = Readonly<{
  run: AnalysisRun;
  result: FindingsResult;
}>;

export type ModelId =
  | "gemma-4-e2b"
  | "gemma-4-e4b"
  | "gemma-4-26b-a4b"
  | "qwen3-4b-magicquant"
  | "qwen2.5-coder-1.5b"
  | "qwen2.5-coder-7b"
  | "qwen2.5-coder-32b";

export type ModelConfig = Readonly<{
  id: ModelId;
  name: string;
  size: string;
  file: string;
  url: string;
}>;
