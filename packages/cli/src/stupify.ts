#!/usr/bin/env node

import { fileURLToPath } from "node:url";

const VERSION = "0.0.0";

type ParsedArgs = Readonly<{
  help: boolean;
  llm: boolean;
  share: boolean;
  json: boolean;
  privacy: boolean;
  since: string | null;
}>;

type Io = Readonly<{
  stdout: Pick<typeof console, "log">;
  stderr: Pick<typeof console, "error">;
}>;

const DEFAULT_IO: Io = {
  stdout: console,
  stderr: console,
};

const HELP = `Stupify ${VERSION}

Checks whether AI is making you dumber.

Usage:
  stupify [options]

Options:
  --llm                 Planned: use a local LLM for diagnostic judgment.
  --since <range>       Planned: check recent changes only.
  --share               Planned: upload sanitized report metadata.
  --json                Print machine-readable output.
  --privacy             Show what can and cannot leave your machine.
  -h, --help            Show this help.

Current status:
  Structure-only foundation. Diagnostic engine not implemented yet.
`;

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed = {
    help: false,
    llm: false,
    share: false,
    json: false,
    privacy: false,
    since: null as string | null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--since") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--since requires a value, for example: --since \"1 week ago\"");
      }
      parsed.since = value;
      i += 1;
      continue;
    }

    if (arg === "--llm") {
      parsed.llm = true;
      continue;
    }

    if (arg === "--share") {
      parsed.share = true;
      continue;
    }

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--privacy") {
      parsed.privacy = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

export function main(argv: readonly string[], io: Io = DEFAULT_IO): number {
  try {
    const args = parseArgs(argv);

    if (args.help) {
      io.stdout.log(HELP);
      return 0;
    }

    if (args.privacy) {
      io.stdout.log(formatPrivacy());
      return 0;
    }

    if (args.json) {
      io.stdout.log(JSON.stringify(formatJson(args), null, 2));
      return 0;
    }

    io.stdout.log(formatPlaceholder(args));
    return 0;
  } catch (error) {
    io.stderr.error(error instanceof Error ? error.message : String(error));
    io.stderr.error("Run `stupify --help` for usage.");
    return 1;
  }
}

function formatPrivacy(): string {
  return `STUPIFY PRIVACY

Current status:
  Structure-only foundation. Nothing is uploaded.

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

function formatJson(args: ParsedArgs): Record<string, unknown> {
  return {
    status: "not_implemented",
    message: "Diagnostic engine not implemented yet.",
    engine: "none",
    uploaded: false,
    requested: {
      llm: args.llm,
      share: args.share,
      since: args.since,
    },
  };
}

function formatPlaceholder(args: ParsedArgs): string {
  const lines = [
    "STUPIFY REPORT",
    "",
    "Question:",
    "  Is AI making you dumber?",
    "",
    "Status:",
    "  Diagnostic engine not implemented yet.",
    "",
    "What happened:",
    "  No files were scanned.",
    "  No diffs were read.",
    "  No local model was contacted.",
    "  Nothing was uploaded.",
    "",
  ];

  if (args.llm) {
    lines.push("Requested --llm: local LLM wiring is planned but not implemented yet.", "");
  }

  if (args.share) {
    lines.push("Requested --share: upload wiring is planned but not implemented yet.", "");
  }

  if (args.since) {
    lines.push(`Requested --since: ${args.since}`, "");
  }

  lines.push("Run `stupify --help` for the planned interface.");

  return lines.join("\n");
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  process.exitCode = main(process.argv.slice(2));
}
