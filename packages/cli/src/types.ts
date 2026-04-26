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

export type DiffPack = Readonly<{
  id: string;
  units: readonly DiffUnit[];
  estimatedChars: number;
}>;

export type StupifyCheck = Readonly<{
  id: string;
  name: string;
  question: string;
  signals: readonly string[];
  examples?: readonly string[];
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

export type ModelId = "qwen2.5-coder-1.5b" | "qwen2.5-coder-7b" | "qwen2.5-coder-32b";

export type ModelConfig = Readonly<{
  id: ModelId;
  name: string;
  size: string;
  file: string;
  url: string;
}>;
