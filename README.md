# stupify

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A code reviewer that talks like an idiot and catches real bugs.**

> uhhhh ummm a couple things 👇
>
> 🔴 **`src/checkout/session.ts:88`** · footgun · conf 0.9
> if `stripe.retrieve()` throws, the `catch` returns an empty cart — a transient API blip silently looks like
> an empty order instead of an error.
> **→ Fix:** rethrow with context, like the fail-loud boundary in `payment-service.ts`.
>
> _— stupify, against the good-code corpus_

It reads like it's a little dumb. It isn't. Stupify reviews your PRs on [Codex](https://github.com/openai/codex),
measured against a corpus of code **you** picked — so it flags *your* kind of slop and cites *your* primitives.
And it's different from every other AI reviewer in four ways:

- 🎯 **Grounded in your taste.** You hand-pick a few of your best files into `CORPUS.md`. Every diff is judged
  against *that*, not the model's idea of "best practices." Reviews name the actual thing in your codebase the
  change should have reused.
- 🧹 **Anti-slop, not pro-process.** A `RUBRIC.md` defines what slop is for your team — reinvented primitives,
  speculative abstraction, defensive fallbacks the types already guarantee — and it right-sizes the fix to the
  owner (a one-off script shouldn't grow a schema library).
- 🧠 **It remembers, so it converges.** Each review is fed the PR's existing thread. It won't re-raise what you
  fixed or declined-with-a-reason, and when nothing new remains it posts `no new blocking issues ✅` and
  **shuts up**. It reviews what's new since last time, not everything every time.
- 😂 **A personality.** `uhhhh ummm`, `oof, yeah this'll break:`, `yep. clean. no notes 🎉` — it reacts like a
  human scrolling your diff, then gets to the point. (Tunable; delete it for a dry tone.)

It's a finder, not a gatekeeper — it posts a comment, it doesn't block your merge.

---

## Quickstart

Built for [**exe.dev**](https://exe.dev): on a VM there's nothing to authenticate — Codex runs on the exe-llm
gateway (no API key) and `gh` runs on your GitHub integration (no token). One line clones it, installs the
deps, and drops you into the setup wizard:

```bash
git clone https://github.com/Octember/stupif.ai && cd stupif.ai && bun install && bun src/cli.ts
```

The wizard checks your tools, **auto-detects your repo**, asks for your integration host, shows the plan, and
installs the cron sweep — then:

```
┌  stupify  — sounds dumb, reviews sharp
◇  bun, gh, codex, git, flock — all here
◇  Review acme/widgets? (detected from git remote) Yes
◇  installed → ~/.stupify
└  stupify is watching acme/widgets 👀
```

Then **give it your taste** — copy this repo's [`.review/`](.review) into the repo you're reviewing and point
`CORPUS.md` at *your* best files (5 minutes, highest leverage). Label any PR `codex-review` (or drop in
[`.github/workflows/autolabel.yml`](.github/workflows/autolabel.yml)) and a review lands within ~60s.

```bash
stupify              # the setup wizard (or: stupify <owner/repo>)
stupify run --dry    # preview a sweep without posting
stupify --help
```

Not on exe.dev? It runs anywhere with `bun`, `gh`, `codex`, `git`, `flock` (Linux) and `cron` — `gh auth login`
+ a working `codex` auth, then the same wizard (leave the integration host blank).

---

## How it works

```
cron (~60s)  →  review-sweep.ts  →  codex exec  →  gh pr comment
                   ├─ git: refresh a dedicated checkout of your repo
                   ├─ gh:  open PRs labelled codex-review
                   ├─ skip any already reviewed at this head SHA (hidden marker)
                   ├─ build memory from the PR's existing review thread
                   └─ codex reads .review/{REVIEW-PROMPT,RUBRIC,CORPUS}.md + the diff, writes, posts
```

The **CLI** (`src/cli.ts`, Bun + [@clack/prompts](https://github.com/bombshell-dev/clack)) is just the wizard.
The **engine** (`src/review-sweep.ts`, dependency-free Bun) is the sweep. The **taste** lives in a `.review/`
dir *inside the repo you're reviewing*, so it's version-controlled with the code it judges. Idempotent
(one review per head SHA), bot/draft PRs skipped, `MAX_PRS` cap, `DRY_RUN`, single-flight via `flock`, and a
**loud failure comment** if Codex can't run. Full design notes — including why memory replaced a debounce
window — in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Honest notes

- **It's a finder, not a judge.** It surfaces candidates well; which findings matter is still your call —
  which is exactly why the corpus is curated, not inferred.
- **Cost scales with reviews.** Each review is a Codex run. `SCOPE=label` + `MAX_PRS` bound spend; memory makes
  re-reviews cheap (often a one-line "no new issues").
- **Taste can't be auto-extracted.** Hand-pick `CORPUS.md` — a tool that guessed your taste tended to praise
  the exact slop it should cut.

## License

[MIT](LICENSE) © Noah Lindner. The domain is `stupif.ai` — read it as "stupify".
