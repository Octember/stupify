import { VERSION } from "./constants.ts";
import type { AnalysisReport, AnalyzeCommand } from "./types.ts";

export function renderReport(report: AnalysisReport, command: AnalyzeCommand): string {
  if (command.json) {
    return JSON.stringify({
      schemaVersion: "0.4",
      model: { id: report.run.modelId },
      checks: report.run.checkIds,
      run: report.run,
      findings: report.result.findings,
      summary: report.result.summary,
    }, null, 2);
  }

  if (report.run.engine === "sem") {
    return `Search:
  ${report.run.entitiesScanned} entities scanned
  ${report.run.candidateCount} candidate entities found
Audit:
  ${report.run.auditedCandidateCount} candidates inspected
  ${report.result.findings.length} findings
${renderAuditStats(report)}
${renderWarnings(report)}
Findings:
${renderFindings(report)}
Timing:
  total_ms=${report.run.timingsMs.total} entity_diff_ms=${report.run.timingsMs.diff} model_ms=${report.run.timingsMs.modelLoad} scout_ms=${report.run.timingsMs.search} context_audit_ms=${report.run.timingsMs.audit}`;
  }

  return `Search:
  ${report.run.batchesScanned} batches scanned
  ${report.run.candidateCount} candidate regions found
Audit:
  ${report.run.auditedCandidateCount} candidates inspected
  ${report.result.findings.length} findings
${renderWarnings(report)}
Findings:
${renderFindings(report)}
Timing:
  total_ms=${report.run.timingsMs.total} diff_ms=${report.run.timingsMs.diff} model_ms=${report.run.timingsMs.modelLoad} search_ms=${report.run.timingsMs.search} audit_ms=${report.run.timingsMs.audit}`;
}

export function helpText(): string {
  return `Stupify ${VERSION}

Usage:
  stupify
  stupify --since "2 weeks ago"
  stupify --commit <commit>
  stupify --commits <count>
  stupify experiment <config.json>
  git diff HEAD~1..HEAD | stupify --stdin

Options:
  --since <date>        Analyze the net diff from the first commit before this git date to HEAD.
  --commit <commit>     Analyze one commit as a net diff.
  --commits <count>     Analyze the net diff across the last N non-merge commits.
  --stdin               Read a git diff from stdin.
  --engine <engine>     raw-diff or sem. Default: raw-diff.
  --scout <mode>        llm or counter for --engine sem. Default: counter.
  --audit-context <mode>
                         none or repomix for --engine sem. Default: repomix.
  --audit-prompt <name> strict or high_bar for --engine sem. Default: high_bar.
  --debug-sem           Print sem commands and stderr.
  --debug-targets       Include audited sem target details in JSON output.
  --max-candidates <n>  Max semantic candidates for --engine sem. Default: 10.
  --audit-batch-size <n>
                         Semantic candidates per audit model call. Default: 25.
  --max-audit-input-tokens <n>
                         Max findings-audit input tokens before splitting. Default: 20000.
  --audit-concurrency <n>
                         Parallel findings-audit model calls. Default: 2.
  --checks <ids>        Comma-separated check ids.
  --model <id>          gemma-4-e2b, gemma-4-e4b, gemma-4-26b-a4b, qwen3-4b-magicquant, qwen2.5-coder-1.5b, qwen2.5-coder-7b, or qwen2.5-coder-32b.
  --json                Print JSON only.

Default:
  stupify is equivalent to stupify --since "2 weeks ago".

Not included:
  Baselines, sharing, hosted server calls, Ollama, GitHub, dashboards, or repo-wide scanning.
`;
}

function renderFindings(report: AnalysisReport): string {
  if (report.result.findings.length === 0) return "  None.";

  return report.result.findings
    .map((finding) => `- ${finding.checkId}
  ${finding.why}
  Proof: ${finding.proof}`)
    .join("\n");
}

function renderWarnings(report: AnalysisReport): string {
  if (report.run.warnings.length === 0) return "";
  return `Warnings:
${report.run.warnings.map((warning) => `  ${warning}`).join("\n")}
`;
}

function renderAuditStats(report: AnalysisReport): string {
  const stats = report.run.auditStats;
  if (!stats) return "";
  return `  ${stats.totalTargets} targets reviewed: ${stats.finding} finding, ${stats.uncertain} uncertain, ${stats.clean} clean, ${stats.invalid} invalid`;
}
