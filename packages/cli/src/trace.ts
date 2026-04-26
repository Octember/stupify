import { performance } from "node:perf_hooks";

export type TraceFields = Record<string, string | number | boolean | null | undefined>;

export type Tracer = {
  trace<T>(span: string, fn: () => Promise<T>, fields?: TraceFields): Promise<T>;
  traceSync<T>(span: string, fn: () => T, fields?: TraceFields): T;
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

  return {
    async trace<T>(span: string, fn: () => Promise<T>, fields?: TraceFields): Promise<T> {
      const startedAtMs = nowMs();
      try {
        return await fn();
      } finally {
        emit(span, nowMs() - startedAtMs, fields);
      }
    },

    traceSync<T>(span: string, fn: () => T, fields?: TraceFields): T {
      const startedAtMs = nowMs();
      try {
        return fn();
      } finally {
        emit(span, nowMs() - startedAtMs, fields);
      }
    },
  };
}

export const trace: Tracer = createTracer();

function envFlagEnabled(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

