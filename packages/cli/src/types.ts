export type Command =
  | Readonly<{ kind: "stdin" | "help" }>
  | Readonly<{ kind: "commit"; commit: string }>;

export type DiffInput = Readonly<{
  text: string;
  hunkCount: number;
}>;

export type Judgment = Readonly<{
  score: number;
  why: string;
  proof: string;
  confidence: number;
}>;
