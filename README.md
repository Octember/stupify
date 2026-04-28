# Stupify

[![CI](https://github.com/Octember/stupif.ai/actions/workflows/ci.yml/badge.svg)](https://github.com/Octember/stupif.ai/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@stupify/cli)](https://www.npmjs.com/package/@stupify/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Website](https://stupif.ai) | [npm](https://www.npmjs.com/package/@stupify/cli) | [Releases](https://github.com/Octember/stupif.ai/releases) | [Contributing](CONTRIBUTING.md) | [Security](SECURITY.md)

Local-only diagnostic tooling for checking whether AI is making developers
dumber.

Stupify turns recent local changes into compact search evidence and uses a local
model to warn on concrete judgment-offload matches. Your code stays on your
machine.

The project is called Stupify. The domain is `stupif.ai`; read it as
"stupify", where the `ai` makes a `y` sound.

## Install

Run it without installing:

```sh
npx @stupify/cli@latest --commit HEAD
```

Or install the CLI globally:

```sh
npm install -g @stupify/cli@latest
stupify --commit HEAD
```

Full analysis also needs Git, `llama-server`, and a local GGUF model. Run
`stupify doctor` after install to check the local setup.

## Quickstart

Check your local setup:

```sh
npx @stupify/cli@latest doctor
```

Analyze one commit:

```sh
npx @stupify/cli@latest --commit HEAD
```

By default, `stupify` is equivalent to `stupify --since "2 weeks ago"`.

Analyze staged changes:

```sh
npx @stupify/cli@latest --staged
```

Pipe in a diff:

```sh
git diff HEAD~1..HEAD | npx @stupify/cli@latest --stdin
```

Install the warn-only pre-commit hook:

```sh
npx @stupify/cli@latest hook install
```

The hook runs `stupify --staged` and exits 0.

## Requirements

- Node.js 20 or newer for the published CLI.
- Git, because Stupify reads local diffs and commits.
- `llama-server` from `llama.cpp` for local inference.
- A local GGUF model. On first run, Stupify can ask before downloading the
  default model into your local cache.
- Bun 1.3.12 for repository development, tests, and release checks.

On macOS, install the local model server with:

```sh
brew install llama.cpp
npx @stupify/cli@latest doctor
```

Setup notes live in [docs/gemma4-llama-cpp.md](docs/gemma4-llama-cpp.md).

## Upgrade

```sh
npm install -g @stupify/cli@latest
```

The release channel is the latest GitHub Release and npm package. The CLI
publishes from GitHub Releases through npm Trusted Publishing. See
[docs/releasing.md](docs/releasing.md).

## What It Does

Stupify has one analysis path:

```text
sem diff -> counter scout -> Repomix context -> local search model
```

Search mode emits `matches`, not audit findings. If the local search input is
too large, Stupify skips instead of reviewing truncated context.

The default search registry enables the checks that currently pass the local
hook-safety bench: `duplicated_schema`, `unnecessary_complexity`,
`over_commenting`, `lint_bypass`, and `reinvented_utils`. Other registry
patterns remain available with `--checks`.

Analyze recent commits:

```sh
npx @stupify/cli@latest --commits 20
```

Recent-commits mode analyzes the selected range as one change. Findings are
range-level for now, not per-commit blame.

This iteration intentionally does not run findings audit, validators, judges,
baselines, upload data, call hosted LLM APIs, GitHub integration, dashboards, or
repo-wide crawling.

## Local Runtime

Stupify uses one local inference road: `llama-server`. The CLI starts it on
localhost when needed and reuses the already-loaded model on later runs.

## Development

Use the Bun version pinned in `package.json`.

```sh
bun install --frozen-lockfile
bun run check
```

Current local smoke test:

```sh
bun run smoke:cli
```

## Deployment

The web app deploys as a server-rendered React Router app on Cloudflare Workers.
The Worker routes `stupif.ai/*` and `www.stupif.ai/*` in `wrangler.jsonc`.

```sh
bun run typecheck:web
bun run deploy
```

`bun run deploy` builds the app and publishes the Worker configured in
`wrangler.jsonc`.

## Releasing

See [docs/releasing.md](docs/releasing.md).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a PR, and report security issues through [SECURITY.md](SECURITY.md).

## License

Stupify is released under the [MIT License](LICENSE).
