# Contributing

Thanks for helping make Stupify sharper.

Stupify is local-only diagnostic tooling for judging AI-assisted diffs. The
privacy boundary matters: do not upload or paste private source code, diffs,
commit messages, filenames, repo URLs, author names, or private package names
into issues, PRs, logs, screenshots, or external services unless the owner of
that code has explicitly approved it.

## Development Setup

Use the Bun version pinned in `package.json`.

```sh
bun install --frozen-lockfile
bun run check
```

For narrower loops:

```sh
bun run typecheck:cli
bun run test:cli
bun run smoke:cli
bun run typecheck:web
```

If dependencies are missing in a fresh checkout, run:

```sh
bun install
```

## Pull Requests

Keep PRs small enough to review carefully. A good Stupify PR:

- states the user-visible behavior or maintenance problem it solves
- keeps product copy honest about what exists today
- includes focused tests or a smoke check for non-trivial behavior
- avoids uploading private code or reproducing private diffs
- updates docs when CLI behavior, setup, release, or privacy expectations change

For CLI behavior, prefer smoke tests that exercise the built command and
observable output. For web or visual changes, verify in a browser when layout or
responsive behavior matters.

## Product Boundaries

Stupify runs local analysis. Do not imply hosted analysis, repo-wide crawling,
dashboards, sharing, baselines, GitHub integration, or upload behavior unless
the feature actually exists and introduces an explicit user-controlled upload
boundary.

Reusable behavior should live in the package that owns it. Keep app and CLI
adapters thin.

## Releases

The CLI publishes through GitHub Releases and npm Trusted Publishing. See
[docs/releasing.md](docs/releasing.md).
