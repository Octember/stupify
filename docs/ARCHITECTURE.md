# Architecture

stupify is one bundled Bun review engine (`src/review-sweep.ts` and `src/sweep/*`) on a cron, driving three
markdown files that encode taste. Codex, exe.dev, and the host primitives come from
[`@bevyl-ai/agent-tools`](https://github.com/bevyl-ai/agent-tools). This doc covers how the pieces fit, and why.

## Two halves: engine vs taste

The hard part of an AI reviewer is what it reviews against, not the loop. So the two concerns are split.

|            | Lives in                                             | Is                                                                                |
| ---------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Engine** | this repo, plus the kit                              | generic infra that shells out to `git`/`gh` and drives a codex app-server session |
| **Taste**  | `.review/` (a repo's own, else `~/.stupify/.review`) | `REVIEW-PROMPT.md` (spec), `RUBRIC.md` (anti-slop), `CORPUS.md` (your good code)  |

A `.review/` _inside the repo being reviewed_ is version-controlled with the code it judges, visible in code
review, and tuned through a normal PR, the same way you'd change a lint config. The reviewer reads it fresh from
`origin/main` on every sweep, so a merged rubric change is live immediately.

## The sweep

A cron runs the sweep every minute; the sweep self-locks so two never overlap. Each run:

1. **Refresh** a dedicated checkout (`$STUPIFY_HOME/repo`) to `origin/<DEFAULT_BRANCH>` with a hard reset. It is
   never a working tree you care about.
2. **List** open PRs via `gh pr list --json` with a high explicit `--limit` (gh's default of 30, newest-first,
   silently drops older PRs on a busy repo) and base SHAs from the REST pulls list, paged by hand: `--paginate`
   follows GitHub's Link header to api.github.com verbatim and escapes an exe.dev proxy. `SCOPE=auto` keeps every
   non-draft, non-bot PR under `DIFF_LINE_CAP`, with `REVIEW_LABEL` as the force-include for oversized or bot
   PRs; `SCOPE=label` flips to opt-in. Every JSON boundary is `parse`d; a malformed row throws.
3. **Dedup.** A posted review carries `<!-- stupify:<headSHA> -->`. Same head, no re-run. A push moves the SHA
   and re-arms it. Suppressed no-ops post nothing, so local state catches those. Failed heads are throttled in
   local state too, never posted.
4. **Diff** via the compare API (`base...head`), so a stacked PR diffs against its base, not `main`. GitHub 406s
   past its own size limits; that is terminal, so the PR is skipped, not retried forever.
5. **Review.** A detached worktree at the head SHA gives codex the tree the diff describes. The kit's
   `AppServerSession` runs two turns in a read-only sandbox with no network and no `gh`: the review prompt (taste
   paths, the PR's stated intent, its prior review thread, the diff), then the hand-written second pass. The only
   structured channel is one tool, `review_verdict`. Candidates are gated serially and reviewed by up to
   `CODEX_JOBS` sessions at once; a quota wall stops new launches while in-flight runs drain.
6. **Act.** Findings post as one COMMENT review with inline, resolvable threads. A clean first pass posts `LGTM ✅`
   once; a clean re-review with nothing outstanding posts `still ✅`; prior findings resolved by the diff resolve
   their threads and post `nice, all fixed ✅`; a clean head while findings still stand stays silent. Every ✅ is
   honest: it fires only when no stupify finding is open.

`MAX_PRS` caps PRs _actually reviewed_ per sweep, counted after the dedup skips, so a backlog of reviewed PRs at
the front of the list can't starve the rest.

## The verdict is a tool call

Codex never returns prose the runner parses. It calls `review_verdict` with `{ verdict, opener, findings[] }`.
The kit validates the arguments against the zod schema mid-turn and hands the error back to the model as the
tool result; the tool's own `run` throws for what a schema can't say: an anchor that isn't a right-side line the
diff touches (the only lines GitHub threads on), or a convergence verdict that carries findings. The model
corrects itself before the turn ends. No call by the end of the second turn is a failure that retries later,
never a clean.

## Per-PR memory (and why it replaced debounce)

The first version had a 5-minute debounce: a push started a clock, and a PR was reviewed once its head had been
stable for 5 minutes, so a burst of commits collapsed into one review. It made the reviewer feel dead, and it
solved the wrong problem. The real fix for "don't spam me" is memory, not delay.

Before each review the engine reads the PR's existing review thread, drops CI bots, strips the hidden markers,
neutralizes any fence tags (the thread is attacker-controlled), and passes the recent thread into the prompt as
"your past reviews and the author's replies". The prompt tells the model not to re-raise resolved or
reasoned-declined items and to report only what's new. The GitHub thread _is_ the memory store: it survives
restarts and already holds the author's replies. A mid-burst re-review sees its prior reviews and converges,
which is what debounce was for, so debounce was deleted. A push is reviewed within about 60s and the Nth review
of a PR covers only the delta.

## Safety

- **Failures stay off the PR.** A dead gateway, a usage wall, a stall, a turn that never submits a verdict: the
  sweep logs the cause for the operator and records the head locally so it doesn't re-hammer every minute. Only
  real reviews ever reach a PR.
- **Codex is locked down.** Read-only sandbox, no network, no `gh`. The runner does all GitHub I/O and hands
  codex the diff in the prompt. A prompt-injected diff or comment can at worst produce a junk verdict; it can't
  exfiltrate, reach the network, or touch a token. Secret-looking env vars are scrubbed from the child.
- **Config fails toward safe.** Knobs validate and warn on garbage; `DRY_RUN` on a typo falls to preview, never
  live.
- **Bounded spend.** `MAX_PRS` per sweep, `MAX_REVIEWS_PER_DAY`, per-head dedup, and a wall ends the sweep
  early. If `CODEX_GATEWAY_POOL` names a ring of exe.dev `llm` integrations, a wall rotates `~/.codex/config.toml`
  to the next one, at most once per `CODEX_ROTATE_COOLDOWN_MIN`; codex re-reads it per session.
- **Single-flight.** The sweep takes `state/sweep.lock`; a lock older than 30 minutes is treated as a crash and
  stolen.

## Why curated, not inferred

An earlier experiment auto-extracted a "good code" corpus from the repo. It reliably praised the exact slop it
was supposed to cut, because taste is a judgment, not a statistic. So the corpus is hand-picked, and the
reviewer is explicitly a **finder, not a judge**: it surfaces candidates and cites the corpus, but which
findings matter stays a human call. Five minutes curating `CORPUS.md` is the highest-leverage input you give it.
