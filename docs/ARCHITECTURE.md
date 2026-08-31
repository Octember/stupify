# Architecture

stupify is a bundled Bun review engine (`review-sweep.ts`), a dependency-free prime hook (`prime.ts`), and a CLI
(`cli.ts`) that wires them up, all driving the same three markdown files that encode taste. This doc covers how
the pieces fit, and why.

## Two halves: engine vs taste

The hard part of an AI reviewer is what it reviews against, not the loop. So the two concerns are split: the
generic engines, and the taste they read.

|             | Lives in                                                                  | Is                                                                               |
| ----------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Engines** | this repo (`review-sweep.ts`, `prime.ts`, `cli.ts`) plus `packages/exe-*` | generic infra that shells out to `git`/`gh`/`codex`, or just reads files         |
| **Taste**   | `.review/` (a repo's own, else `~/.stupify/.review`)                      | `REVIEW-PROMPT.md` (spec), `RUBRIC.md` (anti-slop), `CORPUS.md` (your good code) |

A `.review/` _inside the repo being reviewed_ is version-controlled with the code it judges, visible in code
review, and tuned through a normal PR, the same way you'd change a lint config. When a repo has none, both
engines fall back to `~/.stupify/.review`, which the CLI assembles from [taste packs](../packs). The reviewer
reads it fresh from `origin/main` on every sweep, so a merged rubric change is live immediately.

## Two ends of the loop: prevent, then detect

The same taste drives two engines at opposite ends of the coding loop:

- **`prime.ts` (prevention).** A Claude Code `SessionStart` hook (wired by `stupify prime --install`) runs
  `bun ~/.stupify/prime.ts` at the start of every session. It resolves the taste (repo `.review/` wins, else
  home), inlines the rubric + corpus index, and emits a `{hookSpecificOutput:{additionalContext}}` payload so
  the agent holds your standard _before_ it writes a line. Pure file read: no model, no network, ~30ms. It
  **never throws**: any miss or error emits nothing and exits 0, because a hook must not break session start.
  stdout is _only_ the JSON payload (a stray byte makes Claude Code drop it).
- **`review-sweep.ts` (detection).** The cron reviewer below catches whatever drifted, against the same taste.

Encode taste once, enforce it at both ends. The best review is the one you didn't need.

## The sweep loop

A cron job runs the sweep every minute (`*/1 * * * *`); the sweep self-locks so two never overlap. Each run:

1. **Refresh** a dedicated checkout (`$STUPIFY_HOME/repo`) to `origin/<DEFAULT_BRANCH>` (default `main`) via
   `fetch && checkout && reset --hard`.
   This checkout is _hard-pinned_ and never a working tree you care about, because we destructively reset it.
2. **List** open PRs via `gh pr list --json` (with an explicit high `--limit` — gh's default of 30, newest-first,
   silently drops older PRs off the sweep's radar on a busy repo). In `SCOPE=auto` (the default) it keeps all
   non-draft PRs under `DIFF_LINE_CAP`, with `REVIEW_LABEL` as a force-include override for oversized ones;
   `SCOPE=label` flips to opt-in (only labelled PRs). Bot and draft authors are skipped in _either_ scope (`gh`'s
   `is_bot` flag) — unless the PR carries `REVIEW_LABEL`, which force-includes a bot-authored PR you deliberately
   opted in. The JSON is `Pr.parse`'d at the boundary — a malformed list or entry throws rather than
   skipping mid-loop.
3. **Dedup.** Skip if a review body already has `<!-- stupify:<headSHA> -->`, or local `reviewed-heads.json`
   already recorded this head (covers silent no-ops). Failures never post; they're throttled in local state.
4. **Build memory** from GraphQL reviews + inline threads (see below).
5. **Review.** The runner fetches the diff via GitHub's compare API (`baseRefOid...headRefOid`), spins a
   worktree at the head SHA, and runs Codex via `@openai/codex-sdk`: `startThread` then two `thread.run`s.
   The first prompt is three taste file paths + PR body + prior thread + diff. The second is the locked
   hand-written adversarial line (`src/hand-written-prompts.ts`) with `outputSchema`. The runner posts or
   converges from that JSON. Up to `CODEX_JOBS` (default 3) run at once. A quota wall stops new launches.
6. **Cap.** `MAX_PRS` limits PRs _actually reviewed_ per sweep, counted only after the cheap dedup skips, so a
   backlog of already-reviewed PRs at the front of the list can't starve later ones.

Along the way the sweep writes `state/status.json`, a best-effort workflow snapshot of the current stage and each
PR's disposition (queued, reviewing, posted, clean, skipped, deferred, failed, or dry-run). `stupify status` reads
that file and renders the latest sweep without touching GitHub or posting anything to PRs.

Live sweeps also post a best-effort commit status on the PR head SHA (`stupify/review` by default). It is
append-only on GitHub's side, so stupify keeps `state/commit-statuses.json` as a tiny dedupe cache and only posts
when the state/description changes. Status posting is never required for review progress: if the API call fails,
the sweep logs it and keeps reviewing/commenting. `DRY_RUN` never posts GitHub statuses.

## Per-PR memory

The GitHub thread is the store. Before each review the engine dumps the recent thread (last 20, defanged)
into the prompt. Codex returns `findings` | `fixed` | `no_new_issues`. The runner:

- posts inline threads on `findings`
- resolves its open blocking threads + `nice, all fixed ✅` on `fixed` (only if threads were actually open)
- `LGTM ✅` on a first-pass clean, `still ✅` on a later clean head, silence while its own findings remain open

Head marker `<!-- stupify:<sha> -->` is how a later sweep knows this commit was already reviewed.

## Safety & failure handling

- **Failures stay off the PR.** If `codex` can't run (provider down, usage limit, timeout, ENOENT), the sweep
  LOGS the captured cause (operator-facing) and records the failed head in local state so it doesn't re-hammer
  the dead provider every minute. It does _not_ post a "couldn't review" comment, because that's noise the PR
  author can't act on. **Only real reviews ever reach the PR.** SDK timeouts land in the catch as the abort reason.
- **Config fails toward safe.** Knobs validate and warn on garbage (`MAX_PRS=15lol` → logged, default used).
  `DRY_RUN` is the exception that fails _safe_: a set-but-invalid value (`DRY_RUN=ture`) falls back to preview,
  never live. A typo'd safety switch must not start posting.
- **Bounded spend.** `SCOPE=label` (opt-in) + `MAX_PRS` (per sweep) + `MAX_REVIEWS_PER_DAY` (the daily ceiling) +
  per-head dedup cap what gets reviewed; a usage/rate-limit ends the sweep early instead of failing every
  remaining PR; `DRY_RUN` lets you see what _would_ be reviewed before spending a token.
- **Single-flight.** The sweep takes its own `state/sweep.lock` (O_EXCL create; a lock older than 30 min is
  treated as stale from a crash and stolen), with no `flock` dependency, so it runs anywhere `bun` does.

## Codex specifics

The runner does all GitHub I/O. Codex sees taste paths, the diff, and the prior thread. Config is local
`~/.codex`. `CODEX_GATEWAY_POOL` still rotates the gateway hostname in `config.toml` after a real rate-limit
(cooldown `CODEX_ROTATE_COOLDOWN_MIN`, default 10). Unset = off.

## Why curated, not inferred

An earlier experiment auto-extracted a "good code" corpus from the repo. It reliably praised the exact slop it
was supposed to cut, because taste is a judgment, not a statistic. So the corpus is hand-picked, and the
reviewer is explicitly a **finder, not a judge**: it surfaces candidates and cites the corpus, but which
findings matter stays a human call. Five minutes curating `CORPUS.md` is the highest-leverage input you give it.
