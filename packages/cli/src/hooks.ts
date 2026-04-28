import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gitPath, gitRoot } from "./git.ts";
import type { HookAction } from "./types.ts";
import type { CliUi } from "./ui.ts";

const execFileAsync = promisify(execFile);
const START = "# stupify hook start";
const END = "# stupify hook end";

export async function runHookCommand(action: HookAction): Promise<string> {
  if (action === "status") return hookStatus();
  if (action === "install") return installHook();
  return uninstallHook();
}

export function renderHookResultToUi(result: string, ui: CliUi): void {
  const [firstLine = "Stupify hook: no status returned", ...rest] = result.split(/\r?\n/);
  if (firstLine.includes("not installed")) {
    ui.info(firstLine);
  } else if (firstLine.includes("installed") || firstLine.includes("updated") || firstLine.includes("uninstalled")) {
    ui.success(firstLine);
  } else if (firstLine.includes("existing non-Stupify")) {
    ui.warn(firstLine);
  } else {
    ui.info(firstLine);
  }

  const detail = rest.join("\n").trim();
  if (detail) ui.note(detail, "Hook");
}

export function hookSnippet(): string {
  return managedBlock("stupify --staged");
}

async function hookStatus(): Promise<string> {
  const hookPath = await preCommitHookPath();
  if (!existsSync(hookPath)) return "Stupify hook: not installed";

  const content = await readFile(hookPath, "utf8");
  if (hasManagedBlock(content)) return "Stupify hook: installed";
  return "Stupify hook: existing non-Stupify pre-commit hook found";
}

async function installHook(): Promise<string> {
  const hookPath = await preCommitHookPath();
  const block = await managedBlockForInstall();
  if (!existsSync(hookPath)) {
    await writeFile(hookPath, `#!/bin/sh\n${block}\n`, "utf8");
    await chmod(hookPath, 0o755);
    return "Stupify hook: installed";
  }

  const content = await readFile(hookPath, "utf8");
  if (hasManagedBlock(content)) {
    await writeFile(hookPath, `${replaceManagedBlock(content, block).trimEnd()}\n`, "utf8");
    await chmod(hookPath, 0o755);
    return "Stupify hook: updated";
  }

  if (isEffectivelyEmptyHook(content)) {
    await writeFile(hookPath, `#!/bin/sh\n${block}\n`, "utf8");
    await chmod(hookPath, 0o755);
    return "Stupify hook: installed";
  }

  return `Stupify hook: existing non-Stupify pre-commit hook found; not modified.
Add this snippet manually if you want Stupify in that hook:
${block}`;
}

async function uninstallHook(): Promise<string> {
  const hookPath = await preCommitHookPath();
  if (!existsSync(hookPath)) return "Stupify hook: not installed";

  const content = await readFile(hookPath, "utf8");
  if (!hasManagedBlock(content)) return "Stupify hook: not installed";

  const next = replaceManagedBlock(content, "").trim();
  if (isEffectivelyEmptyHook(next)) {
    await rm(hookPath, { force: true });
    return "Stupify hook: uninstalled";
  }

  await writeFile(hookPath, `${next}\n`, "utf8");
  await chmod(hookPath, 0o755);
  return "Stupify hook: uninstalled";
}

async function preCommitHookPath(): Promise<string> {
  const [root, hook] = await Promise.all([gitRoot(), gitPath("hooks/pre-commit")]);
  return path.isAbsolute(hook) ? hook : path.join(root, hook);
}

function hasManagedBlock(content: string): boolean {
  return content.includes(START) && content.includes(END);
}

async function managedBlockForInstall(): Promise<string> {
  if (await commandExists("stupify")) return managedBlock("stupify --staged");

  const root = await gitRoot();
  const localEntrypoint = path.join(root, "packages", "cli", "src", "stupify.ts");
  if (existsSync(localEntrypoint) && await commandExists("bun")) {
    return managedBlock(`bun ${shellQuote(localEntrypoint)} --staged`);
  }

  return managedBlock("stupify --staged");
}

function managedBlock(command: string): string {
  return `${START}
${command} || true
${END}`;
}

function replaceManagedBlock(content: string, replacement: string): string {
  const pattern = new RegExp(`${escapeRegExp(START)}[\\s\\S]*?${escapeRegExp(END)}`);
  return content.replace(pattern, replacement);
}

function isEffectivelyEmptyHook(content: string): boolean {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "#!/bin/sh" && line !== "#!/usr/bin/env sh")
    .length === 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-c", `command -v ${shellQuote(command)}`], {
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
