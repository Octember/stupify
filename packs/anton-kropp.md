## Code like Anton Kropp (@devshorts) · DI + branded types

The Startup Architecture house style: every domain concept gets its own tiny wrapper type (a `QueueName`,
never a raw `String`), so a primitive never leaks across a boundary. Dependencies are wired through small,
single-purpose DI modules listed explicitly at one auditable composition root. Interfaces are single-method
contracts. `Clock` is injected so tests can move time. Fail fast and loud; no silent fallbacks.

- [`QueueName.java`](https://github.com/paradoxical-io/cassieq/blob/3856962f13e5f7d84893a2ef274d08016b2c828b/model/src/main/java/io/paradoxical/cassieq/model/QueueName.java) — a branded value type: a raw string can't masquerade as a `QueueName`.
- [`DefaultApplicationModules.java`](https://github.com/paradoxical-io/cassieq/blob/3856962f13e5f7d84893a2ef274d08016b2c828b/core/src/main/java/io/paradoxical/cassieq/modules/DefaultApplicationModules.java) — the composition root: one explicit list of named DI modules, no magic scanning.
- [`ClockModule.java`](https://github.com/paradoxical-io/cassieq/blob/3856962f13e5f7d84893a2ef274d08016b2c828b/core/src/main/java/io/paradoxical/cassieq/modules/ClockModule.java) — one module, one concern (binds `Clock`), trivially swapped in tests.
