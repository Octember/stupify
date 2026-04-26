# stupif.ai

Local-only diagnostic tooling for checking whether AI is making developers
dumber.

Current goal: build a recent net diff, split it into small line-sized batches,
use the local model to find candidate hunks from an addition-focused view, audit
those candidate regions, and print findings.

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
The default registry currently checks duplicated schemas and unnecessary
complexity.

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
hosted LLM APIs, use Repomix, or scan the whole repo.

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

```sh
bun run typecheck:web
bun run deploy
```

`bun run deploy` builds the app and publishes the Worker configured in
`wrangler.jsonc`.
