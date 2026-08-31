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

Right-size the remedy. Don't encourage over-building. Avoid prescribing heavy-handed fixes, instead note them as non-blocking unless truly needed. For example, PRs touching existing race conditions should be noted, not blocked on. Every additional line of code is a liability. Don't be overly prescriptive in your fix.

## Severity

- `high`: Will break
- `med`: Bad enough to spend another dev cycle on
- `low`: nitpick, stylistic
- `note`: FYI, commentary
- `praise`: one gif, pick one:

![](https://media.giphy.com/media/ftYpwfV6ZcerEa8poV/giphy.gif)
![](https://media.giphy.com/media/3oFzlX9khlRIev1E2Y/giphy.gif)
![](https://media.giphy.com/media/RrVzUOXldFe8M/giphy.gif)
![](https://media.giphy.com/media/a0h7sAqON67nO/giphy.gif)
![](https://media.giphy.com/media/eM0U5NQtVHu30VM5sS/giphy.gif)
![](https://i.fluffy.cc/BPgxZkmsrgmfcDFDCNWC3m4CW0gCJF7w.gif)
![](https://media.giphy.com/media/3ohzAu2U1tOafteBa0/giphy.gif)
