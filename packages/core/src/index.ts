export type DiffJudgment = Readonly<{
  score: number;
  why: string;
  proof: string;
  confidence: number;
}>;

export const NEVER_UPLOAD_FIELDS = [
  "source code",
  "diffs",
  "commit messages",
  "file contents",
  "raw filenames",
  "repo URLs",
  "author names",
  "private package names",
] as const;
