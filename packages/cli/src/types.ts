export type Command =
  | Readonly<{ kind: "help" }>
  | Readonly<{ kind: "stdin"; checkIds: readonly string[] | null; json: boolean; model: ModelId }>
  | Readonly<{ kind: "commit"; commit: string; checkIds: readonly string[] | null; json: boolean; model: ModelId }>
  | Readonly<{ kind: "commits"; count: number; checkIds: readonly string[] | null; json: boolean; model: ModelId }>;

export type AnalyzeCommand = Exclude<Command, Readonly<{ kind: "help" }>>;

export type DiffInput = Readonly<{
  commitMessage?: string;
  text: string;
  hunkCount: number;
}>;

export type DiffUnit = Readonly<{
  id: string;
  label: string;
  text: string;
}>;

export type ModelBatch = Readonly<{
  id: string;
  units: readonly DiffUnit[];
}>;

export type StupifyCheck = Readonly<{
  id: string;
  name: string;
  question: string;
  matchWhen: readonly string[];
  doNotMatchWhen: readonly string[];
  examples?: Readonly<{
    match?: readonly string[];
    noMatch?: readonly string[];
  }>;
}>;

export type Finding = Readonly<{
  sourceId: string;
  checkId: string;
  why: string;
  proof: string;
}>;

export type FindingsResult = Readonly<{
  findings: readonly Finding[];
}>;

export type ModelId =
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
