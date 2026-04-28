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

export type SearchMode = "warn" | "off";
export type HookAction = "install" | "uninstall" | "status";
export type SearchSource = "since" | "stdin" | "commit" | "commits" | "staged";

type SearchOptions = Readonly<{
  checkIds: readonly string[] | null;
  json: boolean;
  model: ModelId;
  debugSem: boolean;
  maxCandidates: number;
  maxSearchInputTokens: number;
  searchProfilePath: string | null;
  includeCounterReasonInPrompt: boolean;
}>;

export type Command =
  | Readonly<{ kind: "help" }>
  | Readonly<{ kind: "hook"; action: HookAction }>
  | Readonly<{ kind: "doctor" }>
  | Readonly<{ kind: "bench-search"; configPath: string }>
  | (Readonly<{ kind: "since"; since: string; mode: "search"; source: "since" }> & SearchOptions)
  | (Readonly<{ kind: "stdin"; mode: "search"; source: "stdin" }> & SearchOptions)
  | (Readonly<{ kind: "commit"; commit: string; mode: "search"; source: "commit" }> & SearchOptions)
  | (Readonly<{ kind: "commits"; count: number; mode: "search"; source: "commits" }> & SearchOptions)
  | (Readonly<{ kind: "staged"; mode: "search"; source: "staged" }> & SearchOptions);

export type SearchCommand = Exclude<
  Command,
  | Readonly<{ kind: "help" }>
  | Readonly<{ kind: "hook"; action: HookAction }>
  | Readonly<{ kind: "doctor" }>
  | Readonly<{ kind: "bench-search"; configPath: string }>
>;

export type StupifyCheck = Readonly<{
  id: CheckId;
  name: string;
  question: string;
  why: string;
  lookFor: readonly string[];
  ignoreWhen: readonly string[];
  enabledByDefault?: boolean;
  hookMode?: SearchMode;
  searchPrompt?: string;
  searchExamples?: Readonly<{
    match: readonly string[];
    nonMatch: readonly string[];
  }>;
  examples?: Readonly<{
    match?: readonly string[];
    noMatch?: readonly string[];
  }>;
}>;

export type NetDiffStats = Readonly<{
  filesChanged: number;
  additions: number;
  deletions: number;
}>;

export type StagedDiff = Readonly<{
  text: string;
  stats: NetDiffStats;
}>;

export type BlameSummary = Readonly<{
  commit: string;
  author: string;
  subject: string;
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
  committers?: readonly string[];
  commitSubjects?: readonly string[];
  stats: NetDiffStats;
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
  committers?: readonly string[];
  commitSubjects?: readonly string[];
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

export type SemContextPack = Readonly<{
  provider: "repomix";
  filePaths: readonly string[];
  totalCharacters: number;
  totalTokens: number;
  text: string;
  config: RepomixSearchConfig;
}>;

export type RepomixSearchConfig = Readonly<{
  compress: boolean;
  showLineNumbers: boolean;
  removeEmptyLines: boolean;
  maxFileSizeBytes: number;
  maxTotalSizeBytes: number;
  ignorePatterns: readonly string[];
}>;

export type SearchProfileRepomixConfig = Readonly<{
  compress?: boolean;
  showLineNumbers?: boolean;
  removeEmptyLines?: boolean;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  ignorePatterns?: readonly string[];
}>;

export type SearchProfilePattern = Readonly<{
  enabled?: boolean;
  searchPrompt?: string;
  matchExamples?: readonly string[];
  nonMatchExamples?: readonly string[];
}>;

export type SearchProfile = Readonly<{
  id: string;
  context?: "repomix" | "sem";
  maxCandidates?: number;
  maxSearchInputTokens?: number;
  includeCounterReasonInPrompt?: boolean;
  repomix?: SearchProfileRepomixConfig;
  patterns?: Readonly<Record<string, SearchProfilePattern>>;
}>;

export type SearchMatch = Readonly<{
  targetId: string;
  patternId: CheckId;
  patternName?: string;
  checkWhy?: string;
  reason: string;
  proof: string;
  snapshot?: string;
  filePath?: string;
  entityName?: string;
  entityKind?: string;
  blame?: BlameSummary;
}>;

export type SearchRunJson = Readonly<{
  schemaVersion: "search.v1";
  mode: "search";
  source: SearchSource;
  model: Readonly<{ id: ModelId }>;
  patterns: readonly CheckId[];
  stats: Readonly<{
    elapsedMs: number;
    modelCalls: number;
    inputTokens?: number;
    inputTokenCap?: number;
    skipped?: boolean;
    skipReason?: "input_too_large" | "no_candidates";
    committers?: readonly string[];
    commitSubjects?: readonly string[];
    filesChanged?: number;
    entitiesScanned?: number;
    candidates?: number;
    repomixFiles?: number;
    repomixTokens?: number;
    repomixConfig?: RepomixSearchConfig;
    searchTargets?: number;
    searchBatches?: number;
    skippedTargets?: number;
    profileId?: string;
    targetsByPattern?: Readonly<Record<string, number>>;
    targetsPreview?: readonly SearchTargetPreview[];
  }>;
  matches: readonly SearchMatch[];
}>;

export type SearchTargetPreview = Readonly<{
  targetId: string;
  patternId: CheckId;
  entityKind?: string;
  sourceKind?: string;
}>;

export type SearchBenchConfig = Readonly<{
  name: string;
  profiles: readonly string[];
  fixtures: string;
  realSmokeRuns?: readonly SearchBenchSmokeRun[];
  realCommitReplay?: readonly SearchBenchCommitReplay[];
}>;

export type SearchBenchSmokeRun = Readonly<{
  id: string;
  cwd?: string;
  args: readonly string[];
}>;

export type SearchBenchCommitReplay = Readonly<{
  id: string;
  repoEnv?: string;
  cwd?: string;
  limit: number;
  since?: string;
  nonMerge?: boolean;
  profiles: readonly string[];
}>;

export type SearchFixture = Readonly<{
  id: string;
  description: string;
  stagedPatch: string;
  checks: readonly string[];
  expected: readonly SearchFixtureExpectation[];
}>;

export type SearchFixtureExpectation = Readonly<{
  patternId: string;
  shouldMatch: boolean;
}>;

export type SearchBenchRun = Readonly<{
  profileId: string;
  fixtureId?: string;
  smokeId?: string;
  elapsedMs: number;
  modelCalls: number;
  patterns: readonly CheckId[];
  targets: number;
  targetsByPattern: Readonly<Record<string, number>>;
  inputTokens: number;
  repomixPackedTokens?: number;
  skipped: boolean;
  skipReason?: string;
  matches: readonly SearchMatch[];
  expected?: readonly SearchFixtureExpectation[];
  score?: number;
  targetsPreview: readonly SearchTargetPreview[];
  matchesUsingCounterReasonAsProof: number;
  error?: string;
}>;

export type SearchBenchReplayRun = Readonly<{
  profileId: string;
  replayId: string;
  commitId: string;
  outcome: SearchReplayOutcome;
  changedFiles: number;
  addedLines: number;
  deletedLines: number;
  elapsedMs: number;
  skipped: boolean;
  skipReason?: string;
  targets: number;
  inputTokens: number;
  repomixPackedTokens?: number;
  modelCalls: number;
  matches: readonly SearchMatch[];
  matchesByPattern: Readonly<Record<string, number>>;
  error?: string;
}>;

export type SearchReplayOutcome =
  | "no_candidates"
  | "ran_no_matches"
  | "ran_with_matches"
  | "skipped_input_too_large"
  | "error";

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
  file: string;
  url: string;
  size: string;
}>;

export type TraceEvent = Readonly<{
  name: string;
  ms: number;
  count?: number;
  detail?: string;
}>;
