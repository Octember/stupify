> Debugging is twice as hard as writing the code in the first place. Therefore, if you write the code as
> cleverly as possible, you are, by definition, not smart enough to debug it.
>
> — **Kernighan's Law**

# stupify

Tired of [wasting your time](https://github.com/thesysdev/openui/issues/517) reviewing [AI](https://github.com/RsyncProject/rsync/issues/929) [slop](https://github.com/anthropics/claudes-c-compiler/issues/1)?

[![npm](https://img.shields.io/npm/v/@stupify/cli?color=cb3837&label=%40stupify%2Fcli)](https://www.npmjs.com/package/@stupify/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A code reviewer that talks like an idiot and catches real bugs.** It reviews your PRs on
[Codex](https://github.com/openai/codex) against a corpus of code *you* hand-picked — so it flags *your* kind
of slop (the clever, over-abstracted, *"I'll-be-smart-about-this"* kind), in *your* voice, and names the
boring primitive they should've reused. Not generic "best practices." Yours.

Not another bot spraying `consider renaming this` on every line — it's opinionated, it speaks in your voice,
and it only comments when it's actually found something (and shuts up when it hasn't).

> uhhhh ummm a couple things 👇
>
> 🔴 **`src/checkout/session.ts:88`** · footgun · conf 0.9
> if `stripe.retrieve()` throws, the `catch` returns an empty cart — a transient blip looks like an empty order.
> **→ Fix:** rethrow with context, like the fail-loud boundary in `payment-service.ts`.
>
> _— stupify, against the good-code corpus_

### What you actually get

- 🎯 **Reviews in your taste.** Drop a few of your best files into `CORPUS.md`; every diff is judged against *them*, not the model's idea of best practice.
- 🧹 **Slop, named.** `RUBRIC.md` is *your* definition of slop — reinvented primitives, speculative abstraction, fallbacks the types already guarantee — and it right-sizes the fix to the owner.
- 🧠 **It remembers, so it shuts up.** Fed the PR's thread, it won't re-raise what you fixed or declined; when there's nothing new it posts `no new blocking issues ✅` and stops.
- 😂 **It's actually fun to get reviewed by.** `oof, yeah this'll break:` … then it gets to the point. (Tunable, or turn it off.)

**Encode your taste once; let the model do the rest.**

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
