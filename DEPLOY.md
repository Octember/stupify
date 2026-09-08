# Deploying stupify

stupify is one Bun file on a cron, next to a `config.env`. It rides [exe.dev](https://exe.dev): a GitHub
integration proxies `gh` for the repo and the `llm` integration fronts your ChatGPT plan for codex, so the box
holds no tokens. Onboard once with `ssh exe.dev`.

## Provision a reviewer for a repo

```sh
git clone https://github.com/Octember/stupify && cd stupify && bun install
ssh exe.dev integrations add github --name stupify-acme-widgets --repository acme/widgets
ssh exe.dev new --name stupify-acme-widgets --integration stupify-acme-widgets --setup-script /dev/stdin < deploy/vm-setup.sh
ssh exe.dev integrations attach llm vm:stupify-acme-widgets
deploy/push.sh stupify-acme-widgets acme/widgets stupify-acme-widgets.int.exe.xyz
```

`vm-setup.sh` writes the keyless codex config and installs bun. `push.sh` builds `src/review-sweep.ts` into one
file and copies it to `~/.stupify/review-sweep.ts`; a first push (three arguments) also writes `config.env` and
installs the minute cron, with `GH_HOST=<integration>.int.exe.xyz` on the cron line so `gh` talks to the
integration. The next cron tick runs it. Reviews land on open PRs within about a minute of a push.

## Taste

The reviewer reads `.review/` from the target repo's default branch: `REVIEW-PROMPT.md` (the spec),
`RUBRIC.md` (what counts as slop), `CORPUS.md` (the code yours should look like). Start from this repo's own
`.review/`. A repo without one falls back to `~/.stupify/.review` on the box, which you place by hand:

```sh
scp -r .review stupify-acme-widgets.exe.xyz:.stupify/.review
```

## config.env

Every knob is a line in `~/.stupify/config.env`, read fresh each sweep. A one-shot env var wins over the file.

| key                         | default           | meaning                                                                |
| --------------------------- | ----------------- | ---------------------------------------------------------------------- |
| `REPO_SLUG`                 | required          | `owner/repo`                                                           |
| `DEFAULT_BRANCH`            | `main`            | branch the checkout tracks and `.review/` is read from                 |
| `REVIEW_DIR`                | `.review`         | taste dir inside the repo                                              |
| `SCOPE`                     | `auto`            | `auto` reviews every non-draft, non-bot PR; `label` only labelled ones |
| `REVIEW_LABEL`              | `codex-review`    | force-include label: oversized diffs and bot PRs opt in with it        |
| `DIFF_LINE_CAP`             | `20000`           | skip bigger diffs unless labelled                                      |
| `MAX_PRS`                   | `15`              | reviews per sweep, counted after dedup skips                           |
| `MAX_REVIEWS_PER_DAY`       | `0` (off)         | hard daily ceiling                                                     |
| `FAIL_RETRY_MIN`            | `60`              | wait before retrying a head whose review failed                        |
| `CODEX_JOBS`                | `3`               | concurrent codex sessions                                              |
| `CODEX_MODEL`               | codex default     | `-c model=…` for the session                                           |
| `CODEX_EFFORT`              | `high`            | `model_reasoning_effort`                                               |
| `CODEX_GATEWAY_POOL`        | (off)             | ordered `llm` hosts to rotate through on a quota wall                  |
| `CODEX_ROTATE_COOLDOWN_MIN` | `10`              | minimum minutes between rotations                                      |
| `DRY_RUN`                   | `0`               | list what would be reviewed, run no codex, post nothing                |
| `STUPIFY_HOME`              | beside the bundle | where `config.env`, `state/`, `repo/`, `worktrees/` live               |

## Update

```sh
deploy/push.sh stupify-acme-widgets
```

## Watch it

```sh
ssh stupify-acme-widgets.exe.xyz tail -f .stupify/state/sweep.log
```

- `reviewing PR #N @ sha (base main)` then `#N done (2 inline, 1 blocking)`, `#N clean first pass — posted LGTM ✅`, or `#N nothing new — posted still ✅`: working.
- `review FAILED for #N — <reason>`: codex failed; the reason is the gateway's or the kit's. A usage wall ends the sweep and rotates the gateway if `CODEX_GATEWAY_POOL` is set.
- `gh pr list failed — …` / `gh api pulls failed — …`: the GitHub integration; run the same `gh` command on the box.
- `refresh failed`: the checkout; check `DEFAULT_BRANCH` and the integration.
- `skip #N — diff … > cap`: the size cap, not a fault.

State is three JSON files under `~/.stupify/state/`: `reviewed.json` (heads already reviewed), `failures.json`
(heads to leave alone until `FAIL_RETRY_MIN` passes), `daily.json`. Delete a PR's key from `failures.json` to
retry it on the next tick.

## Run it anywhere else

Any box with `bun`, `gh` (authed for the repo), and `codex` (logged in) works the same way: put the bundle and
`config.env` in a directory, run `bun review-sweep.ts` from cron. `STUPIFY_HOME` points it elsewhere. Behind an
exe.dev GitHub integration, put `GH_HOST=<integration>.int.exe.xyz` in the environment (the cron line), not
in `config.env`: `gh` reads it from the environment.

## Tear down

```sh
ssh exe.dev rm stupify-acme-widgets
```
