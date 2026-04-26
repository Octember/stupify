# @stupify/cli

Local-only diagnostic CLI for checking whether AI is making you dumber.

This iteration proves that the CLI can project a target change into a temporary
worktree, serialize it with Repomix, inject a tiny check registry, send the
artifact to the local model, and print findings.

```sh
npx @stupify/cli --commit HEAD
```

Commit mode projects `<commit>^..commit` into a throwaway worktree, adds the
target commit metadata, asks Repomix to include the pending diff and code
context, and prints timing metadata to stderr.
The default registry currently checks duplicated schemas and unnecessary
complexity.

```sh
npx @stupify/cli --commits 20
```

Recent-commits mode projects the selected range as one change. Findings are
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
LLM APIs, integrate with Ollama, or run a separate search/judge pipeline.
