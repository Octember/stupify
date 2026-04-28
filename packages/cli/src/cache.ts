import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import path from "node:path";

export function fingerprint(value: unknown): string {
  const text = typeof value === "string" ? value : stableStringify(value);
  return createHash("sha256").update(text).digest("hex");
}

export async function cachedJson<T>(
  namespace: string,
  key: string,
  compute: () => Promise<T>,
): Promise<T> {
  const filePath = cachePath(namespace, key);
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as T;
    return value;
  } catch {
  }

  const value = await compute();
  await writeCache(filePath, value).catch(() => undefined);
  return value;
}

function cachePath(namespace: string, key: string): string {
  return path.join(cacheRoot(), "intermediate-v1", safeNamespace(namespace), `${key}.json`);
}

async function writeCache(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(value), "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

function cacheRoot(): string {
  if (process.env.STUPIFY_CACHE_DIR) return process.env.STUPIFY_CACHE_DIR;
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, "stupify");
  if (platform() === "darwin") return path.join(homedir(), "Library", "Caches", "stupify");
  if (platform() === "win32" && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "stupify", "Cache");
  return path.join(homedir(), ".cache", "stupify");
}

function safeNamespace(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableStringify(record[key])}`
  ).join(",")}}`;
}
