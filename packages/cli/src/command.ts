import { DEFAULT_MODEL_ID, MODEL_REGISTRY } from "./constants.ts";
import type { AuditContextMode, AuditPromptName, Command, Engine, ModelId, ScoutMode } from "./types.ts";

const DEFAULT_SINCE = "2 weeks ago";
const DEFAULT_MAX_CANDIDATES = 10;
const DEFAULT_SCOUT_MODE: ScoutMode = "counter";
const DEFAULT_AUDIT_CONTEXT: AuditContextMode = "repomix";
const DEFAULT_AUDIT_PROMPT: AuditPromptName = "high_bar";
const DEFAULT_AUDIT_BATCH_SIZE = 25;
const DEFAULT_MAX_AUDIT_INPUT_TOKENS = 20_000;
const DEFAULT_AUDIT_CONCURRENCY = 2;
type InputMode =
  | Readonly<{ kind: "since"; since: string }>
  | Readonly<{ kind: "stdin" }>
  | Readonly<{ kind: "commit"; commit: string }>
  | Readonly<{ kind: "commits"; count: number }>;

export function parseCommand(argv: readonly string[]): Command {
  if (argv.length === 1 && isHelp(argv[0])) return { kind: "help" };
  if (argv[0] === "experiment") {
    const configPath = argv[1];
    if (!configPath || argv.length > 2) throw new Error("Usage: stupify experiment <config.json>");
    return { kind: "experiment", configPath };
  }

  type ParseState = Readonly<{
    inputMode: InputMode;
    explicitInputMode: boolean;
    checkIds: readonly string[] | null;
    json: boolean;
    model: ModelId;
    engine: Engine;
    scout: ScoutMode;
    auditContext: AuditContextMode;
    auditPrompt: AuditPromptName;
    debugSem: boolean;
    debugTargets: boolean;
    maxCandidates: number;
    auditBatchSize: number;
    maxAuditInputTokens: number;
    auditConcurrency: number;
  }>;

  const initialState: ParseState = {
    inputMode: { kind: "since", since: DEFAULT_SINCE },
    explicitInputMode: false,
    checkIds: null,
    json: false,
    model: DEFAULT_MODEL_ID,
    engine: "raw-diff",
    scout: DEFAULT_SCOUT_MODE,
    auditContext: DEFAULT_AUDIT_CONTEXT,
    auditPrompt: DEFAULT_AUDIT_PROMPT,
    debugSem: false,
    debugTargets: false,
    maxCandidates: DEFAULT_MAX_CANDIDATES,
    auditBatchSize: DEFAULT_AUDIT_BATCH_SIZE,
    maxAuditInputTokens: DEFAULT_MAX_AUDIT_INPUT_TOKENS,
    auditConcurrency: DEFAULT_AUDIT_CONCURRENCY,
  };

  const finalState = parseFrom(0, initialState);
  return {
    ...finalState.inputMode,
    checkIds: finalState.checkIds,
    json: finalState.json,
    model: finalState.model,
    engine: finalState.engine,
    scout: finalState.scout,
    auditContext: finalState.auditContext,
    auditPrompt: finalState.auditPrompt,
    debugSem: finalState.debugSem,
    debugTargets: finalState.debugTargets,
    maxCandidates: finalState.maxCandidates,
    auditBatchSize: finalState.auditBatchSize,
    maxAuditInputTokens: finalState.maxAuditInputTokens,
    auditConcurrency: finalState.auditConcurrency,
  };

  function parseFrom(index: number, state: ParseState): ParseState {
    if (index >= argv.length) return state;

    const arg = argv[index];

    if (arg === "--stdin") return parseFrom(index + 1, setInputMode(state, { kind: "stdin" }));
    if (arg === "--json") return parseFrom(index + 1, { ...state, json: true });
    if (arg === "--debug-sem") return parseFrom(index + 1, { ...state, debugSem: true });
    if (arg === "--debug-targets") return parseFrom(index + 1, { ...state, debugTargets: true });

    if (arg === "--since") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error("--since requires a git date, such as \"2 weeks ago\".");
      return parseFrom(index + 2, setInputMode(state, { kind: "since", since: value }));
    }

    if (arg === "--commit") {
      const value = argv[index + 1];
      if (!value || !isSafeCommitArg(value)) throw new Error("Invalid commit.");
      return parseFrom(index + 2, setInputMode(state, { kind: "commit", commit: value }));
    }

    if (arg === "--commits") {
      const value = argv[index + 1];
      const count = Number(value);
      if (!Number.isInteger(count) || count < 1) throw new Error("--commits requires a positive integer.");
      return parseFrom(index + 2, setInputMode(state, { kind: "commits", count }));
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

    if (arg === "--engine") {
      const value = argv[index + 1];
      if (!value || !isEngine(value)) throw new Error("--engine must be raw-diff or sem.");
      return parseFrom(index + 2, { ...state, engine: value });
    }

    if (arg === "--scout") {
      const value = argv[index + 1];
      if (!value || !isScoutMode(value)) throw new Error("--scout must be counter or llm.");
      return parseFrom(index + 2, { ...state, scout: value });
    }

    if (arg === "--audit-context") {
      const value = argv[index + 1];
      if (!value || !isAuditContextMode(value)) throw new Error("--audit-context must be none or repomix.");
      return parseFrom(index + 2, { ...state, auditContext: value });
    }

    if (arg === "--audit-prompt") {
      const value = argv[index + 1];
      if (!value || !isAuditPromptName(value)) throw new Error("--audit-prompt must be strict or high_bar.");
      return parseFrom(index + 2, { ...state, auditPrompt: value });
    }

    if (arg === "--max-candidates") {
      const value = argv[index + 1];
      const maxCandidates = Number(value);
      if (!Number.isInteger(maxCandidates) || maxCandidates < 1) {
        throw new Error("--max-candidates requires a positive integer.");
      }
      return parseFrom(index + 2, { ...state, maxCandidates });
    }

    if (arg === "--audit-batch-size") {
      const value = argv[index + 1];
      const auditBatchSize = Number(value);
      if (!Number.isInteger(auditBatchSize) || auditBatchSize < 1) {
        throw new Error("--audit-batch-size requires a positive integer.");
      }
      return parseFrom(index + 2, { ...state, auditBatchSize });
    }

    if (arg === "--max-audit-input-tokens") {
      const value = argv[index + 1];
      const maxAuditInputTokens = Number(value);
      if (!Number.isInteger(maxAuditInputTokens) || maxAuditInputTokens < 1) {
        throw new Error("--max-audit-input-tokens requires a positive integer.");
      }
      return parseFrom(index + 2, { ...state, maxAuditInputTokens });
    }

    if (arg === "--audit-concurrency") {
      const value = argv[index + 1];
      const auditConcurrency = Number(value);
      if (!Number.isInteger(auditConcurrency) || auditConcurrency < 1) {
        throw new Error("--audit-concurrency requires a positive integer.");
      }
      return parseFrom(index + 2, { ...state, auditConcurrency });
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  function setInputMode(state: ParseState, next: InputMode): ParseState {
    if (state.explicitInputMode) throw new Error("Choose only one input mode: --since, --stdin, --commit, or --commits.");
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

function isEngine(value: string): value is Engine {
  return value === "raw-diff" || value === "sem";
}

function isScoutMode(value: string): value is ScoutMode {
  return value === "counter" || value === "llm";
}

function isAuditContextMode(value: string): value is AuditContextMode {
  return value === "none" || value === "repomix";
}

function isAuditPromptName(value: string): value is AuditPromptName {
  return value === "strict" || value === "high_bar";
}
