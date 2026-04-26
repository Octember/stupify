#!/usr/bin/env node

import { fileURLToPath } from "node:url";

const VERSION = "0.0.0";

type Command = Readonly<{
  kind: "analyze" | "help" | "privacy";
  json: boolean;
  llm: boolean;
  share: boolean;
  since: string | null;
}>;

type BoundaryState = Readonly<{
  status: "ready" | "not_ready" | "skipped";
  message: string;
}>;

type Analysis = Readonly<{
  status: "not_ready";
  question: "Is AI making you dumber?";
  scannedFiles: 0;
  readDiffs: false;
  contactedModel: boolean;
  uploaded: false;
  message: string;
}>;

type Io = Readonly<{
  stdout: Pick<typeof console, "log">;
  stderr: Pick<typeof console, "error">;
}>;

const DEFAULT_IO: Io = { stdout: console, stderr: console };

const HELP = `Stupify ${VERSION}

Checks whether AI is making you dumber.

Usage:
  stupify [options]

Options:
  --since <range>       Planned: check recent changes only.
  --json                Print machine-readable output.
  --privacy             Show what can and cannot leave your machine.
  --llm                 Accepted for now; local LLM will be the default engine.
  --share               Planned: upload sanitized report metadata later.
  -h, --help            Show this help.

Current status:
  Boundary scaffold only. Diagnostic analysis is not implemented yet.
`;

export async function main(argv: readonly string[], io: Io = DEFAULT_IO): Promise<number> {
  try {
    const command = localCommandInterface(argv);
    const llm = await llmInterface(command);
    const analysis = await rollupAnalysisLocally(command, llm);
    const tui = tuiAroundAnalysis(command, analysis);
    const share = await shareAfter(command, analysis);

    io.stdout.log(command.json ? JSON.stringify({ analysis, llm, share }, null, 2) : tui);
    return 0;
  } catch (error) {
    io.stderr.error(error instanceof Error ? error.message : String(error));
    io.stderr.error("Run `stupify --help` for usage.");
    return 1;
  }
}

export function parseArgs(argv: readonly string[]): Command {
  return localCommandInterface(argv);
}

function localCommandInterface(argv: readonly string[]): Command {
  const command = {
    kind: "analyze" as Command["kind"],
    json: false,
    llm: false,
    share: false,
    since: null as string | null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") command.kind = "help";
    else if (arg === "--privacy") command.kind = "privacy";
    else if (arg === "--json") command.json = true;
    else if (arg === "--llm") command.llm = true;
    else if (arg === "--share") command.share = true;
    else if (arg === "--since") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) {
        throw new Error("--since requires a value, for example: --since \"1 week ago\"");
      }
      command.since = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return command;
}

async function llmInterface(command: Command): Promise<BoundaryState> {
  if (command.kind !== "analyze") return skipped("LLM not needed for this command.");
  return notReady("Local LLM detection and calls are not implemented yet.");
}

async function rollupAnalysisLocally(
  command: Command,
  llm: BoundaryState,
): Promise<Analysis> {
  return {
    status: "not_ready",
    question: "Is AI making you dumber?",
    scannedFiles: 0,
    readDiffs: false,
    contactedModel: llm.status === "ready",
    uploaded: false,
    message:
      command.kind === "analyze"
        ? "Diagnostic analysis is not implemented yet."
        : "Analysis skipped for this command.",
  };
}

function tuiAroundAnalysis(command: Command, analysis: Analysis): string {
  if (command.kind === "help") return HELP;
  if (command.kind === "privacy") return privacyText();

  return `STUPIFY REPORT

Question:
  ${analysis.question}

Status:
  ${analysis.message}

Boundaries:
  Local command interface: ready
  LLM interface: stubbed
  Local rollup analysis: stubbed
  TUI around analysis: ready
  Share after analysis: ${command.share ? "stubbed" : "skipped"}

What happened:
  No files were scanned.
  No diffs were read.
  No local model was contacted.
  Nothing was uploaded.
`;
}

async function shareAfter(command: Command, _analysis: Analysis): Promise<BoundaryState> {
  if (!command.share) return skipped("Share not requested.");
  return notReady("Share upload comes after local analysis and is not implemented yet.");
}

function privacyText(): string {
  return `STUPIFY PRIVACY

Current status:
  Boundary scaffold only. Nothing is uploaded.

Future share uploads may include:
  - Diagnosis metadata
  - Score labels and values
  - Failure mode labels
  - One-sentence explanations
  - Redacted proof pointers

Future share uploads must not include:
  - Source code
  - Diffs
  - Commit messages
  - File contents
  - Raw filenames
  - Repo URLs
  - Author names
  - Private package names
`;
}

function skipped(message: string): BoundaryState {
  return { status: "skipped", message };
}

function notReady(message: string): BoundaryState {
  return { status: "not_ready", message };
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  process.exitCode = await main(process.argv.slice(2));
}
