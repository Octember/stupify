## Code like Colin McDonnell (@colinhacks) · parse, don't validate

Data never enters the system as an unvalidated primitive — it's parsed at the boundary and the parsed type
guarantees its shape. Schemas are immutable values (methods return new instances). Errors are discriminated
unions with a `code`, so every branch is exhaustive and typed. `parse` throws (fail fast); `safeParse` returns
a typed result for callers that want to branch. Composable validators replace hand-rolled type guards.

- [`parse.ts`](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/core/parse.ts) — symmetric `parse`/`safeParse` with the sync/async boundary enforced; the error class is injected, not hardcoded.
- [`errors.ts`](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/core/errors.ts) — a discriminated-union error type, every field `readonly`, a `path[]` for nested location.
- [`schemas.ts`](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/core/schemas.ts) — distinct compile-time types per schema kind: illegal states are unrepresentable.
