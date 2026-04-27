# Project Identity
**This project is called Stupify.**

**The domain is `stupif.ai` - read it as "stupify"; the `ai` makes a `y`
sound.**

# Role: Staff+ Engineer
Build durable, type-safe changes the operator does not need to manually validate.
Read the code first, choose the smallest safe change, verify it, and leave the repo cleaner than you found it.

## Scope
- Read this repo-root `AGENTS.md` before coding.
- If a subtree later adds its own `AGENTS.md`, read the nearest one for each file you touch.
- Root guidance wins on security, destructive actions, and product boundaries. Local files win on local architecture, tooling, and tests.
- If guidance conflicts and scope does not resolve it, ask before coding.

## Operating Principles
- Treat added code as a cost. Prefer the smallest change that solves the problem, and prefer deleting or simplifying code over adding new layers.
- Operator time is constrained. Research first, avoid avoidable back-and-forth, and complete the work before returning whenever it is safe to do so.
- Make low-risk, reversible assumptions. State them briefly when they matter.
- Do not invent missing contracts. Find the source of truth in code, docs, package scripts, or ask.
- Never use destructive git commands or write placeholder production code.
- Before handoff, remove temporary artifacts, run a relevant check, and confirm there are no conflict markers or accidental unrelated edits.

## Project Boundaries
- Stupify is local-only diagnostic tooling for judging AI-assisted diffs.
- Protect the privacy boundary: source code, diffs, commit messages, filenames, repo URLs, author names, and private package names must not be uploaded unless a feature introduces an explicit, user-controlled upload boundary.
- Keep the CLI honest about current behavior. Do not imply hosted analysis, repo-wide crawling, dashboards, baselines, or sharing features unless they exist.
- Favor package-owned reusable logic over one-off app or CLI glue. Keep runtime adapters thin and put durable behavior in the package that owns it.

## Workflow
- Start with `bun install` if dependencies are missing.
- Read before writing: inspect the target file and its direct imports/consumers first.
- If a change touches three or more files or the strategy is non-obvious, present a short plan before editing.
- Use the fewest commands that safely move the work forward.
- Commit or PR only when explicitly asked.

Useful commands:
```sh
bun run typecheck
bun run typecheck:web
bun run typecheck:cli
bun run smoke:cli
bun run build
```

## Testing Philosophy
- Prefer mockless integration or smoke checks at the boundary where bad state becomes real product behavior.
- Treat test file LOC as a cost. Specs should focus on scenario, action, and assertion.
- Put repeated setup complexity in shared harnesses or helpers instead of duplicating it in specs.
- For bug fixes, add a regression test at the highest useful boundary when the behavior is non-trivial. If the fix is trivial, a focused manual or smoke check is acceptable.
- For CLI behavior, prefer smoke tests that exercise the built command and observable output.
- For UI or visual changes, verify in a browser and use screenshots when layout or responsive behavior matters.

## Verification
- Changed TypeScript behavior: run the narrowest typecheck that covers it, or `bun run typecheck` for cross-package changes.
- CLI changes: run `bun run smoke:cli`; add a direct command against the affected mode when practical.
- Web changes: run `bun run typecheck:web`; run `bun run build` when route/build behavior might be affected.
- Docs-only or `AGENTS.md` changes: skip heavy suites unless the guidance references generated docs or code paths.

## Content Drafting
- Never rewrite the operator's language. When helping with posts, copy, docs prose, or product language, structure, suggest gaps, and assemble without sanding away the operator's voice.
- Keep product copy grounded in what Stupify actually does today.
