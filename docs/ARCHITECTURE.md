# Architecture

stupify is a single ~450-line dependency-free Bun script (`review-sweep.ts`) plus three markdown files
that encode taste. This doc covers how the pieces fit and *why* — the design decisions are the interesting part.

## Two halves: engine vs taste

The hardest part of an AI reviewer isn't the loop — it's *what it reviews against*. So the two concerns are
split across two locations:

| | Lives in | Is |
|---|---|---|
| **Engine** | this repo (`review-sweep.ts`, `install.sh`) | generic infra — shells out to `git`/`gh`/`codex` |
| **Taste** | a `.review/` dir **in the target repo** | `REVIEW-PROMPT.md` (spec), `RUBRIC.md` (anti-slop), `CORPUS.md` (your good code) |

Putting the taste *inside the repo being reviewed* means it's version-controlled with the code it judges, it's
visible in code review, and you tune it through a normal PR — the same way you'd change a lint config. The
engine reads it fresh from `origin/main` on every sweep, so a merged change to the rubric is live immediately.

## The sweep loop

A cron job runs the sweep every `REVIEW_INTERVAL_MIN` minutes (default 1), wrapped in `flock -n` so two never
overlap. Each run:

1. **Refresh** a dedicated checkout (`$STUPIFY_HOME/repo`) to `origin/<DEFAULT_BRANCH>` (default `main`) —
   `fetch && checkout && reset --hard`.
   This checkout is *hard-pinned* and never a working tree you care about, because we destructively reset it.
2. **List** open PRs via `gh pr list --json`. In `SCOPE=label` (the default) it keeps PRs carrying
   `REVIEW_LABEL`; in `SCOPE=auto`, all non-draft PRs under `DIFF_LINE_CAP`. Bot (`*[bot]`) and draft authors
   are skipped in *either* scope. The JSON is fully validated at the boundary (`isPr`) — a malformed shape
   skips cleanly instead of throwing mid-loop.
3. **Dedup.** For each candidate it reads the PR's comments and skips if one already contains the hidden marker
   `<!-- stupify:<headSHA> -->` (reviewed) or `<!-- stupify-failed:<headSHA> -->` (failed) for the
   *current* head. A new push moves the SHA → markers no longer match → it re-reviews. **One review per head.**
4. **Build memory** from the remaining comments (see below).
5. **Review.** It runs `codex exec` with a prompt pointing at `.review/*` and the diff, in a `workspace-write`
   sandbox restricted to `/tmp` with network on. Codex reads the rubric + corpus, writes the review to a temp
   file ending in the marker, and posts it with `gh pr comment`.
6. **Cap.** `MAX_PRS` limits PRs *actually reviewed* per sweep — counted only after the cheap dedup skips, so a
   backlog of already-reviewed PRs at the front of the list can't starve later ones.

## Per-PR memory (and why it replaced debounce)

The first version had a 5-minute **debounce**: a push started a clock, and a PR was only reviewed once its head
had been stable for 5 minutes — so a burst of commits collapsed into one review instead of one per commit.

It worked, but it made the reviewer feel *dead* — you'd push and wait. And it turned out to be solving the
wrong problem. The real fix for "don't spam me" is **memory**, not delay:

- Before each review, the engine collects the PR's existing comments, drops CI bots, strips the hidden markers,
  and passes the recent thread (bounded to the last 20) into the prompt as *"your past reviews and the author's
  replies."*
- The prompt's **"Prior reviews on this PR"** rules tell the model: don't re-raise resolved or
  reasoned-declined items, report only what's genuinely new, and if nothing new remains post the one-line
  `no new blocking issues — prior items addressed ✅` and stop.

The GitHub thread **is** the memory store — it survives restarts, and it already contains the author's replies
(a separate state file wouldn't). With memory, a mid-burst re-review *sees its prior reviews and converges*
instead of repeating — which is what debounce was really for. So debounce became pure latency and was deleted.
A push now gets reviewed within ~60s, and the Nth review of a PR is short because it only covers the delta.

This is the core trick: **statelessness was the root cause of both "re-litigates forever" and "never knows when
to stop."** Feed the conversation back in and both go away.

## Safety & failure handling

- **Loud, never silent.** If `codex` can't run (provider down, out of credits, timeout, ENOENT), the sweep posts
  a short error comment with the captured cause *and* stamps a `stupify-failed` marker so it doesn't
  re-hammer the dead provider every minute. `spawnSync`'s `signal`/`error` are folded into the captured output
  so a timeout surfaces as "killed by SIGTERM", not "no output".
- **Config fails toward safe.** Knobs validate and warn on garbage (`MAX_PRS=15lol` → logged, default used).
  `DRY_RUN` is the exception that fails *safe*: a set-but-invalid value (`DRY_RUN=ture`) falls back to preview,
  never live — a typo'd safety switch must not start posting.
- **Bounded spend.** `SCOPE=label` (opt-in) + `MAX_PRS` + the per-head dedup cap what gets reviewed; `DRY_RUN`
  lets you see what *would* be reviewed before spending a token.
- **Single-flight.** `flock -n` in the cron line is the mutual-exclusion primitive — the script doesn't manage
  its own lock.

## Codex specifics

The engine calls, in full:

```
codex exec --cd <STUPIFY_HOME>/repo --sandbox workspace-write \
  -c model_reasoning_effort=<CODEX_EFFORT> \
  -c sandbox_workspace_write.network_access=true \
  -c 'sandbox_workspace_write.writable_roots=["/tmp"]'
```

(`--cd` points it at the dedicated checkout, network is on so it can run `gh`, and only `/tmp` is writable.)
It does *not* pin a provider or model by default — Codex uses whatever auth you've
configured. `CODEX_PROVIDER` (`-c model_provider=…`) and `CODEX_MODEL` (`-c model=…`) let you point it at a
specific gateway or model. There's no API key in stupify itself; credentials are Codex's concern.

## Why curated, not inferred

An earlier experiment auto-extracted a "good code" corpus from the repo. It reliably praised the exact slop it
was supposed to cut — because taste is a judgment, not a statistic. So the corpus is hand-picked, and the
reviewer is explicitly a **finder, not a judge**: it surfaces candidates and cites the corpus, but which
findings matter stays a human call. Five minutes curating `CORPUS.md` is the highest-leverage input you give it.
