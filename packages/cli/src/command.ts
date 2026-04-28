import { DEFAULT_MODEL_ID, MODEL_REGISTRY } from "./constants.ts";
import type { Command, HookAction, ModelId, SearchSource } from "./types.ts";

const DEFAULT_SINCE = "2 weeks ago";
const DEFAULT_MAX_CANDIDATES = 10;
const DEFAULT_MAX_SEARCH_INPUT_TOKENS = 12_000;

type InputMode =
  | Readonly<{ kind: "since"; since: string; source: "since" }>
  | Readonly<{ kind: "stdin"; source: "stdin" }>
  | Readonly<{ kind: "commit"; commit: string; source: "commit" }>
  | Readonly<{ kind: "commits"; count: number; source: "commits" }>
  | Readonly<{ kind: "staged"; source: "staged" }>;

export function parseCommand(argv: readonly string[]): Command {
  if (argv.length === 1 && isHelp(argv[0])) return { kind: "help" };
  if (argv[0] === "bench") {
    if (argv[1] !== "search" || !argv[2] || argv.length > 3) {
      throw new Error("Usage: stupify bench search <config.json>");
    }
    return { kind: "bench-search", configPath: argv[2] };
  }
  if (argv[0] === "hook") {
    const action = argv[1];
    if (!action || !isHookAction(action) || argv.length > 2) {
      throw new Error("Usage: stupify hook install|uninstall|status");
    }
    return { kind: "hook", action };
  }
  if (argv[0] === "doctor") {
    if (argv.length > 1) throw new Error("Usage: stupify doctor");
    return { kind: "doctor" };
  }

  type ParseState = Readonly<{
    inputMode: InputMode;
    explicitInputMode: boolean;
    checkIds: readonly string[] | null;
    json: boolean;
    model: ModelId;
    debugSem: boolean;
    maxCandidates: number;
    maxSearchInputTokens: number;
    searchProfilePath: string | null;
    includeCounterReasonInPrompt: boolean;
  }>;

  const initialState: ParseState = {
    inputMode: { kind: "since", since: DEFAULT_SINCE, source: "since" },
    explicitInputMode: false,
    checkIds: null,
    json: false,
    model: DEFAULT_MODEL_ID,
    debugSem: false,
    maxCandidates: DEFAULT_MAX_CANDIDATES,
    maxSearchInputTokens: DEFAULT_MAX_SEARCH_INPUT_TOKENS,
    searchProfilePath: null,
    includeCounterReasonInPrompt: false,
  };

  const finalState = parseFrom(0, initialState);
  return {
    ...finalState.inputMode,
    mode: "search",
    checkIds: finalState.checkIds,
    json: finalState.json,
    model: finalState.model,
    debugSem: finalState.debugSem,
    maxCandidates: finalState.maxCandidates,
    maxSearchInputTokens: finalState.maxSearchInputTokens,
    searchProfilePath: finalState.searchProfilePath,
    includeCounterReasonInPrompt: finalState.includeCounterReasonInPrompt,
  };

  function parseFrom(index: number, state: ParseState): ParseState {
    if (index >= argv.length) return state;

    const arg = argv[index];

    if (arg === "--mode") {
      const value = argv[index + 1];
      if (value !== "search") throw new Error("--mode only supports search.");
      return parseFrom(index + 2, state);
    }
    if (arg === "--staged") return parseFrom(index + 1, setInputMode(state, { kind: "staged", source: "staged" }));
    if (arg === "--stdin") return parseFrom(index + 1, setInputMode(state, { kind: "stdin", source: "stdin" }));
    if (arg === "--json") return parseFrom(index + 1, { ...state, json: true });
    if (arg === "--debug-sem") return parseFrom(index + 1, { ...state, debugSem: true });
    if (arg === "--include-counter-reason-in-prompt") {
      return parseFrom(index + 1, { ...state, includeCounterReasonInPrompt: true });
    }

    if (arg === "--search-profile") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error("--search-profile requires a JSON profile path.");
      return parseFrom(index + 2, { ...state, searchProfilePath: value });
    }

    if (arg === "--since") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error("--since requires a git date, such as \"2 weeks ago\".");
      return parseFrom(index + 2, setInputMode(state, { kind: "since", since: value, source: "since" }));
    }

    if (arg === "--commit") {
      const value = argv[index + 1];
      if (!value || !isSafeCommitArg(value)) throw new Error("Invalid commit.");
      return parseFrom(index + 2, setInputMode(state, { kind: "commit", commit: value, source: "commit" }));
    }

    if (arg === "--commits") {
      const value = argv[index + 1];
      const count = Number(value);
      if (!Number.isInteger(count) || count < 1) throw new Error("--commits requires a positive integer.");
      return parseFrom(index + 2, setInputMode(state, { kind: "commits", count, source: "commits" }));
    }

    if (arg === "--checks") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error("--checks requires a comma-separated list.");
      const checkIds = value.split(",").map((id) => id.trim()).filter(Boolean);
      if (checkIds.length === 0) throw new Error("--checks requires at least one check id.");
      return parseFrom(index + 2, { ...state, checkIds });
    }

    if (arg === "--model") {
      const value = argv[index + 1];
      if (!value || !isModelId(value)) throw new Error(`--model must be one of: ${Object.keys(MODEL_REGISTRY).join(", ")}`);
      return parseFrom(index + 2, { ...state, model: value });
    }

    if (arg === "--max-candidates") {
      const value = argv[index + 1];
      const maxCandidates = Number(value);
      if (!Number.isInteger(maxCandidates) || maxCandidates < 1) {
        throw new Error("--max-candidates requires a positive integer.");
      }
      return parseFrom(index + 2, { ...state, maxCandidates });
    }

    if (arg === "--max-search-input-tokens") {
      const value = argv[index + 1];
      const maxSearchInputTokens = Number(value);
      if (!Number.isInteger(maxSearchInputTokens) || maxSearchInputTokens < 1) {
        throw new Error("--max-search-input-tokens requires a positive integer.");
      }
      return parseFrom(index + 2, { ...state, maxSearchInputTokens });
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  function setInputMode(state: ParseState, next: InputMode): ParseState {
    if (state.explicitInputMode) throw new Error("Choose only one input mode: --since, --stdin, --commit, --commits, or --staged.");
    return { ...state, inputMode: next, explicitInputMode: true };
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

function isHookAction(value: string): value is HookAction {
  return value === "install" || value === "uninstall" || value === "status";
}
