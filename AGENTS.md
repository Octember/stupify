# stupify — agent guide

**stupify** is a code reviewer that runs on Codex and judges PRs against a curated "good code" corpus + an
anti-slop rubric. Read `README.md` and `docs/ARCHITECTURE.md` first.

## Layout
- `src/cli.ts` — the `stupify` command: a `@clack/prompts` setup wizard + `run`. The only interactive surface.
- `src/review-sweep.ts` — the engine. Dependency-free Bun; shells out to `git`/`gh`/`codex`. The CLI deploys
  a copy to `~/.stupify/` and a cron runs it. Runs `main()` on import — keep it standalone; never `import` it
  from the CLI (spawn it instead).
- `.review/` — the **taste templates** (`REVIEW-PROMPT.md`, `RUBRIC.md`, `CORPUS.md`). These get copied into
  the *target* repo and edited there; in this repo they're the starting point.

## Rules
- Smallest change that solves it; deleting/simplifying beats adding layers. Treat new code as a cost.
- `bun run typecheck` must pass (strict, `noUncheckedIndexedAccess`). No `as` assertions on external JSON —
  validate at the boundary (see `isPr` in the engine).
- The engine validates every `gh --json` boundary and fails LOUD (posts an error comment) rather than silently.
  Keep that property.
- Never publish to npm or push public changes without the operator asking.
