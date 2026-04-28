import { VERSION } from "../core/constants.ts";
import type { SearchCommand, SearchRunJson } from "../core/types.ts";
import { format, type CliUi } from "../core/ui.ts";

export function renderSearchRun(run: SearchRunJson, command: SearchCommand): string {
  if (command.json) return JSON.stringify(run, null, 2);
  return renderSearchHumanText(run, command);
}

export function renderSearchRunToUi(run: SearchRunJson, command: SearchCommand, ui: CliUi): void {
  if (command.json) {
    ui.writeStdout(renderSearchRun(run, command));
    return;
  }

  if (run.stats.skipped && run.stats.skipReason === "input_too_large") {
    ui.warn("Search skipped: input is too large for precise local search.");
    ui.note(oversizedText(run, command), "Skipped");
    ui.outro("Warn-only. Nothing blocked.");
    return;
  }

  if (run.stats.skipped && run.stats.skipReason === "no_candidates") {
    ui.success("Search complete: no search targets found.");
    ui.note(cleanSummaryText(run), "Summary");
    ui.outro("No judgment-offload signals found.");
    return;
  }

  if (run.matches.length === 0) {
    ui.success("Search complete: no judgment-offload signals found.");
    ui.note(cleanSummaryText(run), "Summary");
    ui.outro("Warn-only. Nothing blocked.");
    return;
  }

  ui.clearScreen();
  ui.writeStderr(renderSearchHumanText(run, command));
}

export function renderSearchHumanText(run: SearchRunJson, command: SearchCommand): string {
  if (run.stats.skipped && run.stats.skipReason === "input_too_large") {
    return `${format.heading("Search skipped")}
${oversizedText(run, command)}
Warn-only. Nothing blocked.`;
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

  return renderSlopReport(run, command);
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
  --max-candidates <n> Max semantic search targets. Default: 50.
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

type MatchGroup = Readonly<{
  filePath: string;
  matches: SearchRunJson["matches"];
}>;

function oversizedText(run: SearchRunJson, command: SearchCommand): string {
  const targetLimit = Math.max((run.stats.inputTokens ?? 12_000) + 1, (run.stats.inputTokenCap ?? 12_000) * 2);
  return [
    `Size: ~${run.stats.inputTokens ?? "unknown"} tokens`,
    `Limit: ${run.stats.inputTokenCap ?? "unknown"} tokens`,
    "Stupify skipped the search rather than review truncated context.",
    `Try: ${sourceHint(command)} --max-search-input-tokens ${targetLimit}`,
  ].join("\n");
}

function cleanSummaryText(run: SearchRunJson): string {
  return [
    `Patterns: ${run.patterns.join(", ")}`,
    run.stats.filesChanged === undefined ? null : `Diff: ${run.stats.filesChanged} files, ${run.stats.entitiesScanned ?? 0} changed entities`,
  ].filter(Boolean).join("\n");
}

function renderSlopReport(run: SearchRunJson, command: SearchCommand): string {
  const fileCount = groupMatchesByFile(run.matches).length;
  return [
    slopHeading(),
    reportStatusLine(run, command),
    reportPatternLine(run),
    "",
    run.matches.map((match, index) => renderMatchExample(match, run, index)).join("\n\n"),
    "",
    format.muted(`:${run.matches.length} ${signalNoun(run.matches.length)}  ${fileCount} ${fileCount === 1 ? "file" : "files"}  warn-only  nothing-blocked`),
  ].join("\n");
}

function reportStatusLine(run: SearchRunJson, command: SearchCommand): string {
  const fileCount = groupMatchesByFile(run.matches).length;
  return [
    `${run.matches.length} ${signalNoun(run.matches.length)}`,
    `${fileCount} ${fileCount === 1 ? "file" : "files"}`,
    sourceLabel(command),
    committerLabel(run),
  ].join(" · ");
}

function reportPatternLine(run: SearchRunJson): string {
  return format.muted(`[j/k] scan examples   [q] quit caring   ${patternSummaryLine(run)}`);
}

function patternSummaryLine(run: SearchRunJson): string {
  const counts = new Map<string, number>();
  for (const match of run.matches) counts.set(patternLabel(match), (counts.get(patternLabel(match)) ?? 0) + 1);
  return [...counts.entries()].map(([patternName, count]) => `${patternName} ${count}`).join(" · ");
}

function groupMatchesByFile(matches: SearchRunJson["matches"]): readonly MatchGroup[] {
  const groups = new Map<string, SearchRunJson["matches"][number][]>();
  for (const match of matches) {
    const filePath = proofFilePath(match.proof);
    const group = groups.get(filePath) ?? [];
    group.push(match);
    groups.set(filePath, group);
  }
  return [...groups.entries()].map(([filePath, groupedMatches]) => ({
    filePath,
    matches: groupedMatches,
  }));
}

function renderMatchExample(match: SearchRunJson["matches"][number], run: SearchRunJson, index: number): string {
  return [
    matchVimHeadline(match, run, index),
    `  ${format.muted(fileLocation(match.proof))}`,
    `  ${match.reason}`,
    match.snapshot ? indentCodeBlock(match.snapshot) : null,
    `  ${format.label("why")} ${match.checkWhy ?? "This pattern may indicate judgment-offload."}`,
  ].filter(Boolean).join("\n");
}

function matchVimHeadline(match: SearchRunJson["matches"][number], run: SearchRunJson, index: number): string {
  const number = String(index + 1).padStart(2, " ");
  return `${format.warn(">>")} ${number} ${format.label(patternLabel(match))} ${headlineArgs(match)} ${format.muted(`-- ${matchBlameLabel(match, run)}`)}`;
}

function patternLabel(match: SearchRunJson["matches"][number]): string {
  return titleCase(match.patternName ?? match.patternId.replace(/_/g, " "));
}

function headlineArgs(match: SearchRunJson["matches"][number]): string {
  const destination = entityNameFromProof(match.proof);
  const source = firstBacktickedToken(match.reason) ?? firstLikelySource(match.reason, destination);
  if (source && destination && source !== destination) return `${codeLabel(source)} -> ${codeLabel(destination)}`;
  if (destination) return codeLabel(destination);
  return codeLabel(match.targetId);
}

function matchBlameLabel(match: SearchRunJson["matches"][number], run: SearchRunJson): string {
  return match.blame ? blameSummaryLabel(match.blame) : runLevelBlameLabel(run);
}

function blameSummaryLabel(blame: NonNullable<SearchRunJson["matches"][number]["blame"]>): string {
  return `${blame.author} (${blame.subject})`;
}

function runLevelBlameLabel(run: SearchRunJson): string {
  const author = committerLabel(run);
  const subject = firstHumanSubject(run.stats.commitSubjects ?? []);
  return subject ? `${author} (${subject})` : author;
}

function firstHumanSubject(subjects: readonly string[]): string | undefined {
  return subjects.map((subject) => subject.trim()).find(Boolean);
}

function codeLabel(value: string): string {
  return `\`${value}\``;
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function entityNameFromProof(proof: string): string | undefined {
  const parts = proof.split("::");
  return parts[2] || parts[1] || undefined;
}

function firstBacktickedToken(value: string): string | undefined {
  const match = /`([^`]+)`/.exec(value);
  return cleanToken(match?.[1]);
}

function firstLikelySource(value: string, destination?: string): string | undefined {
  const tokens = [...value.matchAll(/\b[A-Z][A-Za-z0-9_]*(?:\[[^\]]+\])?\b/g)]
    .map((match) => cleanToken(match[0]))
    .filter((token): token is string => Boolean(token));
  return tokens.find((token) => token !== destination && token !== "The");
}

function cleanToken(value: string | undefined): string | undefined {
  const token = value?.trim().replace(/[.,;:]+$/, "");
  return token || undefined;
}

function proofFilePath(proof: string): string {
  return proof.split("::")[0] || proof;
}

function fileLocation(proof: string): string {
  const parts = proof.split("::");
  if (parts.length >= 3) return `${parts[0]}:${parts[1]}:${parts[2]}`;
  return proof;
}

function indentCodeBlock(snapshot: string): string {
  return [
    `  ${format.muted("```")}`,
    ...snapshot.split(/\r?\n/).map((line) => `  ${line}`),
    `  ${format.muted("```")}`,
  ].join("\n");
}

function sourceHint(command: SearchCommand): string {
  if (command.kind === "staged") return "--staged";
  if (command.kind === "since") return `--since "${command.since}"`;
  if (command.kind === "commit") return `--commit ${command.commit}`;
  if (command.kind === "commits") return `--commits ${command.count}`;
  return "--stdin";
}

function sourceLabel(command: SearchCommand): string {
  if (command.kind === "staged") return "staged";
  if (command.kind === "since") return sinceLabel(command.since);
  if (command.kind === "commit") return `commit ${command.commit}`;
  if (command.kind === "commits") return `last ${command.count} commits`;
  return "stdin";
}

function committerLabel(run: SearchRunJson): string {
  const committers = humanCommitters(run.stats.committers ?? []).map(committerDisplayName);
  if (committers.length === 0) return "unknown committer";
  if (committers.length <= 3) return committers.join(", ");
  return `${committers.slice(0, 3).join(", ")} +${committers.length - 3} more`;
}

function humanCommitters(committers: readonly string[]): readonly string[] {
  const nonEmpty = committers.filter(Boolean);
  const humans = nonEmpty.filter((committer) => !isBotCommitter(committer));
  return humans.length > 0 ? humans : nonEmpty;
}

function isBotCommitter(value: string): boolean {
  return /(?:^|<)(?:github|dependabot|renovate)(?:\s|@|>)/i.test(value) ||
    /(?:noreply@github\.com|bot@)/i.test(value);
}

function committerDisplayName(value: string): string {
  return value.replace(/\s*<[^>]+>\s*$/, "").trim() || value;
}

function slopHeading(): string {
  const heading = "YOU GOT SLOP";
  return `${format.warn(format.heading(heading))}
${format.warn("=".repeat(heading.length))}`;
}

function sinceLabel(since: string): string {
  const value = since.trim().toLowerCase();
  if (value === "yesterday" || value === "1 day ago") return "yesterday";
  const match = /^(\d+)\s+(day|week|month|year)s?\s+ago$/.exec(value);
  if (!match) return `since ${since}`;

  const count = Number(match[1]);
  const unit = match[2];
  if (count === 1) return `last ${unit}`;
  return `last ${count} ${unit}s`;
}

function signalNoun(count: number): string {
  return count === 1 ? "signal" : "signals";
}
