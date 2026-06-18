# stupify

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A code reviewer that talks like an idiot and catches real bugs.**

> uhhhh ummm a couple things 👇
>
> 🔴 **`src/checkout/session.ts:88`** · footgun · conf 0.9
> if `stripe.retrieve()` throws, the `catch` returns an empty cart — a transient blip looks like an empty order.
> **→ Fix:** rethrow with context, like the fail-loud boundary in `payment-service.ts`.
>
> _— stupify, against the good-code corpus_

Reviews your PRs on [Codex](https://github.com/openai/codex), against a corpus of code **you** picked:

- 🎯 **Your taste.** Hand-pick your best files into `CORPUS.md`; it judges diffs against *that*, and cites them.
- 🧹 **Anti-slop.** `RUBRIC.md` defines slop for your team, and it right-sizes the fix to the owner.
- 🧠 **Remembers + converges.** Fed the PR's thread, so it won't re-raise what you fixed or declined — and posts `no new blocking issues ✅` and stops.
- 😂 **A personality.** `oof, yeah this'll break:` … then gets to the point. (Tunable.)

A finder, not a gatekeeper — it comments, it doesn't block merges.

## Quickstart

Stupify runs on an always-on box, so it rides [exe.dev](https://exe.dev). From your laptop, **one command provisions everything** — it detects your repo, wires the GitHub integration, and spins up a VM that installs itself. No keys, no tokens, you never SSH anywhere:

```bash
bunx github:Octember/stupif.ai
```

```
┌  stupify  — provision a reviewer on exe.dev
◇  using integration acme-widgets
◇  VM stupify-acme-widgets created
└  stupify is provisioned for acme/widgets 👀
```

First time on exe.dev? `ssh exe.dev` to onboard, link GitHub at [exe.dev/integrations](https://exe.dev/integrations). Then give it your taste — copy [`.review/`](.review) into your repo and point `CORPUS.md` at your best files. Label a PR `codex-review` (or add [`autolabel.yml`](.github/workflows/autolabel.yml)) → a review in ~60s.

```bash
bunx github:Octember/stupif.ai <owner/repo>   # provision for a specific repo
ssh exe.dev rm stupify-<owner>-<repo>         # tear it down
bunx github:Octember/stupif.ai setup          # install on this machine instead of a VM
```

## How it works

```
cron (~60s) → review-sweep.ts → codex exec → gh pr comment
  refresh checkout · list labelled PRs · skip already-reviewed heads
  feed the PR's thread back as memory · review against .review/* · post
```

The CLI (`src/cli.ts`) provisions; the engine (`src/review-sweep.ts`, dependency-free Bun) sweeps; the taste
(`.review/`) lives in the repo it judges. Details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE) © Noah Lindner. `stupif.ai` — read it "stupify".
