## Code like Rich Harris (@Rich-Harris) · compiler-grade precision

Library code written with a compiler author's discipline: small named classes with one responsibility,
immutable sentinel constants (`BLANK`, `EMPTY_SET`) instead of re-allocating, errors that carry a `code` and a
docs URL. No defensive fallbacks — methods throw immediately with a precise message rather than papering over a
bad state.

- [`magic-string/Chunk.js`](https://github.com/Rich-Harris/magic-string/blob/410fd4d080d8bf0b5be900c16c8ba11276fd8749/src/Chunk.js) — a focused, mutation-careful data structure.
- [`rollup/blank.ts`](https://github.com/rollup/rollup/blob/5e0066d92defee0097f10fb814e63f60b2a7b612/src/utils/blank.ts) — shared sentinel objects, named and reused instead of re-allocated.
- [`rollup/getOrCreate.ts`](https://github.com/rollup/rollup/blob/5e0066d92defee0097f10fb814e63f60b2a7b612/src/utils/getOrCreate.ts) — a one-job helper extracted and reused, not inlined everywhere.
