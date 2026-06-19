> Debugging is twice as hard as writing the code in the first place. Therefore, if you write the code as
> cleverly as possible, you are, by definition, not smart enough to debug it.
>
> — **Kernighan's Law**

# stupify

Tired of [wasting your time](https://github.com/thesysdev/openui/issues/517) reviewing [AI](https://github.com/RsyncProject/rsync/issues/929) [slop](https://github.com/anthropics/claudes-c-compiler/issues/1)?

[![npm](https://img.shields.io/npm/v/@stupify/cli?color=cb3837&label=%40stupify%2Fcli)](https://www.npmjs.com/package/@stupify/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A code reviewer that talks like an idiot and catches real bugs.**

Kernighan was right: the clever code is the code you can't debug. stupify reads your PRs on
[Codex](https://github.com/openai/codex) and drags them back toward boring.

You give it a `CORPUS.md`: a handful of files you already think are good. It reviews against those, not some
model's idea of "best practice." So it catches the stuff that actually bugs *you*: premature abstractions,
cute one-liners with a bug hiding in them, helpers someone reinvented. Then it points at the boring thing
they should've used.

Most AI reviewers carpet-bomb your PR with `consider renaming this`. stupify stays quiet until it finds
something real, says it in one sentence, and shuts up.

> uhhhh ummm a couple things 👇
>
> 🔴 **`api/sync/worker.ts:142`** · bug · conf 0.88
> the retry got golfed into a recursive ternary that never resets `attempt`, so one 500 retries forever and pins the worker. too clever to debug.
> **→ Fix:** use `withRetry()` from `lib/retry.ts` (it caps attempts), delete the ternary.
>
> 🟡 **`api/sync/worker.ts:31`** · slop · conf 0.7
> `SyncStrategyFactory<T>` is a generic factory with one implementation. it's a function in a costume.
> **→ Fix:** inline it as `syncOrders()`. add the abstraction back if a second strategy ever shows up.
>
> _— stupify, against the good-code corpus_

### What you get

- **Your taste, not the model's.** Every diff is judged against your `CORPUS.md`.
- **Slop, named.** `RUBRIC.md` is your list of what counts as slop: reinvented primitives, speculative abstraction, fallbacks the types already guarantee. It keeps the fix small.
- **It remembers.** Reads the PR thread, won't re-raise what you fixed or waved off, posts `no new blocking issues ✅` when there's nothing left.
- **It's funny.** `oof, yeah this'll break:`. Turn it off if you hate joy.

Write down your taste once. It does the rest.

## Get started (~60 seconds)

stupify rides [exe.dev](https://exe.dev): from your laptop, **one command** provisions a VM that reviews your
repo. No API keys, no tokens — you never even SSH anywhere.

```bash
bunx @stupify/cli
```

```
┌  stupify  — provision a reviewer on exe.dev
◇  using integration acme-widgets
◇  VM stupify-acme-widgets created
└  stupify is provisioned for acme/widgets 👀
```

New to exe.dev? `ssh exe.dev` to onboard and link GitHub at [exe.dev/integrations](https://exe.dev/integrations)
— both one-time, both painless. Then the fun part: **teach it your taste.** Copy [`.review/`](.review) into
your repo and point `CORPUS.md` at the files you *wish* all your code looked like. Label a PR `codex-review`
(or drop in [`autolabel.yml`](.github/workflows/autolabel.yml)) and a review lands in ~60s.

```bash
bunx @stupify/cli <owner/repo>          # provision for a specific repo
bunx @stupify/cli setup                 # install on this machine instead of a VM
ssh exe.dev rm stupify-<owner>-<repo>   # tear it down
```

## How it works

```
cron (~60s) → review-sweep.ts → codex exec → gh pr comment
  refresh checkout · list labelled PRs · skip already-reviewed heads
  feed the PR's thread back as memory · review against .review/* · post
```

The CLI (`src/cli.ts`) provisions; the engine (`src/review-sweep.ts`, dependency-free Bun) does the sweep;
your taste lives in the repo it judges (`.review/`). The whole design — including why it *remembers* instead
of debouncing — is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE) © Noah Lindner. `stupif.ai` — read it "stupify". PRs welcome — it'll review them 😈
