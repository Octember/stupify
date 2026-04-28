# Stupify

**This project is called Stupify.**

**The domain is `stupif.ai` - read it as "stupify"; the `ai` makes a `y`
sound.**

Local-only diagnostic tooling for checking whether AI is making developers
dumber.

Current goal: turn recent local changes into compact search evidence and use a
local model to warn on concrete judgment-offload matches.

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
The default search registry enables the checks that currently pass the local
hook-safety bench: `duplicated_schema`, `unnecessary_complexity`,
`over_commenting`, `lint_bypass`, and `reinvented_utils`. Other registry
patterns remain available with `--checks`.

The only analysis path is:

```text
sem diff -> counter scout -> Repomix context -> local search model
```

Search mode emits `matches`, not audit findings. If the local search input is
too large, Stupify skips instead of reviewing truncated context.

Install the warn-only pre-commit hook:

```sh
stupify hook install
```

Check local setup:

```sh
stupify doctor
```

Analyze recent commits:

```sh
npx @stupify/cli --commits 20
```

Recent-commits mode analyzes the selected range as one change. Findings are
range-level for now, not per-commit blame.

Pipe mode:

```sh
git diff HEAD~1..HEAD | npx @stupify/cli --stdin
```

This iteration intentionally does not run findings audit, validators, judges,
baselines, upload data, call hosted LLM APIs, or scan the whole repo.

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
