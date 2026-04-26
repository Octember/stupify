import type { Command } from "./types.js";

export function parseCommand(argv: readonly string[]): Command {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return { kind: "help" };
  }
  if (argv.length === 1 && argv[0] === "--stdin") return { kind: "stdin" };
  if (argv.length === 2 && argv[0] === "--commit") {
    if (!isSafeCommitArg(argv[1])) throw new Error("Invalid commit.");
    return { kind: "commit", commit: argv[1] };
  }
  throw new Error("Usage: stupify --commit <commit>");
}

function isSafeCommitArg(value: string): boolean {
  return value.length > 0 && !value.startsWith("-") && /^[A-Za-z0-9._/@~^:+-]+$/.test(value);
}
