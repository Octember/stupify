import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { stdin as input, stderr as statusOutput, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { getLlama, LlamaChatSession } from "node-llama-cpp";
import { MODEL_REGISTRY } from "./constants.ts";
import type { ModelId } from "./types.ts";

export type LocalModel = Readonly<{
  llama: Awaited<ReturnType<typeof getLlama>>;
  session: LlamaChatSession;
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

export async function loadLocalModel(modelPath: string, modelName = "local model"): Promise<LocalModel> {
  console.error(`Loading local model weights: ${modelName}`);
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext();
  return { llama, session: new LlamaChatSession({ contextSequence: context.getSequence() }) };
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
  if (platform() !== "win32") {
    return { input: createReadStream("/dev/tty"), output: createWriteStream("/dev/tty") };
  }
  throw new Error("No local Stupify model found. Run `stupify` once in an interactive terminal to set up the model.");
}

function cacheDir(): string {
  if (process.env.STUPIFY_CACHE_DIR) return process.env.STUPIFY_CACHE_DIR;
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, "stupify");
  if (platform() === "darwin") return path.join(homedir(), "Library", "Caches", "stupify");
  if (platform() === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "stupify", "Cache");
  }
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
