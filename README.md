# stupif.ai

Local-only diagnostic tooling for checking whether AI is making developers
dumber.

Current goal: point `npx @stupify/cli` at one commit, run the local model, and
get one structured JSON judgment for that commit diff.

## CLI

Current local smoke test:

```sh
bun run smoke:cli
```

Try a diff:

```sh
npx @stupify/cli --commit HEAD
```

Commit mode uses a zero-context git diff and prints timing metadata to stderr.

Lower-level pipe mode still exists:

```sh
git diff HEAD~1..HEAD | npx @stupify/cli --stdin
```

This iteration intentionally does not scan files directly, choose commit ranges,
build findings, compare baselines, upload data, or call hosted LLM APIs.

## Product framing

Stupify asks whether a diff shows signs that AI may be replacing engineering
judgment instead of augmenting it.

Your code stays on your machine.
