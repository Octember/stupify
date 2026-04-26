export const REPORT_SCHEMA_VERSION = 1;

export const FAILURE_MODES = [
  "JUDGMENT_OFFLOAD",
  "PLAUSIBILITY_OVER_CORRECTNESS",
  "ABSTRACTION_DRIFT",
  "COMMENTARY_SUBSTITUTION",
  "AI_PROSE_LEAKAGE",
  "ERROR_HANDLING_AVOIDANCE",
  "CONTEXT_LOSS",
  "CEREMONY_INFLATION",
  "REVIEW_RESISTANCE",
  "MANUAL_REASONING_DECAY",
] as const;

export type FailureMode = (typeof FAILURE_MODES)[number];

export const SCORE_NAMES = [
  "Dumbness Delta",
  "Judgment Offload Index",
  "Thinking Residue",
  "Slop Acceptance Rate",
  "Manual Reasoning Score",
] as const;

export type ScoreName = (typeof SCORE_NAMES)[number];

export type DiagnosticScore = Readonly<{
  name: ScoreName;
  value: number;
}>;

export type DiagnosticFinding = Readonly<{
  mode: FailureMode;
  score: number;
  why: string;
  proof: string;
}>;

export type DiagnosticReport = Readonly<{
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  question: "Is AI making you dumber?";
  generatedAt: string;
  mode: "local-llm";
  dumbnessDelta?: number;
  primarySignal?: FailureMode;
  scores: readonly DiagnosticScore[];
  findings: readonly DiagnosticFinding[];
  recommendedCorrection?: string;
}>;

export type ShareReportRequest = Readonly<{
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  cliVersion: string;
  report: DiagnosticReport;
}>;

export type SanitizeReportForUpload = (
  report: DiagnosticReport,
  options: Readonly<{ cliVersion: string }>,
) => ShareReportRequest;

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
