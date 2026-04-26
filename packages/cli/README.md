# @stupify/cli

Local-only diagnostic CLI for checking whether AI is making you dumber.

This iteration proves that the CLI can diff one target commit, load the local
model, and produce one structured JSON judgment.

```sh
npx @stupify/cli --commit HEAD
```

Commit mode uses a zero-context git diff and prints timing metadata to stderr.

```sh
git diff HEAD~1..HEAD | npx @stupify/cli --stdin
```

```sh
stupify --help
```

The package is prepared for the public `@stupify` npm scope. Publishing should
run the TypeScript build first so the executable points at `dist/stupify.js`.

This iteration intentionally does not scan files directly, choose commit ranges,
build findings, compare baselines, share data, call hosted LLM APIs, or
integrate with Ollama.
