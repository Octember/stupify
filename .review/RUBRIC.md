# Anti-slop rubric — the single source of truth for taste

This is what the reviewer judges against, alongside `CORPUS.md`. Edit it to match your team. A reviewer
catches two kinds of problem. Tag every finding with its `kind`.

## Just wrong — flag regardless of the corpus
- `kind: bug` — correctness bugs; off-by-one; broken null/empty handling; wrong condition.
- `kind: type-lie` — a type/annotation that does not match what the code actually returns
  (e.g. annotated `T | null` but every path returns a non-null value cast to `T`).
- `kind: dead-code` — unreachable or dead branches; a declared-and-unused const/import/function.
- `kind: footgun` — swallowed errors / catch-and-continue with no owned degraded state; silent fallbacks;
  test-only special-casing (`NODE_ENV === 'test'`, env-name string checks) leaking into production code.

## Taste / reuse — relative to the corpus and the simpler way
- `kind: reinvents-primitive` — a NEW abstraction/layer/wrapper/facade/shim/fallback-reader when a corpus
  primitive already does it (name the primitive). Or hand-rolling what a corpus file does.
- `kind: slop` — bigger / more abstract / more speculative than the corpus pattern for the same job:
  - speculative `unknown` in hand-authored types; `TResult = unknown` generic defaults;
    `z.unknown()` / `z.array(z.unknown())`
  - generic-parameter explosion on a call site that is not actually reused generically
  - `let best*/latest*` imperative argmax/latest accumulator loops
  - throwaway one-call helpers, or wrapper functions that add no value — a pure pass-through to another fn
    with the same signature; inline it / call the inner directly
  - a defensive `?.` / `??` fallback on a value the type or schema already guarantees — e.g. `x?.foo ?? x.y.foo`
    when `x` is required (or should be). Drop the optional chain and the fallback (it's `x.foo`); if `x` is
    wrongly optional, fix the schema/type, don't paper over it at the call site
  - denormalized parallel constants or hardcoded membership lists (derive a Set/Record from ONE `as const` array)
  - speculative config seams / unused `mode` switches / injectable-override defaults nothing needs yet
  - additive churn on a cleanup; code that "looks productive" over the minimal change

## Fine — do NOT flag
- `unknown` at a real parse boundary fed into a normalizer; `Record<string, unknown>` context bags
- Set/Map-building or dedupe loops (not argmax accumulators)
- a single choke-point helper its owner reuses

## Weigh the fix against the owner
Right-size the remedy to the code that owns it. Don't prescribe a heavier primitive than the context warrants:
a one-off script shouldn't grow a schema library, glue code shouldn't sprout an interface, a guaranteed-shape
boundary doesn't need the validation an untrusted one does, and an unattended job usually wants a loud default
over a hard exit. Demanding more rigor than the owner needs is its own slop. If the minimal fix is a one-liner,
the fix is the one-liner — propose that, not an architecture.

## Output per finding
`path:line` — [kind] — what's wrong and why — **fix:** the corpus primitive to reuse OR (for a bug) the
correct approach — severity(high|med|low) · confidence(0–1). Sort worst-first. Report everything incl.
low-confidence — do not self-filter; a downstream ranker (and your own memory) handles that.
