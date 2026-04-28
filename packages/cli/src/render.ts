import { VERSION } from "./constants.ts";
import type { SearchCommand, SearchRunJson } from "./types.ts";
import { format } from "./ui.ts";

export function renderSearchRun(run: SearchRunJson, command: SearchCommand): string {
  if (command.json) return JSON.stringify(run, null, 2);

  if (run.stats.skipped && run.stats.skipReason === "input_too_large") {
    return `${format.heading("Search input is too large for precise local search.")}
${format.heading("Size:")}
~${run.stats.inputTokens ?? "unknown"} tokens
${format.heading("Limit:")}
${run.stats.inputTokenCap ?? "unknown"} tokens
Stupify skipped the search rather than review truncated context.
Nothing was blocked.
${format.heading("Try:")}
rerun with ${sourceHint(command)} --max-search-input-tokens ${Math.max((run.stats.inputTokens ?? 12_000) + 1, (run.stats.inputTokenCap ?? 12_000) * 2)}`;
  }

  if (run.stats.skipped && run.stats.skipReason === "no_candidates") {
    return `${format.heading("Search complete.")}
${format.label("Patterns:")} ${run.patterns.join(", ")}
${format.success("No search targets found.")}`;
  }

  if (run.matches.length === 0) {
    return `${format.heading("Search complete.")}
${format.label("Patterns:")} ${run.patterns.join(", ")}
${format.success("No judgment-offload signals found.")}`;
  }

  return `${format.warn("Possible judgment-offload detected:")}
${run.matches.map((match, index) => `${index + 1}. ${format.label(match.patternId)}
   ${format.muted("Why:")} ${match.checkWhy ?? "This pattern may indicate judgment-offload."}
   ${format.muted("Match:")} ${match.reason}
   ${format.muted("Proof:")} ${match.proof}`).join("\n")}
${format.muted("Search mode is warn-only.")}`;
}

export function helpText(): string {
  return `Stupify ${VERSION}

Usage:
  stupify
  stupify --since "2 weeks ago"
  stupify --commit <commit>
  stupify --commits <count>
  stupify --staged
  stupify --mode search --staged
  stupify hook install|uninstall|status
  stupify doctor
  stupify bench search experiments/search-bench.json
  git diff HEAD~1..HEAD | stupify --stdin

Options:
  --staged             Search staged changes.
  --mode <mode>        search. Search is the only analysis mode.
  --since <date>       Search the net diff from the first commit before this git date to HEAD.
  --commit <commit>    Search one commit as a net diff.
  --commits <count>    Search the net diff across the last N non-merge commits.
  --stdin              Read a git diff from stdin.
  --debug-sem          Print sem commands and stderr.
  --max-candidates <n> Max semantic search targets. Default: 10.
  --max-search-input-tokens <n>
                        Max search input tokens before skipping. Default: 12000.
  --checks <ids>       Comma-separated pattern ids.
  --model <id>         gemma-4-e2b, gemma-4-e4b, gemma-4-26b-a4b, qwen3-4b-magicquant, qwen2.5-coder-1.5b, qwen2.5-coder-7b, or qwen2.5-coder-32b.
  --search-profile <path>
                       Dev/bench-only search profile override.
  --include-counter-reason-in-prompt
                       Debug/bench-only: include counter reason in the model prompt.
  --json               Print JSON only.

Diagnostics:
  stupify doctor       Check local setup, hook status, and privacy boundary.

Default:
  stupify is equivalent to stupify --since "2 weeks ago".

Pipeline:
  sem diff -> counter scout -> Repomix context -> local search model.

Not included:
  Findings audit, validators, judges, baselines, sharing, hosted server calls, GitHub, dashboards, or repo-wide crawling.
`;
}

function sourceHint(command: SearchCommand): string {
  if (command.kind === "staged") return "--staged";
  if (command.kind === "since") return `--since "${command.since}"`;
  if (command.kind === "commit") return `--commit ${command.commit}`;
  if (command.kind === "commits") return `--commits ${command.count}`;
  return "--stdin";
}
