# stupif.ai

Local-only diagnostic tooling for checking whether AI is making developers
dumber.

Current goal: project a target change into a temporary worktree, serialize it
with Repomix, inject the enabled check registry, send the artifact to the local
model, and print findings.

## CLI

Current local smoke test:

```sh
bun run smoke:cli
```

Try a diff:

```sh
npx @stupify/cli --commit HEAD
```

Commit mode projects `<commit>^..commit` into a throwaway worktree, adds the
target commit metadata, asks Repomix to include the pending diff and code
context, and prints timing metadata to stderr.
The default registry currently checks duplicated schemas, unnecessary
complexity, fake precision windowing, coauthored slop, mega files,
over-commenting, lint bypasses, inconsistent patterns, reinvented utils, and
operator style mismatches.

Analyze recent commits:

```sh
npx @stupify/cli --commits 20
```

Recent-commits mode projects the selected range as one change. Findings are
range-level for now, not per-commit blame.

Lower-level pipe mode still exists:

```sh
git diff HEAD~1..HEAD | npx @stupify/cli --stdin
```

This iteration intentionally does not compare baselines, upload data, call
hosted LLM APIs, or run a separate search/judge pipeline.

## Experimental Runtimes

Gemma 4 currently needs a newer external `llama.cpp` binary because the embedded
`node-llama-cpp` runtime does not recognize the `gemma4` GGUF architecture yet.
Setup notes live in [docs/gemma4-llama-cpp.md](docs/gemma4-llama-cpp.md).

## Product framing

Stupify asks whether a diff shows signs that AI may be replacing engineering
judgment instead of augmenting it.

Your code stays on your machine.
