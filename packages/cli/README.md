# @stupify/cli

Local-only diagnostic CLI for checking whether AI is making you dumber.

This iteration analyzes a recent net diff locally. The default engine uses
line-sized diff batches. The sem engine uses entity-level changes, scouts
candidate entity IDs, fetches budgeted sem context for those candidates, and
prints findings.

```sh
npx @stupify/cli --commit HEAD
```

```sh
npx @stupify/cli --engine sem --commit HEAD
```

By default, `stupify` is equivalent to `stupify --since "2 weeks ago"`.
Commit mode analyzes `<commit>^..commit` as a net diff.
The default registry currently checks duplicated schemas and unnecessary
complexity.

```sh
npx @stupify/cli --commits 20
```

Recent-commits mode analyzes the selected range as one change. Findings are
range-level for now, not per-commit blame.

```sh
git diff HEAD~1..HEAD | npx @stupify/cli --stdin
```

```sh
stupify --help
```

The package is prepared for the public `@stupify` npm scope. Publishing should
run the TypeScript build first so the executable points at `dist/stupify.js`.

This iteration intentionally does not compare baselines, share data, call hosted
LLM APIs, integrate with Ollama, use Repomix, or scan the whole repo.
