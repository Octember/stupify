## Code like David Tolnay (@dtolnay) · the API that disappears

The gold standard of idiomatic Rust. Every public type earns its existence; the API surface collapses to the
minimum, and correct usage is the *only* usage. Errors carry context without leaking internals. Derive macros
vanish into your types and leave no fingerprint. Trait impls over free functions. Expose the smallest thing
that works.

- [`thiserror/lib.rs`](https://github.com/dtolnay/thiserror/blob/7214e0e8331d76afbea7173d8a14997512ac8713/src/lib.rs) — a tiny public surface that generates exactly the error impls you'd hand-write.
- [`thiserror/expand.rs`](https://github.com/dtolnay/thiserror/blob/7214e0e8331d76afbea7173d8a14997512ac8713/impl/src/expand.rs) — the macro internals: precise, readable codegen with no fingerprint left behind.
- [`anyhow/context.rs`](https://github.com/dtolnay/anyhow/blob/841522b2aa09732fecee40804440d2c35c68c480/src/context.rs) — errors with context attached, internals never leaked.
