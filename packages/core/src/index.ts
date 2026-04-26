export type DiffFinding = Readonly<{
  sourceId: string;
  checkId: string;
  why: string;
  proof: string;
}>;

export type DiffFindings = Readonly<{
  findings: readonly DiffFinding[];
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
