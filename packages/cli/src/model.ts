import { execFile, spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { stdin as input, stderr as statusOutput, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { promisify } from "node:util";
import { MODEL_REGISTRY } from "./constants.ts";
import type { ModelId } from "./types.ts";

const execFileAsync = promisify(execFile);
const DEFAULT_LLAMA_SERVER_URL = "http://127.0.0.1:8091";
const LLAMA_SERVER_HOST = "127.0.0.1";
const LLAMA_SERVER_PORT = "8091";

export type LocalModel = Readonly<{
  id: ModelId;
  name: string;
  baseUrl: string;
}>;

export async function firstRunModelBootstrap(modelId: ModelId): Promise<string> {
  const selectedModel = MODEL_REGISTRY[modelId];
  const modelDir = path.join(cacheDir(), "models");
  const modelPath = path.join(modelDir, selectedModel.file);
  if (await exists(modelPath)) return modelPath;

  console.error(`No local Stupify model found.
Stupify runs locally.
Download this model now?
Model: ${selectedModel.name}
Size: ${selectedModel.size}`);

  if (!(await confirm("Continue? y/N "))) throw new Error("Setup cancelled.");

  await mkdir(modelDir, { recursive: true });
  await downloadModel(modelPath, selectedModel.url);
  if (!(await exists(modelPath))) throw new Error("Model download failed: file was not created.");
  return modelPath;
}

export async function loadLocalModel(modelPath: string, modelId: ModelId): Promise<LocalModel> {
  const selectedModel = MODEL_REGISTRY[modelId];
  const baseUrl = process.env.STUPIFY_LLAMA_SERVER_URL ?? DEFAULT_LLAMA_SERVER_URL;
  const runningModel = await runningServerModel(baseUrl);

  if (runningModel) {
    if (runningModel !== modelId) await stopManagedServer(baseUrl);
    if (runningModel === modelId) {
      console.error(`Using already-loaded local model: ${selectedModel.name}`);
      return { id: modelId, name: selectedModel.name, baseUrl };
    }
  }

  await ensureLlamaServerBinary();
  await startLlamaServer(modelPath, modelId, selectedModel.name);
  await waitForServer(baseUrl, modelId);
  return { id: modelId, name: selectedModel.name, baseUrl };
}

async function runningServerModel(baseUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(500) });
    if (!response.ok) return null;
    const body = await response.json() as { data?: Array<{ id?: unknown }> };
    const id = body.data?.[0]?.id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

async function ensureLlamaServerBinary(): Promise<void> {
  try {
    await execFileAsync("llama-server", ["--version"], { maxBuffer: 1024 * 1024 });
  } catch {
    throw new Error(`Stupify needs llama-server for local inference.
Install llama.cpp first:
  brew install llama.cpp`);
  }
}

async function startLlamaServer(modelPath: string, modelId: ModelId, modelName: string): Promise<void> {
  const logDir = path.join(cacheDir(), "logs");
  await mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, "llama-server.log");
  const out = await open(logPath, "a");
  const err = await open(logPath, "a");

  console.error(`Starting local model server: ${modelName}`);
  console.error(`llama-server log: ${logPath}`);

  const child = spawn("llama-server", [
    "-m", modelPath,
    "-a", modelId,
    "--host", LLAMA_SERVER_HOST,
    "--port", LLAMA_SERVER_PORT,
    "-c", "65536",
    "--reasoning", "off",
    "--no-warmup",
  ], {
    detached: true,
    stdio: ["ignore", out.fd, err.fd],
  });

  child.unref();
  if (child.pid) await writeFile(pidPath(), String(child.pid));
  await out.close();
  await err.close();
}

async function stopManagedServer(baseUrl: string): Promise<void> {
  const pid = await managedServerPid();
  if (!pid) {
    const runningModel = await runningServerModel(baseUrl);
    throw new Error(`A llama-server is already running with ${runningModel ?? "another model"}.
Stop it before switching models, or use STUPIFY_LLAMA_SERVER_URL for that server.`);
  }

  console.error("Restarting local model server for selected model.");
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    await rm(pidPath(), { force: true });
    return;
  }

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!(await runningServerModel(baseUrl))) {
      await rm(pidPath(), { force: true });
      return;
    }
    await sleep(250);
  }

  throw new Error("Timed out while stopping existing llama-server.");
}

async function managedServerPid(): Promise<number | null> {
  try {
    const value = Number((await readFile(pidPath(), "utf8")).trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function pidPath(): string {
  return path.join(cacheDir(), "llama-server.pid");
}

async function waitForServer(baseUrl: string, modelId: ModelId): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const runningModel = await runningServerModel(baseUrl);
    if (runningModel === modelId) return;
    await sleep(500);
  }
  throw new Error(`llama-server did not become ready for ${modelId}.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadModel(modelPath: string, modelUrl: string): Promise<void> {
  const tempPath = `${modelPath}.download`;
  await rm(tempPath, { force: true });

  console.error("Downloading model...");
  try {
    const response = await fetch(modelUrl);
    if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}`);

    const total = Number(response.headers.get("content-length") ?? 0);
    let received = 0;
    let lastPrint = 0;
    const reader = response.body.getReader();
    const file = await open(tempPath, "wx");

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        await file.write(value);
        const now = Date.now();
        if (total > 0 && now - lastPrint > 500) {
          lastPrint = now;
          statusOutput.write(`\r${formatBytes(received)} / ${formatBytes(total)}`);
        }
      }
    } finally {
      await file.close();
    }

    if (total > 0) statusOutput.write(`\r${formatBytes(received)} / ${formatBytes(total)}\n`);
    await rename(tempPath, modelPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface(terminalIo());
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function terminalIo(): { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } {
  if (input.isTTY) return { input, output };
  if (platform() !== "win32") return { input: createReadStream("/dev/tty"), output: createWriteStream("/dev/tty") };
  throw new Error("No local Stupify model found. Run `stupify` once in an interactive terminal to set up the model.");
}

function cacheDir(): string {
  if (process.env.STUPIFY_CACHE_DIR) return process.env.STUPIFY_CACHE_DIR;
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, "stupify");
  if (platform() === "darwin") return path.join(homedir(), "Library", "Caches", "stupify");
  if (platform() === "win32" && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "stupify", "Cache");
  return path.join(homedir(), ".cache", "stupify");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
