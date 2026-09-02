# stupify — agent guide

**stupify** is a code reviewer that runs on Codex and judges PRs against a curated "good code" corpus + an
anti-slop rubric. Read `README.md` and `docs/ARCHITECTURE.md` first.

## Layout

- `src/cli.ts` — the `stupify` command: a `@clack/prompts` setup wizard + `run`. The only interactive surface.
- `src/review-sweep.ts` — the engine. Bun; shells out to `git`/`gh`; Codex via `@openai/codex-sdk`. The CLI
  deploys a copy to `~/.stupify/` and a cron runs it. Spawn it from the CLI, never `import` it.
- `.review/` — the **taste templates** (`REVIEW-PROMPT.md`, `RUBRIC.md`, `CORPUS.md`). These get copied into
  the _target_ repo and edited there; in this repo they're the starting point.

## Rules

- Smallest change that solves it; deleting/simplifying beats adding layers. Treat new code as a cost.
- `bun run typecheck` must pass (strict, `noUncheckedIndexedAccess`). No `as` assertions on external JSON —
  `Schema.parse(JSON.parse(...))` at the boundary. Malformed `gh --json` throws; don't skip the row.
- The engine validates every `gh --json` boundary and fails LOUD (log + throttle, never a fake review comment).
- Never publish to npm or push public changes without the operator asking.
