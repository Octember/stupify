## Code like Jarred Sumner (@Jarred-Sumner) · perf as a correctness concern

Performance decided *structurally*, not by micro-tweaking later: stack-fallback allocators
before the heap, atomic counters instead of mutexes, `comptime` conditionals that delete dead paths at zero
runtime cost. Names encode invariants. The root module is a curated namespace, not a junk drawer. Fast because
the *shape* is fast — and still readable.

- [`bun.zig`](https://github.com/oven-sh/bun/blob/454e3b2884c2bfabfa424ebecc3e9a1a9ee32773/src/bun.zig) — the root namespace, deliberately curated so the fast path is the obvious one.
- [`AsyncHTTP.zig`](https://github.com/oven-sh/bun/blob/454e3b2884c2bfabfa424ebecc3e9a1a9ee32773/src/http/AsyncHTTP.zig) — concurrency built from atomics and explicit state, not locks bolted on.
