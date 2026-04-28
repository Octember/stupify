# @stupify/cli

Local-only diagnostic CLI for checking whether AI is making you dumber.

Stupify has one analysis path:

```text
sem diff -> counter scout -> Repomix context -> local search model
```

It emits search `matches`, not audit findings.

```sh
npx @stupify/cli --staged
npx @stupify/cli --since "2 weeks ago"
npx @stupify/cli --commit HEAD
npx @stupify/cli --commits 20
git diff HEAD~1..HEAD | npx @stupify/cli --stdin
```

Install the warn-only pre-commit hook:

```sh
stupify hook install
```

The hook runs `stupify --staged` and exits 0.

Check local setup:

```sh
stupify doctor
```

Default search enables the checks that currently pass the local hook-safety
bench: `duplicated_schema`, `unnecessary_complexity`, `over_commenting`,
`lint_bypass`, and `reinvented_utils`. Other registry patterns can be opted in
with `--checks`.

```sh
stupify --staged --checks over_commenting
```

Large search inputs are skipped rather than truncated:

```sh
stupify --staged --max-search-input-tokens 24000
```

The package is prepared for the public `@stupify` npm scope. Publishing should
run the TypeScript build first so the executable points at `dist/stupify.js`.

This iteration intentionally does not run findings audit, validators, judges,
baselines, hosted LLM APIs, GitHub integration, dashboards, or repo-wide
crawling.
