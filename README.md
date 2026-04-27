# Stupify

**This project is called Stupify.**

**The domain is `stupif.ai` - read it as "stupify"; the `ai` makes a `y`
sound.**

Local-only diagnostic tooling for checking whether AI is making developers
dumber.

Current goal: turn recent local changes into compact review evidence, use the
local model to scout candidates, audit those candidates, and print findings.

## CLI

Current local smoke test:

```sh
bun run smoke:cli
```

Try a diff:

```sh
npx @stupify/cli --commit HEAD
```

By default, `stupify` is equivalent to `stupify --since "2 weeks ago"`.
Commit mode analyzes `<commit>^..commit` as a net diff.
The default registry currently runs nine concise checks for duplicated schemas,
unnecessary complexity, fake precision, noisy metadata, mega-files,
over-commenting, lint bypasses, inconsistent patterns, and reinvented
utilities. `operator_style_mismatch` remains available with `--checks`, but is
not enabled by default because it is noisy in the sem audit path.

Try semantic ingestion:

```sh
npx @stupify/cli --engine sem --commit HEAD
```

The sem engine uses `sem diff` for entity-level changes, scouts candidate
entity IDs, packs selected candidate files locally with Repomix, then audits the
packed context. Findings-audit batches are split before local inference when
the prompt exceeds the configured input-token cap, and audit model calls run
with bounded local concurrency. Use `--scout counter` to replace the LLM scout
with fast deterministic signal counters. Use `--scout llm` to compare against
the older local model scout. Use `--audit-context none` to audit
only sem entity deltas, or `--audit-prompt high_bar` to run the stricter audit
framing.

Run the local Bevyl ablation matrix:

```sh
BEVYL_REPO=/path/to/bevyl-app bun run experiment:bevyl
BEVYL_REPO=/path/to/bevyl-app bun run experiment:bevyl:checks
```

The experiment runner shells out to the existing CLI, writes JSON and
manual-label markdown files under `experiments/results/`, and keeps all source
context local.

Analyze recent commits:

```sh
npx @stupify/cli --commits 20
```

Recent-commits mode analyzes the selected range as one change. Findings are
range-level for now, not per-commit blame.

Lower-level pipe mode still exists:

```sh
git diff HEAD~1..HEAD | npx @stupify/cli --stdin
```

This iteration intentionally does not compare baselines, upload data, call
hosted LLM APIs, or scan the whole repo.

## Local Runtime

Stupify uses one local inference road: `llama-server`.
The CLI starts it on localhost when needed and reuses the already-loaded model
on later runs. Setup notes live in
[docs/gemma4-llama-cpp.md](docs/gemma4-llama-cpp.md).

## Product framing

Stupify asks whether a diff shows signs that AI may be replacing engineering
judgment instead of augmenting it.

Your code stays on your machine.

## Deployment

The web app deploys as a server-rendered React Router app on Cloudflare Workers.
The Worker routes `stupif.ai/*` and `www.stupif.ai/*` in `wrangler.jsonc`.

```sh
bun run typecheck:web
bun run deploy
```

`bun run deploy` builds the app and publishes the Worker configured in
`wrangler.jsonc`.
