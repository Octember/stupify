# Architecture

stupify is a bundled Bun review engine (`review-sweep.ts`), a dependency-free prime hook (`prime.ts`), and a CLI
(`cli.ts`) that wires them up, all driving the same three markdown files that encode taste. This doc covers how
the pieces fit, and why.

## Two halves: engine vs taste

The hard part of an AI reviewer is what it reviews against, not the loop. So the two concerns are split: the
generic engines, and the taste they read.

| | Lives in | Is |
|---|---|---|
| **Engines** | this repo (`review-sweep.ts`, `prime.ts`, `cli.ts`) plus `packages/exe-*` | generic infra that shells out to `git`/`gh`/`codex`, or just reads files |
| **Taste** | `.review/` (a repo's own, else `~/.stupify/.review`) | `REVIEW-PROMPT.md` (spec), `RUBRIC.md` (anti-slop), `CORPUS.md` (your good code) |

A `.review/` *inside the repo being reviewed* is version-controlled with the code it judges, visible in code
review, and tuned through a normal PR, the same way you'd change a lint config. When a repo has none, both
engines fall back to `~/.stupify/.review`, which the CLI assembles from [taste packs](../packs). The reviewer
reads it fresh from `origin/main` on every sweep, so a merged rubric change is live immediately.

## Two ends of the loop: prevent, then detect

The same taste drives two engines at opposite ends of the coding loop:

- **`prime.ts` (prevention).** A Claude Code `SessionStart` hook (wired by `stupify prime --install`) runs
  `bun ~/.stupify/prime.ts` at the start of every session. It resolves the taste (repo `.review/` wins, else
  home), inlines the rubric + corpus index, and emits a `{hookSpecificOutput:{additionalContext}}` payload so
  the agent holds your standard *before* it writes a line. Pure file read: no model, no network, ~30ms. It
  **never throws**: any miss or error emits nothing and exits 0, because a hook must not break session start.
  stdout is *only* the JSON payload (a stray byte makes Claude Code drop it).
- **`review-sweep.ts` (detection).** The cron reviewer below catches whatever drifted, against the same taste.

Encode taste once, enforce it at both ends. The best review is the one you didn't need.

## The sweep loop

A cron job runs the sweep every minute (`*/1 * * * *`); the sweep self-locks so two never overlap. Each run:

1. **Refresh** a dedicated checkout (`$STUPIFY_HOME/repo`) to `origin/<DEFAULT_BRANCH>` (default `main`) via
   `fetch && checkout && reset --hard`.
   This checkout is *hard-pinned* and never a working tree you care about, because we destructively reset it.
2. **List** open PRs via `gh pr list --json`. In `SCOPE=auto` (the default) it keeps all non-draft PRs under
   `DIFF_LINE_CAP`, with `REVIEW_LABEL` as a force-include override for oversized ones; `SCOPE=label` flips to
   opt-in (only labelled PRs). Bot and draft authors are skipped in *either* scope (`gh`'s `is_bot` flag). The
   JSON is fully validated at the boundary (`isPr`), so a malformed shape skips cleanly instead of throwing mid-loop.
3. **Dedup.** For each candidate it reads the PR's comments and skips if one already contains the hidden marker
   `<!-- stupify:<headSHA> -->` for the *current* head. A new push moves the SHA, the marker no longer matches, and
   it re-reviews. **One review per head.** (Failures aren't posted, see *Safety*, so there's no fail marker;
   failed heads are throttled in local state instead.) The marker check falls back to "any comment" when
   `gh api user` is unavailable (a GitHub-App integration 403s on it), so dedup never silently re-reviews forever.
4. **Build memory** from the remaining comments (see below).
5. **Review.** The *runner* fetches the diff (`gh pr diff`) and feeds it to `codex exec` over **stdin**, in a
   `workspace-write` sandbox restricted to `/tmp` with **network off and no `gh`**. Codex reads the rubric +
   corpus + the inlined diff and writes the review to a temp file ending in the marker; the *runner*, not Codex,
   posts it with `gh pr comment`.
6. **Cap.** `MAX_PRS` limits PRs *actually reviewed* per sweep, counted only after the cheap dedup skips, so a
   backlog of already-reviewed PRs at the front of the list can't starve later ones.

## Per-PR memory (and why it replaced debounce)

The first version had a 5-minute **debounce**: a push started a clock, and a PR was only reviewed once its head
had been stable for 5 minutes, so a burst of commits collapsed into one review instead of one per commit.

It worked, but it made the reviewer feel *dead*: you'd push and wait. And it was solving the wrong problem. The
real fix for "don't spam me" is **memory**, not delay:

- Before each review, the engine collects the PR's existing comments, drops CI bots, strips the hidden markers,
  and passes the recent thread (bounded to the last 20) into the prompt as *"your past reviews and the author's
  replies."*
- The prompt's **"Prior reviews on this PR"** rules tell the model: don't re-raise resolved or
  reasoned-declined items, and report only what's genuinely new. When there's no new finding it emits one of two
  tokens: `STUPIFY_FIXED` if the issues it raised earlier are now resolved by the diff (the runner posts a
  one-time **"nice, all fixed ✅"**, gated on there having actually been open findings, so it can't repeat or fire
  on a never-flagged PR), or `STUPIFY_NO_NEW_ISSUES` otherwise (clean, or prior items still open). On that second
  token the runner posts a one-time **`LGTM ✅`** if it's a clean PR stupify has never flagged (so "reviewed and
  good" is visible, not indistinguishable from "not run yet"), and stays silent on every other clean head. Every
  ✅ it posts is honest: a first-pass LGTM has no open findings to belie it, and "all fixed" means actually fixed.

The GitHub thread **is** the memory store. It survives restarts, and it already contains the author's replies
(a separate state file wouldn't). With memory, a mid-burst re-review *sees its prior reviews and converges*
instead of repeating, which is what debounce was really for. So debounce became pure latency and was deleted.
A push now gets reviewed within ~60s, and the Nth review of a PR is short because it only covers the delta.

The root cause was statelessness: it made the reviewer both re-litigate forever and never know when to stop.
Feed the conversation back in and both problems go away.

## Safety & failure handling

- **Failures stay off the PR.** If `codex` can't run (provider down, usage limit, timeout, ENOENT), the sweep
  LOGS the captured cause (operator-facing) and records the failed head in local state so it doesn't re-hammer
  the dead provider every minute. It does *not* post a "couldn't review" comment, because that's noise the PR
  author can't act on. **Only real reviews ever reach the PR.** `spawnSync`'s `signal`/`error` are folded into
  the captured output so a timeout surfaces as "killed by SIGTERM", not "no output".
- **Config fails toward safe.** Knobs validate and warn on garbage (`MAX_PRS=15lol` → logged, default used).
  `DRY_RUN` is the exception that fails *safe*: a set-but-invalid value (`DRY_RUN=ture`) falls back to preview,
  never live. A typo'd safety switch must not start posting.
- **Bounded spend.** `SCOPE=label` (opt-in) + `MAX_PRS` (per sweep) + `MAX_REVIEWS_PER_DAY` (the daily ceiling) +
  per-head dedup cap what gets reviewed; a usage/rate-limit ends the sweep early instead of failing every
  remaining PR; `DRY_RUN` lets you see what *would* be reviewed before spending a token.
- **Single-flight.** The sweep takes its own `state/sweep.lock` (O_EXCL create; a lock older than 30 min is
  treated as stale from a crash and stolen), with no `flock` dependency, so it runs anywhere `bun` does.

## Codex specifics

The engine calls, in full. The prompt (rubric + corpus + the **inlined diff**) arrives on **stdin**, not argv, so
a big diff can't blow `ARG_MAX`:

```
gh pr diff <N> --repo <slug>                              # the RUNNER fetches the diff
codex exec --cd <STUPIFY_HOME>/repo --sandbox workspace-write \
  -c model_reasoning_effort=<CODEX_EFFORT> \
  -c sandbox_workspace_write.network_access=false \
  -c 'sandbox_workspace_write.writable_roots=["/tmp"]' \
  -                                                        # prompt (diff inlined) on stdin
gh pr comment <N> --repo <slug> --body-file <review>      # the RUNNER posts
```

Codex runs **locked down**: no network and no `gh` of its own. The runner does all GitHub I/O and hands Codex the
diff in the prompt. The PR diff and the prior-review thread are *attacker-controlled* (any contributor can push
code or comment), so this matters: a prompt-injected diff or comment can at worst make Codex write a junk *review
file*; it can't exfiltrate, reach the network, or touch the GitHub token. (`--cd` points it at the dedicated
checkout for read-only context; only `/tmp` is writable.) It does *not* pin a provider or model by default;
Codex uses whatever auth you've configured. `CODEX_PROVIDER` (`-c model_provider=…`) and `CODEX_MODEL`
(`-c model=…`) let you point it at a specific gateway or model. There's no API key in stupify itself;
credentials are Codex's concern.

## Why curated, not inferred

An earlier experiment auto-extracted a "good code" corpus from the repo. It reliably praised the exact slop it
was supposed to cut, because taste is a judgment, not a statistic. So the corpus is hand-picked, and the
reviewer is explicitly a **finder, not a judge**: it surfaces candidates and cites the corpus, but which
findings matter stays a human call. Five minutes curating `CORPUS.md` is the highest-leverage input you give it.
