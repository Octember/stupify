## Code like Colin McDonnell (@colinhacks) · parse, don't validate

Data never enters the system as an unvalidated primitive — it's parsed at the boundary and the parsed type guarantees its shape. Schemas are immutable values whose methods return new instances. Errors are discriminated unions keyed on a string `code` so every branch is exhaustive and typed. `parse` throws on failure (fail-fast); `safeParse` returns a tagged `{ success, data } | { success, error }` result for callers that need to branch. Sync and async are separate code paths that enforce their own contracts at call-time.

### `parse.ts` — `parse` throws on failure; the error class is injected, async leaks are guarded
[source](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/core/parse.ts)
```ts
export const _parse: (_Err: $ZodErrorClass) => $Parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx: schemas.ParseContextInternal = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new core.$ZodAsyncError();
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => util.finalizeIssue(iss, ctx, core.config())));
    util.captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value as core.output<typeof schema>;
};

export const parse: $Parse = /* @__PURE__*/ _parse(errors.$ZodRealError);
```
`parse` validates at the boundary and returns the typed `output<typeof schema>` — or throws (fail-fast), capturing a stack trace at the throw site. The error class is injected via `_Err`, so one implementation serves every Zod flavor without subclassing. The sync path actively guards against a Promise leaking out (`throw new $ZodAsyncError()`), so a sync call can never silently hand back an async result. (`safeParse` reuses this exact shape but returns a tagged `{ success, error }` instead of throwing.)

### `errors.ts` — every issue is a discriminated union: `code` is the discriminant, every field readonly
[source](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/core/errors.ts)
```ts
export interface $ZodIssueInvalidType<Input = unknown> extends $ZodIssueBase {
  readonly code: "invalid_type";
  readonly expected: $ZodInvalidTypeExpected;
  readonly input?: Input;
}

export interface $ZodIssueTooBig<Input = unknown> extends $ZodIssueBase {
  readonly code: "too_big";
  readonly origin: "number" | "int" | "bigint" | "date" | "string" | "array" | "set" | "file" | (string & {});
  readonly maximum: number | bigint;
  readonly inclusive?: boolean;
  readonly exact?: boolean;
  readonly input?: Input;
}

export interface $ZodIssueTooSmall<Input = unknown> extends $ZodIssueBase {
  readonly code: "too_small";
  readonly origin: "number" | "int" | "bigint" | "date" | "string" | "array" | "set" | "file" | (string & {});
  readonly minimum: number | bigint;
  /** True if the allowable range includes the minimum */
  readonly inclusive?: boolean;
  /** True if the allowed value is fixed (e.g.` z.length(5)`), not a range (`z.minLength(5)`) */
  readonly exact?: boolean;
  readonly input?: Input;
}
```
Each subtype carries exactly the fields its `code` implies — `too_big` has `maximum`/`inclusive`, `too_small` has `minimum`/`inclusive` — and every field is `readonly`. `code` is the discriminant, so a `switch (issue.code)` narrows to the concrete subtype in every branch without a cast; the closed `$ZodIssue` union (the full set of these interfaces) makes that switch exhaustive.

### `schemas.ts` — pipe aborts on first failure; the parsed value never advances past a broken stage
[source](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/core/schemas.ts)
```ts
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right) => handlePipeResult(right, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }

    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left) => handlePipeResult(left, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});

function handlePipeResult(left: ParsePayload, next: $ZodType, ctx: ParseContextInternal) {
  if (left.issues.length) {
    // prevent further checks
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues, fallback: left.fallback }, ctx);
}
```
`handlePipeResult` is the parse-don't-validate principle in one function: if the left stage produced any issues, it marks the payload `aborted` and returns immediately — the right stage never sees a partially-valid value. The forward (`in → out`) and backward (`out → in`, for codecs) paths are symmetric. Sync and async resolve to the same `handlePipeResult` helper so the abort logic lives in exactly one place.
