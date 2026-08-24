# Anti-slop rubric

## Confident-wrong (judge against the simplest version)

- `kind: wrong-premise` — Solves a fake problem or rests on an unproven theory. Fix: "don't do this".
- `kind: overbuilt` — Materially bigger than the problem (invented fallbacks, speculative UI, new abstractions). Fix: name what to cut.
- `kind: confident-noop` — Claims a fix but doesn't change real behavior.

## Just wrong

- `kind: bug` — Correctness bugs, off-by-one, broken null handling.
- `kind: type-lie` — Type annotation doesn't match actual return.
- `kind: dead-code` — Unreachable branches, unused declarations.
- `kind: footgun` — Swallowed errors, silent fallbacks, test-only code in prod.

## Taste / reuse

- `kind: reinvents-primitive` — Hand-rolling what a corpus primitive already does.
- `kind: slop` — Bigger/more abstract than the corpus pattern:
  - Speculative `unknown` or generic defaults.
  - Generic-parameter explosion without reuse.
  - Imperative argmax/latest accumulator loops.
  - Throwaway one-call helpers (inline them).
  - Defensive `?.` / `??` on guaranteed values.
  - Denormalized parallel constants.
  - Speculative config seams.
  - Additive churn on a cleanup.

## Weigh the fix

Right-size the remedy. Don't prescribe heavy primitives for simple scripts. If the minimal fix is a one-liner, propose that. Reusing an existing primitive is good; adding lines is bad.
