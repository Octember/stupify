> Debugging is twice as hard as writing the code in the first place. Therefore, if you write the code as
> cleverly as possible, you are, by definition, not smart enough to debug it.
>
> — **Kernighan's Law**

# stupify

**AI agents are rats in a maze — they reach for what they know.** And unless you teach them better, what they know is slop: most software is garbage, and they'll [happily](https://github.com/thesysdev/openui/issues/517) [imitate](https://github.com/RsyncProject/rsync/issues/929) [it](https://github.com/anthropics/claudes-c-compiler/issues/1).

[![npm](https://img.shields.io/npm/v/@stupify/cli?color=cb3837&label=%40stupify%2Fcli)](https://www.npmjs.com/package/@stupify/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

stupify stays quiet until it finds something real — then says it in one sentence:

> uhhhh ummm this cleanup got a little cleanup-y:
>
> 🟠 **`server/checkout.ts:40`** · slop · conf 0.82
> you inlined `validateCart` and `applyDiscounts` into the handler, so it's branch soup with two mutable `let`s now, instead of validate → price → charge. those weren't throwaway wrappers, they were the steps.
> **→ Fix:** put the named steps back. the handler should orchestrate, not do all of it.
>
> 🟡 **`server/checkout.ts:12`** · slop · conf 0.7
> `order?.total ?? order.cart.total` — `order` is required here, so the `?.` never fires and the fallback is dead code cosplaying as safety. it's `order.total`.
> **→ Fix:** drop the `?.` and the `??`. if order's actually optional, fix the type, don't paper over it.
>
> _— stupify, against the good-code corpus_

### What you get

- **Your taste, not the model's.** Everything is judged against a `CORPUS.md` — a [taste pack](#taste-packs) ("code like dtolnay / DHH / antirez …") or your own best files. Nothing to write to start.
- **Slop, named.** `RUBRIC.md` is your list of what counts as slop: reinvented primitives, speculative abstraction, fallbacks the types already guarantee. It keeps the fix small.
- **Both ends of the loop.** The *same* `.review/` primes the agent before it writes (prevention) and reviews the PR after (detection). The best review is the one you didn't need.
- **It remembers.** Reads the PR thread, won't re-raise what you fixed or waved off, posts `no new blocking issues ✅` when there's nothing left.
- **It's funny.** `oof, yeah this'll break:`. Turn it off if you hate joy.

## Prime your agent (instant, local, no servers)

The best slop is the slop never written. `prime` wires a Claude Code [SessionStart hook](https://docs.claude.com/en/docs/claude-code/hooks) that injects your taste into every session — so the agent holds your standard *before* it touches a line. Pure file read, ~30ms, no model call.

```bash
bunx @stupify/cli taste --pack sindre-sorhus,zod   # pick the code yours should look like
bunx @stupify/cli prime --install                  # every Claude Code session now opens knowing it
```

That's it. Open Claude Code in any repo and it's already primed. A repo's own `.review/` wins; otherwise it
falls back to the taste you assembled. `bunx @stupify/cli prime --uninstall` removes the hook cleanly.

## Add the reviewer (rides exe.dev — no keys, no servers *you* run)

From your laptop, **one command** provisions a VM that reviews your repo's PRs. No API keys, no tokens — you
never even SSH anywhere.

```bash
bunx @stupify/cli
```

```
┌  stupify  — provision a reviewer on exe.dev
◇  using integration acme-widgets
◇  VM stupify-acme-widgets created
└  stupify is provisioned for acme/widgets 👀
```

New to [exe.dev](https://exe.dev)? `ssh exe.dev` to onboard and link GitHub at
[exe.dev/integrations](https://exe.dev/integrations) — both one-time, both painless. Then just **open a PR** —
the sweep picks it up within ~60s and posts once the review finishes, no labels or workflows to wire up. (Want
manual control? `SCOPE=label` flips it to opt-in: only PRs you tag get reviewed.)

```bash
bunx @stupify/cli <owner/repo>          # provision for a specific repo
bunx @stupify/cli setup                 # run the reviewer on this machine instead of a VM
ssh exe.dev rm stupify-<owner>-<repo>   # tear it down
```

The keyless story is the exe.dev path — the VM ships a `gh`-authed GitHub integration and a `codex` gateway. On
the local `setup` path you bring your own (`gh auth login` + a Codex login). Either way the reviewer is a cron
that shells out to [Codex](https://github.com/openai/codex); set `CODEX_PROVIDER`/`CODEX_MODEL` to point it
elsewhere.

## Taste packs

Don't have a corpus yet? Borrow one. Pick a programmer whose code you'd point a new hire at and review (and
write) like them — or compose several:

[dtolnay](packs/dtolnay.md) · [DHH](packs/dhh.md) · [antirez](packs/antirez.md) ·
[Sindre Sorhus](packs/sindre-sorhus.md) · [Rich Harris](packs/rich-harris.md) ·
[zod](packs/zod.md) · [Mitchell Hashimoto](packs/mitchell-hashimoto.md) ·
[Tanner Linsley](packs/tanner-linsley.md) · [Simon Willison](packs/simon-willison.md) ·
[devshorts](packs/devshorts.md) · [Jarred Sumner](packs/jarred-sumner.md) · [browse all →](packs)

Each pack is concrete principles plus commit-pinned exemplar files. Or **bring your own** — point stupify at
the files you *wish* all your code looked like and it scaffolds a `.review/` in your repo:

```bash
bunx @stupify/cli init src/best.ts src/clean-service.ts   # inlines them; you add one line of "why" each
```

A repo's own `.review/` always wins over a pack. stupify dogfoods this — its own
[`.review/CORPUS.md`](.review/CORPUS.md) is real.

## How it works

```
prime   Claude Code SessionStart hook → bun ~/.stupify/prime.ts → inject .review/ (rubric + corpus)
review  cron (~60s) → review-sweep.ts → codex exec → gh pr comment
          refresh checkout · list open PRs (skip drafts/bots) · skip already-reviewed heads
          feed the PR's thread back as memory · review against .review/* · post
```

Both halves read the same `.review/` (a repo's own wins; else the pack taste you assembled). The CLI
(`src/cli.ts`) sets things up; the engines (`src/prime.ts` and `src/review-sweep.ts`) are dependency-free Bun.
The whole design — including why it *remembers* instead of debouncing — is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE) © Noah Lindner. Built by the team at [Bevyl](https://bevyl.ai). `stupif.ai` — read it "stupify". PRs welcome — it'll review them 😈
