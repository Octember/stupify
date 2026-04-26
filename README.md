# stupif.ai

Local-only diagnostic tooling for checking whether AI is making developers
dumber.

Current goal: load diffs, inject the enabled check registry, pack inputs to fit
the model window, run the local model, and print findings.

## CLI

Current local smoke test:

```sh
bun run smoke:cli
```

Try a diff:

```sh
npx @stupify/cli --commit HEAD
```

Commit mode includes the commit message, uses a zero-context git diff, and
prints timing metadata to stderr.
The default registry currently checks duplicated schemas and unnecessary
complexity.

Analyze recent commits:

```sh
npx @stupify/cli --commits 20
```

Small commits are packed together. Oversized commits are split into parts.

Lower-level pipe mode still exists:

```sh
git diff HEAD~1..HEAD | npx @stupify/cli --stdin
```

This iteration intentionally does not scan files directly, choose commit ranges,
compare baselines, upload data, or call hosted LLM APIs.

## Product framing

Stupify asks whether a diff shows signs that AI may be replacing engineering
judgment instead of augmenting it.

Your code stays on your machine.
