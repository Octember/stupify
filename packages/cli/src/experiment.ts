import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type ExperimentConfig = Readonly<{
  name: string;
  cwd?: string;
  baseCommand: readonly string[];
  runs: readonly ExperimentRun[];
}>;

type ExperimentRun = Readonly<{
  id: string;
  args: readonly string[];
}>;

type ExperimentSummary = Readonly<{
  id: string;
  command: string;
  totalMs: number;
  entitiesScanned: number;
  targets: number;
  targetsByCheck: Record<string, number>;
  auditContext: string;
  auditPrompt: string;
  repomixFiles: number;
  repomixTokens: number;
  auditCalls: number;
  auditInputTokens: readonly number[];
  auditMs: number;
  findings: number;
  uncertain: number;
  clean: number;
  findingsByCheck: Record<string, number>;
  uncertainByCheck: Record<string, number>;
  targetPreview: readonly DebugTargetRecord[];
  errors: readonly string[];
}>;

type DebugTargetRecord = Readonly<{
  targetId: string;
  checkId: string;
  entityId: string;
  entityKind?: string;
  changeKind?: string;
  scoutReason?: string;
  sourceLabel?: string;
}>;

export async function runExperiment(configPath: string): Promise<string> {
  const config = await readConfig(configPath);
  const startedAt = new Date();
  const outputDir = path.join(
    process.cwd(),
    "experiments",
    "results",
    `${safeSegment(config.name)}-${timestamp(startedAt)}`,
  );
  await mkdir(outputDir, { recursive: true });

  const cwd = resolveCwd(config.cwd);
  const cliPath = path.resolve(process.argv[1] ?? "packages/cli/dist/stupify.js");
  const summaries: ExperimentSummary[] = [];

  for (const run of config.runs) {
    const args = ensureJson([...config.baseCommand, ...run.args]);
    const command = [process.execPath, cliPath, ...args].join(" ");
    const summary = await runOneExperiment({
      id: run.id,
      args,
      command,
      cwd,
      cliPath,
      outputDir,
    });
    summaries.push(summary);
    await writeFile(
      path.join(outputDir, "summary.json"),
      `${JSON.stringify({ name: config.name, cwd, runs: summaries }, null, 2)}\n`,
    );
  }

  return outputDir;
}

async function readConfig(configPath: string): Promise<ExperimentConfig> {
  const fullPath = path.resolve(configPath);
  const raw = await readFile(fullPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<ExperimentConfig>;
  if (!parsed.name) throw new Error("Experiment config requires name.");
  if (!Array.isArray(parsed.baseCommand)) throw new Error("Experiment config requires baseCommand array.");
  if (!Array.isArray(parsed.runs)) throw new Error("Experiment config requires runs array.");
  return {
    name: parsed.name,
    cwd: parsed.cwd,
    baseCommand: parsed.baseCommand,
    runs: parsed.runs,
  };
}

async function runOneExperiment(input: Readonly<{
  id: string;
  args: readonly string[];
  command: string;
  cwd: string;
  cliPath: string;
  outputDir: string;
}>): Promise<ExperimentSummary> {
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [input.cliPath, ...input.args],
      {
        cwd: input.cwd,
        maxBuffer: 128 * 1024 * 1024,
      },
    );
    if (stderr.trim()) {
      await writeFile(path.join(input.outputDir, `${safeSegment(input.id)}.stderr.txt`), stderr);
    }
    await writeFile(path.join(input.outputDir, `${safeSegment(input.id)}.json`), stdout);
    const report = JSON.parse(stdout) as Record<string, unknown>;
    const summary = summarizeReport(input.id, input.command, Date.now() - startedAt, report, []);
    await writeFile(path.join(input.outputDir, `${safeSegment(input.id)}-findings.md`), findingsMarkdown(summary, report));
    return summary;
  } catch (error) {
    const details = errorDetails(error);
    if (details.stdout) await writeFile(path.join(input.outputDir, `${safeSegment(input.id)}.stdout.txt`), details.stdout);
    if (details.stderr) await writeFile(path.join(input.outputDir, `${safeSegment(input.id)}.stderr.txt`), details.stderr);
    const summary = summarizeReport(input.id, input.command, Date.now() - startedAt, {}, [details.message]);
    await writeFile(path.join(input.outputDir, `${safeSegment(input.id)}-findings.md`), findingsMarkdown(summary, {}));
    return summary;
  }
}

function summarizeReport(
  id: string,
  command: string,
  elapsedMs: number,
  report: Record<string, unknown>,
  errors: readonly string[],
): ExperimentSummary {
  const run = objectValue(report.run);
  const auditStats = objectValue(run.auditStats);
  const traceEvents = arrayValue(run.traceEvents).map(objectValue);
  const findings = arrayValue(report.findings).map(objectValue);
  const targetPreview = arrayValue(run.debugTargets).map(objectValue).map(debugTargetRecord);
  const contextPackEvents = traceEvents.filter((event) => event.name === "context.pack");
  const auditBatchEvents = traceEvents.filter((event) => event.name === "audit.batch");
  const auditInputTokens = auditBatchEvents.map((event) => detailNumber(event.detail, "input_tokens")).filter(isNumber);

  return {
    id,
    command,
    totalMs: numberValue(objectValue(run.timingsMs).total, elapsedMs),
    entitiesScanned: numberValue(run.entitiesScanned, 0),
    targets: numberValue(run.auditedCandidateCount, 0),
    targetsByCheck: recordOfNumbers(run.targetsByCheck),
    auditContext: stringValue(run.auditContext, "unknown"),
    auditPrompt: stringValue(run.auditPrompt, "unknown"),
    repomixFiles: maxNumber(contextPackEvents.map((event) => numberValue(event.count, 0))),
    repomixTokens: maxNumber(contextPackEvents.map((event) => detailNumber(event.detail, "pack_tokens") ?? 0)),
    auditCalls: auditBatchEvents.length,
    auditInputTokens,
    auditMs: numberValue(objectValue(run.timingsMs).audit, 0),
    findings: findings.length,
    uncertain: numberValue(auditStats.uncertain, 0),
    clean: numberValue(auditStats.clean, 0),
    findingsByCheck: countBy(findings, "checkId"),
    uncertainByCheck: {},
    targetPreview,
    errors,
  };
}

function findingsMarkdown(summary: ExperimentSummary, report: Record<string, unknown>): string {
  const findings = arrayValue(report.findings).map(objectValue);
  const lines = [
    `# ${summary.id}`,
    "",
    `Runtime: ${Math.round(summary.totalMs / 1000)}s`,
    `Targets: ${summary.targets}`,
    `Findings: ${summary.findings}`,
    `Uncertain: ${summary.uncertain}`,
    "",
    "## Targets",
    ...targetMarkdown(summary.targetPreview),
    "",
    "## Findings",
  ];
  if (findings.length === 0) {
    lines.push("None.");
  } else {
    findings.forEach((finding, index) => {
      lines.push(
        `${index + 1}. ${stringValue(finding.checkId, "unknown")}`,
        `why: ${stringValue(finding.why, "")}`,
        `proof: ${stringValue(finding.proof, "")}`,
        "Manual label: [good/maybe/bad]",
        "",
      );
    });
  }
  if (summary.errors.length > 0) {
    lines.push("", "## Errors", ...summary.errors.map((error) => `- ${error}`));
  }
  return `${lines.join("\n")}\n`;
}

function targetMarkdown(targets: readonly DebugTargetRecord[]): readonly string[] {
  if (targets.length === 0) return ["None recorded."];
  return targets.map((target) => (
    `- ${target.targetId} ${target.checkId} ${target.entityKind ?? "unknown"}/${target.changeKind ?? "unknown"} ${target.entityId}
  reason: ${target.scoutReason ?? ""}`
  ));
}

function countBy(items: readonly Record<string, unknown>[], key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = stringValue(item[key], "");
    if (!value) continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function recordOfNumbers(value: unknown): Record<string, number> {
  const input = objectValue(value);
  const output: Record<string, number> = {};
  for (const [key, count] of Object.entries(input)) {
    if (typeof count === "number" && Number.isFinite(count)) output[key] = count;
  }
  return output;
}

function debugTargetRecord(value: Record<string, unknown>): DebugTargetRecord {
  return {
    targetId: stringValue(value.targetId, ""),
    checkId: stringValue(value.checkId, ""),
    entityId: stringValue(value.entityId, ""),
    entityKind: optionalString(value.entityKind),
    changeKind: optionalString(value.changeKind),
    scoutReason: optionalString(value.scoutReason),
    sourceLabel: optionalString(value.sourceLabel),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function ensureJson(args: string[]): string[] {
  return args.includes("--json") ? args : [...args, "--json"];
}

function resolveCwd(value: string | undefined): string {
  if (!value) return process.cwd();
  if (value.startsWith("$")) {
    const envName = value.slice(1);
    const envValue = process.env[envName];
    if (!envValue) throw new Error(`Experiment cwd env var ${envName} is not set.`);
    return path.resolve(envValue);
  }
  return path.resolve(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function detailNumber(value: unknown, key: string): number | null {
  if (typeof value !== "string") return null;
  const match = new RegExp(`${key}=([0-9]+)`).exec(value);
  return match ? Number(match[1]) : null;
}

function maxNumber(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function isNumber(value: number | null): value is number {
  return value !== null;
}

function errorDetails(error: unknown): Readonly<{ message: string; stdout?: string; stderr?: string }> {
  const candidate = objectValue(error);
  return {
    message: error instanceof Error ? error.message : String(error),
    stdout: typeof candidate.stdout === "string" ? candidate.stdout : undefined,
    stderr: typeof candidate.stderr === "string" ? candidate.stderr : undefined,
  };
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "experiment";
}
