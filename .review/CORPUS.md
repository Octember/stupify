# Good-code reference — YOUR curated exemplars (template)

> This is a template. **Replace it with 3–6 files from your own codebase that you'd point a new hire at** —
> the code you wish all your code looked like. The reviewer treats these as the standard and measures every
> diff against them. Taste can't be auto-extracted: hand-pick these, and say *why* each is good. A vague
> corpus produces vague reviews; a sharp one produces sharp ones.

How to write an entry:
- **Name the file** (a real path in this repo) and **one sentence on what makes it good** — the principle it
  embodies (e.g. "complexity tamed by decomposition", "type makes illegal states unrepresentable",
  "fail-fast at the boundary"). The reviewer opens the live file; the excerpt just shows the shape.
- Keep a short code excerpt that captures the pattern. The point is the *principle*, not the lines.
- Group loosely (e.g. "complex but readable", "clean service boundary") so the reviewer can cite the right one.

Pick principles you actually care about. Common ones worth encoding:
**dependency injection** (collaborators injected, never `new`d inline; config read only at a composition root),
**type-system-first invariants** (`satisfies`, discriminated unions, schemas at boundaries — illegal states
hard to represent), **fail fast and loud** (no silent fallback), **small single-responsibility units**,
**declarative over imperative**, **readable signatures** (≤3 positional params → options object).

---

## A. Complex, kept readable

### 1. `src/path/to/your-exemplar.ts` — one line on why it's good
`src/path/to/your-exemplar.ts`

Say what makes it the standard — e.g. the complexity (optimistic UI, retries, sync) is tamed by decomposition:
the orchestrator only *coordinates*; every concern is a small focused unit, and every operation is the same
shape, so N of them read like one.

```ts
// a short excerpt that shows the pattern — the shape, not the whole file
export function handle(input: Input): Result {
  const state = read()
  const ops = compute(state, input)   // pure
  return apply(ops)                   // effectful shell
}
```

### 2. `src/path/to/another.ts` — composition + named pieces
`src/path/to/another.ts`

e.g. pure composition — each piece a named small component, conditions become named type-guards, not inline
boolean soup.

```ts
function hasMeasuredWidth(width: number | undefined): width is number {
  return width !== undefined && width > 0
}
```

---

## B. Clean boundary / DI

### `src/path/to/service.ts` — injected collaborator + composition-root factory
`src/path/to/service.ts`

e.g. constructor injection — the collaborator is never `new`d inline; a small factory is the composition root;
the method parses input at the boundary, logs with structured context, and **fails loud** (catch → log → rethrow).

```ts
export function createService() {
  const scope = container.createChildContainer()
  scope.register(CLIENT, { useValue: makeClient() })
  return scope.resolve(Service)
}
```

---

> Add a "Fine — do NOT flag" set of your own here too, if there are patterns reviewers keep wrongly dinging.
