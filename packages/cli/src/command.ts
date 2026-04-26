import { DEFAULT_MODEL_ID, MODEL_REGISTRY } from "./constants.ts";
import type { Command, ModelId } from "./types.ts";

const DEFAULT_RECENT_COMMIT_COUNT = 5;
type InputMode =
  | Readonly<{ kind: "stdin" }>
  | Readonly<{ kind: "commit"; commit: string }>
  | Readonly<{ kind: "commits"; count: number }>;

export function parseCommand(argv: readonly string[]): Command {
  if (argv.length === 1 && isHelp(argv[0])) {
    return { kind: "help" };
  }

  let inputMode: InputMode = { kind: "commits", count: DEFAULT_RECENT_COMMIT_COUNT };
  let explicitInputMode = false;
  let checkIds: readonly string[] | null = null;
  let json = false;
  let model: ModelId = DEFAULT_MODEL_ID;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--stdin") setInputMode({ kind: "stdin" });
    else if (arg === "--json") json = true;
    else if (arg === "--commit") {
      const value = argv[++index];
      if (!value || !isSafeCommitArg(value)) throw new Error("Invalid commit.");
      setInputMode({ kind: "commit", commit: value });
    } else if (arg === "--commits") {
      const value = argv[++index];
      const count = Number(value);
      if (!Number.isInteger(count) || count < 1) throw new Error("--commits requires a positive integer.");
      setInputMode({ kind: "commits", count });
    } else if (arg === "--checks") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error("--checks requires a comma-separated list.");
      checkIds = value.split(",").map((id) => id.trim()).filter(Boolean);
      if (checkIds.length === 0) throw new Error("--checks requires at least one check id.");
    } else if (arg === "--model") {
      const value = argv[++index];
      if (!value || !isModelId(value)) throw new Error(`--model must be one of: ${Object.keys(MODEL_REGISTRY).join(", ")}`);
      model = value;
    } else throw new Error(`Unknown option: ${arg}`);
  }

  return { ...inputMode, checkIds, json, model };

  function setInputMode(next: InputMode): void {
    if (explicitInputMode) throw new Error("Choose only one input mode: --stdin, --commit, or --commits.");
    inputMode = next;
    explicitInputMode = true;
  }
}

function isSafeCommitArg(value: string): boolean {
  return value.length > 0 && !value.startsWith("-") && /^[A-Za-z0-9._/@~^:+-]+$/.test(value);
}

function isHelp(value: string): boolean {
  return value === "--help" || value === "-h";
}

function isModelId(value: string): value is ModelId {
  return value in MODEL_REGISTRY;
}
