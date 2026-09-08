# stupify

The code is the spec; `src/review-sweep.ts` reads top to bottom as what one sweep does.

- Codex through `@bevyl-ai/agent-tools` on the exe.dev gateway, never the Claude API. The verdict is a tool call, never parsed prose.
- One Bun file on a cron, `config.env` beside it, state in three JSON files. No server, no database, no CLI.
- Only real reviews reach a PR. Failures are logged and throttled locally, never posted.
- Every `gh --json` boundary is `Schema.parse`d; a malformed row throws, it does not skip.
- Smallest change that solves it. Before keeping anything, name its second reader or writer; otherwise delete it.

`bun run check` gates every commit: typecheck, lint, fmt, build. Deploy is `deploy/push.sh <vm>` (DEPLOY.md).
