# Good-code reference — taste packs

Judge every diff against the standards below. When you flag slop, name the principle (or the linked file) the change should have followed. The links are commit-pinned exemplars — open them when you need detail.

---

## Code like Sindre Sorhus (@sindresorhus) · one file, one job

Radical minimalism: each module does exactly one thing and is small enough to read in five minutes. A function
where a class would do; no surprise dependencies; inputs validated eagerly at the top so failures are loud and
early. Tiny public surface, deep comments on the *why*. If it can't be read top-to-bottom in one sitting, it's
too big.

- [`p-limit/index.js`](https://github.com/sindresorhus/p-limit/blob/42599ebbbb1228a5bdab381fcf8f4ac20eb8d551/index.js) — a whole concurrency limiter in one short, obvious file.
- [`execa/options.js`](https://github.com/sindresorhus/execa/blob/f3a2e8481a1e9138de3895827895c834078b9456/lib/arguments/options.js) — careful, explicit input normalization before anything runs.
- [`chalk/index.js`](https://github.com/sindresorhus/chalk/blob/aa06bb5ac3f14df9fda8cfb54274dfc165ddfdef/source/index.js) — a clean, composable API with a minimal surface.


---

## Code like Anton Kropp (@devshorts) · DI + branded types

The Startup Architecture house style: every domain concept gets its own tiny wrapper type (a `QueueName`,
never a raw `String`), so a primitive never leaks across a boundary. Dependencies are wired through small,
single-purpose DI modules listed explicitly at one auditable composition root. Interfaces are single-method
contracts. `Clock` is injected so tests can move time. Fail fast and loud; no silent fallbacks.

- [`QueueName.java`](https://github.com/paradoxical-io/cassieq/blob/3856962f13e5f7d84893a2ef274d08016b2c828b/model/src/main/java/io/paradoxical/cassieq/model/QueueName.java) — a branded value type: a raw string can't masquerade as a `QueueName`.
- [`DefaultApplicationModules.java`](https://github.com/paradoxical-io/cassieq/blob/3856962f13e5f7d84893a2ef274d08016b2c828b/core/src/main/java/io/paradoxical/cassieq/modules/DefaultApplicationModules.java) — the composition root: one explicit list of named DI modules, no magic scanning.
- [`ClockModule.java`](https://github.com/paradoxical-io/cassieq/blob/3856962f13e5f7d84893a2ef274d08016b2c828b/core/src/main/java/io/paradoxical/cassieq/modules/ClockModule.java) — one module, one concern (binds `Clock`), trivially swapped in tests.


---

## Code like Colin McDonnell (@colinhacks) · parse, don't validate

Data never enters the system as an unvalidated primitive — it's parsed at the boundary and the parsed type
guarantees its shape. Schemas are immutable values (methods return new instances). Errors are discriminated
unions with a `code`, so every branch is exhaustive and typed. `parse` throws (fail fast); `safeParse` returns
a typed result for callers that want to branch. Composable validators replace hand-rolled type guards.

- [`parse.ts`](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/core/parse.ts) — symmetric `parse`/`safeParse` with the sync/async boundary enforced; the error class is injected, not hardcoded.
- [`errors.ts`](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/core/errors.ts) — a discriminated-union error type, every field `readonly`, a `path[]` for nested location.
- [`schemas.ts`](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/core/schemas.ts) — distinct compile-time types per schema kind: illegal states are unrepresentable.
