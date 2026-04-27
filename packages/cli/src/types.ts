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

export type Engine = "raw-diff" | "sem";
export type ScoutMode = "llm" | "counter";
export type AuditContextMode = "none" | "repomix";
export type AuditPromptName = "strict" | "high_bar";

type AnalyzeOptions = Readonly<{
  checkIds: readonly string[] | null;
  json: boolean;
  model: ModelId;
  engine: Engine;
  scout: ScoutMode;
  auditContext: AuditContextMode;
  auditPrompt: AuditPromptName;
  debugSem: boolean;
  debugTargets: boolean;
  maxCandidates: number;
  auditBatchSize: number;
  maxAuditInputTokens: number;
  auditConcurrency: number;
}>;

export type Command =
  | Readonly<{ kind: "help" }>
  | Readonly<{ kind: "experiment"; configPath: string }>
  | (Readonly<{ kind: "since"; since: string }> & AnalyzeOptions)
  | (Readonly<{ kind: "stdin" }> & AnalyzeOptions)
  | (Readonly<{ kind: "commit"; commit: string }> & AnalyzeOptions)
  | (Readonly<{ kind: "commits"; count: number }> & AnalyzeOptions);

type ControlCommand =
  | Readonly<{ kind: "help" }>
  | Readonly<{ kind: "experiment"; configPath: string }>;

export type AnalyzeCommand = Exclude<Command, ControlCommand>;

export type StupifyCheck = Readonly<{
  id: CheckId;
  name: string;
  question: string;
  lookFor: readonly string[];
  ignoreWhen: readonly string[];
  enabledByDefault?: boolean;
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

export type AuditReviewStats = Readonly<{
  totalTargets: number;
  finding: number;
  clean: number;
  uncertain: number;
  invalid: number;
}>;

export type AuditReviewResult = FindingsResult & Readonly<{
  stats: AuditReviewStats;
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

export type SourceRange = Readonly<{
  id: SourceId;
  label: string;
  base: string;
  target: string;
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

export type SemChange = Readonly<{
  entityId: string;
  entityName: string;
  entityType: string;
  filePath: string;
  changeType: string;
  beforeContent: string | null;
  afterContent: string | null;
}>;

export type SemChangeSummary = Readonly<{
  added: number;
  deleted: number;
  modified: number;
  moved: number;
  renamed: number;
  fileCount: number;
  total: number;
}>;

export type SemChangeSet = Readonly<{
  id: SourceId;
  label: string;
  base: string;
  target: string;
  contextCwd: string;
  cleanup: () => Promise<void>;
  changes: readonly SemChange[];
  summary: SemChangeSummary;
}>;

export type SemCandidate = Readonly<{
  sourceId: SourceId;
  targetId: string;
  entityId: string;
  checkId: CheckId;
  reason: string;
}>;

export type SemContext = Readonly<{
  targetId: string;
  entityId: string;
  entityName: string;
  entityKind: string;
  changeKind: string;
  checkId: CheckId;
  reason: string;
  filePath?: string;
  text: string;
}>;

export type DebugTarget = Readonly<{
  targetId: string;
  checkId: CheckId;
  entityId: string;
  entityKind?: string;
  changeKind?: string;
  scoutReason?: string;
  sourceLabel?: string;
}>;

export type SemContextPack = Readonly<{
  provider: "repomix";
  filePaths: readonly string[];
  totalCharacters: number;
  totalTokens: number;
  text: string;
}>;

export type AnalysisRun = Readonly<{
  engine: Engine;
  auditContext: AuditContextMode;
  auditPrompt: AuditPromptName;
  mode: AnalyzeCommand["kind"];
  modelId: ModelId;
  checkIds: readonly CheckId[];
  sourceId: SourceId;
  label: string;
  stats: NetDiffStats;
  batchesScanned: number;
  candidateCount: number;
  targetsByCheck?: Readonly<Record<string, number>>;
  entitiesScanned: number;
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
  auditStats?: AuditReviewStats;
  debugTargets?: readonly DebugTarget[];
  traceEvents?: readonly TraceEvent[];
}>;

export type TraceEvent = Readonly<{
  name: string;
  ms: number;
  count?: number;
  detail?: string;
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
