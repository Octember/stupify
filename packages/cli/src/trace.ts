import { performance } from "node:perf_hooks";

export type TraceFields = Record<string, string | number | boolean | null | undefined>;

export type Tracer = {
  trace<T>(span: string, fn: () => Promise<T>, fields?: TraceFields): Promise<{ value: T; ms: number }>;
  trace<T>(span: string, fn: () => T, fields?: TraceFields): { value: T; ms: number };
};

export type CreateTracerOptions = {
  enabled?: boolean;
  writeLine?: (line: string) => void;
};

export function createTracer(options?: CreateTracerOptions): Tracer {
  const enabled = options?.enabled ?? envFlagEnabled("STUPIF_TRACE");
  const writeLine = options?.writeLine ?? ((line) => process.stderr.write(line + "\n"));
  const nowMs = () => performance.now();

  function emit(span: string, durationMs: number, fields?: TraceFields) {
    if (!enabled) return;
    const payload: Record<string, unknown> = { span, ms: Math.round(durationMs) };
    for (const [k, v] of Object.entries(fields ?? {})) {
      if (v !== undefined) payload[k] = v;
    }
    writeLine(`trace ${JSON.stringify(payload)}`);
  }

  function trace<T>(
    span: string,
    fn: () => Promise<T>,
    fields?: TraceFields,
  ): Promise<{ value: T; ms: number }>;
  function trace<T>(span: string, fn: () => T, fields?: TraceFields): { value: T; ms: number };
  function trace<T>(
    span: string,
    fn: (() => T) | (() => Promise<T>),
    fields?: TraceFields,
  ): Promise<{ value: T; ms: number }> | { value: T; ms: number } {
    const startedAtMs = nowMs();
    try {
      const out = fn();
      if (isPromiseLike(out)) {
        return (async () => {
          let durationMs: number | undefined;
          try {
            const value = await out;
            durationMs = nowMs() - startedAtMs;
            return { value, ms: Math.round(durationMs) };
          } finally {
            durationMs ??= nowMs() - startedAtMs;
            emit(span, durationMs, fields);
          }
        })();
      }

      const durationMs = nowMs() - startedAtMs;
      emit(span, durationMs, fields);
      return { value: out, ms: Math.round(durationMs) };
    } catch (error) {
      const durationMs = nowMs() - startedAtMs;
      emit(span, durationMs, fields);
      throw error;
    }
  }

  return { trace };
}

export const trace: Tracer = createTracer();

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value;
}

function envFlagEnabled(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

