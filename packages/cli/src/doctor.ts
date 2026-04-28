import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_MODEL_ID, MODEL_REGISTRY } from "./constants.ts";
import { runHookCommand } from "./hooks.ts";

const execFileAsync = promisify(execFile);

type CheckStatus = "ok" | "missing" | "info";

type DoctorCheck = Readonly<{
  label: string;
  status: CheckStatus;
  detail: string;
  required?: boolean;
}>;

export async function runDoctor(): Promise<Readonly<{ exitCode: number; text: string }>> {
  const checks = await Promise.all([
    gitCheck(),
    hookCheck(),
    semCheck(),
    repomixCheck(),
    llamaServerCheck(),
    modelCacheCheck(),
  ]);
  const requiredMissing = checks.some((check) => check.required && check.status === "missing");
  return {
    exitCode: requiredMissing ? 1 : 0,
    text: renderDoctor(checks),
  };
}

async function gitCheck(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { maxBuffer: 1024 * 1024 });
    return { label: "git repo", status: "ok", detail: stdout.trim(), required: true };
  } catch {
    return { label: "git repo", status: "missing", detail: "not inside a git repository", required: true };
  }
}

async function hookCheck(): Promise<DoctorCheck> {
  try {
    const status = await runHookCommand("status");
    return { label: "pre-commit hook", status: "info", detail: status.replace(/^Stupify hook:\s*/, "") };
  } catch (error) {
    return { label: "pre-commit hook", status: "info", detail: errorMessage(error) };
  }
}

async function semCheck(): Promise<DoctorCheck> {
  const packageBin = resolvePackage("@ataraxy-labs/sem/bin/sem.js");
  if (packageBin) return { label: "sem", status: "ok", detail: "@ataraxy-labs/sem package binary found", required: true };
  if (await commandExists("sem")) return { label: "sem", status: "ok", detail: "sem found on PATH", required: true };
  return { label: "sem", status: "missing", detail: "install @ataraxy-labs/sem or put sem on PATH", required: true };
}

async function repomixCheck(): Promise<DoctorCheck> {
  if (resolvePackage("repomix")) return { label: "Repomix", status: "ok", detail: "repomix package found", required: true };
  return { label: "Repomix", status: "missing", detail: "repomix package is not installed", required: true };
}

async function llamaServerCheck(): Promise<DoctorCheck> {
  if (await commandExists("llama-server")) return { label: "llama-server", status: "ok", detail: "llama-server found on PATH", required: true };
  return { label: "llama-server", status: "missing", detail: "install llama.cpp, for example `brew install llama.cpp`", required: true };
}

async function modelCacheCheck(): Promise<DoctorCheck> {
  const model = MODEL_REGISTRY[DEFAULT_MODEL_ID];
  const modelPath = path.join(cacheDir(), "models", model.file);
  if (await fileExists(modelPath)) return { label: "default model", status: "ok", detail: `${model.name} cached` };
  return {
    label: "default model",
    status: "info",
    detail: `${model.name} not cached yet; first interactive search can download it locally`,
  };
}

function renderDoctor(checks: readonly DoctorCheck[]): string {
  const lines = [
    "Stupify doctor",
    "",
    ...checks.map((check) => `${icon(check.status)} ${check.label}: ${check.detail}`),
    "",
    "Privacy: local-only. Stupify does not upload source, diffs, filenames, repo URLs, commit messages, author names, or private package names.",
  ];
  return lines.join("\n");
}

function icon(status: CheckStatus): string {
  if (status === "ok") return "OK";
  if (status === "missing") return "MISSING";
  return "INFO";
}

function resolvePackage(specifier: string): string | null {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve(specifier);
  } catch {
    return null;
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-c", `command -v ${shellQuote(command)}`], { maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function cacheDir(): string {
  if (process.env.STUPIFY_CACHE_DIR) return process.env.STUPIFY_CACHE_DIR;
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, "stupify");
  if (platform() === "darwin") return path.join(homedir(), "Library", "Caches", "stupify");
  if (platform() === "win32" && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "stupify", "Cache");
  return path.join(homedir(), ".cache", "stupify");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
