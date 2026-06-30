# Anti-slop rubric — what counts as slop (the taste, alongside `CORPUS.md`)

Edit it to match your team. Findings fall into three categories — and the first is the one the checks miss.

## Confident-wrong — the whole change, judged against the simplest version (NO corpus citation needed)
The slop that passes every check: it compiles, it's tidy, it reads confidently — and it's still the wrong
change. Flag these on the CHANGE AS A WHOLE, on confidence, even when no single line is locally "wrong" and you
can't cite a corpus primitive. Judge against the bar: the smallest change that solves the REAL problem.
- `kind: wrong-premise` — solves a problem that isn't real, or rests on an unproven theory; the premise behind
  the diff doesn't hold. The fix is "don't do this / prove the premise first," not a code tweak.
- `kind: overbuilt` — materially bigger than the problem: an invented fallback / retry / polling path,
  speculative UI, a new layer or abstraction, or special-case proliferation where one default suffices. The fix
  is the smaller version — name what to cut.
- `kind: confident-noop` — confidently claims a fix but doesn't change the real behavior (a no-op, or a change
  at the wrong layer). Verify the actual effect against the checkout.

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
