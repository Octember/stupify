# @stupify/cli

Local-only diagnostic CLI for checking whether AI is making you dumber.

This iteration proves that the CLI can load diffs, inject a tiny check registry,
pack inputs to fit the model window, load the local model, and print findings.

```sh
npx @stupify/cli --commit HEAD
```

Commit mode includes the commit message, uses a zero-context git diff, and
prints timing metadata to stderr.
The default registry currently checks duplicated schemas and unnecessary
complexity.

```sh
npx @stupify/cli --commits 20
```

```sh
git diff HEAD~1..HEAD | npx @stupify/cli --stdin
```

```sh
stupify --help
```

The package is prepared for the public `@stupify` npm scope. Publishing should
run the TypeScript build first so the executable points at `dist/stupify.js`.

This iteration intentionally does not scan files directly, choose commit ranges,
compare baselines, share data, call hosted LLM APIs, or integrate with Ollama.
