# @stupify/cli

Local-only diagnostic CLI for checking whether AI is making you dumber.

This iteration analyzes a recent net diff locally. The default engine uses
line-sized diff batches. The sem engine uses entity-level changes, scouts
candidate entity IDs, optionally packs selected candidate files with Repomix,
and prints findings.

```sh
npx @stupify/cli --commit HEAD
```

```sh
npx @stupify/cli --engine sem --commit HEAD
```

The sem engine splits findings-audit batches before local inference when the
prompt exceeds `--max-audit-input-tokens`. Use `--audit-concurrency` to tune
parallel local audit calls. The default sem scout uses fast deterministic
signal counters; use `--scout llm` to compare against the older local model
scout. Use `--audit-context none|repomix` and `--audit-prompt strict|high_bar`
to run audit ablations without changing code.

```sh
stupify experiment experiments/bevyl-last-week.json
stupify experiment experiments/bevyl-per-check.json
```

The experiment runner shells out to the CLI and writes local JSON plus
manual-label markdown files under `experiments/results/`.

By default, `stupify` is equivalent to `stupify --since "2 weeks ago"`.
Commit mode analyzes `<commit>^..commit` as a net diff.
The default registry currently runs nine concise checks for duplicated schemas,
unnecessary complexity, fake precision, noisy metadata, mega-files,
over-commenting, lint bypasses, inconsistent patterns, and reinvented
utilities. `operator_style_mismatch` remains available with `--checks`, but is
not enabled by default in the sem audit path.

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
LLM APIs, integrate with Ollama, or scan the whole repo.
