import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  SearchBenchConfig,
  SearchBenchCommitReplay,
  SearchBenchReplayRun,
  SearchBenchRun,
  SearchBenchSmokeRun,
  SearchFixture,
  SearchFixtureExpectation,
  SearchMatch,
  SearchProfile,
  SearchRunJson,
} from "../core/types.ts";

const execFileAsync = promisify(execFile);

type ProfileResult = Readonly<{
  profileId: string;
  fixtureScore: number;
  falsePositives: number;
  falseNegatives: number;
  truePositives: number;
  trueNegatives: number;
  wrongPatterns: number;
  assignedCheckFalsePositives: number;
  avgMs: number;
  smokeMatches: number;
  smokeSkipped: number;
  matchesUsingCounterReasonAsProof: number;
  decision: string;
}>;

type BenchSummary = Readonly<{
  name: string;
  outputDir: string;
  generatedAt: string;
  runs: readonly SearchBenchRun[];
  realReplayRuns: readonly SearchBenchReplayRun[];
  leaderboard: readonly ProfileResult[];
  perCheck: readonly CheckResult[];
}>;

type CheckResult = Readonly<{
  checkId: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  wrongPatterns: number;
  assignedCheckFalsePositives: number;
  decision: string;
}>;

export async function runSearchBench(configPath: string): Promise<string> {
  const startedAt = new Date();
  const configFile = path.resolve(configPath);
  const configDir = path.dirname(configFile);
  const config = JSON.parse(await readFile(configFile, "utf8")) as SearchBenchConfig;
  const outputDir = path.resolve(
    "experiments/results",
    `${safeSegment(config.name)}-${startedAt.toISOString().replace(/[:.]/g, "-")}`,
  );
  const profilesDir = path.join(outputDir, "profiles");
  const runsDir = path.join(outputDir, "runs");
  const replayDir = path.join(outputDir, "real-replay");
  await mkdir(profilesDir, { recursive: true });
  await mkdir(runsDir, { recursive: true });
  await mkdir(replayDir, { recursive: true });

  const profilePaths = await resolveProfilePaths(config.profiles, configDir);
  const profiles = await Promise.all(profilePaths.map(readProfile));
  await Promise.all(profiles.map(({ profile, filePath }) =>
    writeFile(path.join(profilesDir, `${safeSegment(profile.id)}.json`), JSON.stringify({ source: filePath, ...profile }, null, 2)),
  ));

  const fixturePaths = await resolveGlob(config.fixtures, configDir);
  const fixtures = await Promise.all(fixturePaths.map(readFixture));
  const allRuns: SearchBenchRun[] = [];
  const replayRuns: SearchBenchReplayRun[] = [];

  for (const { profile, filePath: profilePath } of profiles) {
    for (const { fixture } of fixtures) {
      const run = await runFixture(profile.id, profilePath, fixture);
      allRuns.push(run);
      await writeRunFiles(runsDir, `${fixture.id}__${profile.id}`, run, fixture.description);
    }
    for (const smoke of config.realSmokeRuns ?? []) {
      const run = await runSmoke(profile.id, profilePath, smoke);
      allRuns.push(run);
      await writeRunFiles(runsDir, `${smoke.id}__${profile.id}`, run, "Real repo smoke run");
    }
  }

  for (const replay of config.realCommitReplay ?? []) {
    const runs = await runCommitReplay(replay, profiles, replayDir);
    replayRuns.push(...runs);
  }

  const leaderboard = summarize(profiles.map(({ profile }) => profile), allRuns);
  const perCheck = summarizeByCheck(allRuns);
  const summary: BenchSummary = {
    name: config.name,
    outputDir,
    generatedAt: startedAt.toISOString(),
    runs: allRuns,
    realReplayRuns: replayRuns,
    leaderboard,
    perCheck,
  };
  await writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  const leaderboardText = renderLeaderboard(leaderboard, perCheck);
  await writeFile(path.join(outputDir, "leaderboard.md"), leaderboardText);
  await writeFile(path.join(outputDir, "real-replay-summary.json"), JSON.stringify(replayRuns, null, 2));
  await writeFile(path.join(outputDir, "real-replay.md"), renderReplayMarkdown(replayRuns));
  await writeFile(path.join(outputDir, "real-replay-review.md"), renderReplayReviewMarkdown(replayRuns));

  return `Search bench complete.
Results: ${outputDir}

${leaderboardText}`;
}

async function runFixture(profileId: string, profilePath: string, fixture: SearchFixture): Promise<SearchBenchRun> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "stupify-search-fixture-"));
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: tempDir });
    const patchPath = path.join(tempDir, "fixture.patch");
    await writeFile(patchPath, fixture.stagedPatch);
    await execFileAsync("git", ["apply", "--recount", "--whitespace=nowarn", patchPath], { cwd: tempDir, maxBuffer: 32 * 1024 * 1024 });
    await rm(patchPath, { force: true });
    await execFileAsync("git", ["add", "-A"], { cwd: tempDir });
    const result = await runCli(tempDir, ["--staged", "--json", "--search-profile", profilePath]);
    const run = resultToBenchRun(profileId, result, { fixtureId: fixture.id, expected: fixture.expected });
    return {
      ...run,
      score: scoreFixtureRun(run, fixture.expected),
    };
  } catch (error) {
    return errorRun(profileId, { fixtureId: fixture.id, expected: fixture.expected }, error);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runSmoke(profileId: string, profilePath: string, smoke: SearchBenchSmokeRun): Promise<SearchBenchRun> {
  const cwd = resolveSmokeCwd(smoke.cwd);
  if (!cwd) {
    return {
      profileId,
      smokeId: smoke.id,
      elapsedMs: 0,
      modelCalls: 0,
      patterns: [],
      targets: 0,
      targetsByPattern: {},
      inputTokens: 0,
      skipped: true,
      skipReason: "missing_cwd",
      matches: [],
      targetsPreview: [],
      matchesUsingCounterReasonAsProof: 0,
      score: -5,
      error: "Smoke cwd is not configured. Set BEVYL_REPO or provide cwd.",
    };
  }
  try {
    const result = await runCli(cwd, [...smoke.args, "--json", "--search-profile", profilePath]);
    const run = resultToBenchRun(profileId, result, { smokeId: smoke.id });
    return {
      ...run,
      score: scoreSmokeRun(run),
    };
  } catch (error) {
    return errorRun(profileId, { smokeId: smoke.id }, error);
  }
}

type ReplayCommit = Readonly<{ sha: string; shortSha: string }>;

async function runCommitReplay(
  replay: SearchBenchCommitReplay,
  profiles: readonly Readonly<{ filePath: string; profile: SearchProfile }>[],
  replayDir: string,
): Promise<readonly SearchBenchReplayRun[]> {
  const cwd = resolveReplayCwd(replay);
  if (!cwd) {
    return replay.profiles.map((profileId) => replayErrorRun(replay.id, profileId, { sha: "", shortSha: "(none)" }, new Error(`Replay cwd is not configured. Set ${replay.repoEnv ?? "repo env"} or provide cwd.`)));
  }

  const commits = await replayCommits(cwd, replay);
  const profilesById = new Map(profiles.map((profile) => [profile.profile.id, profile]));
  const runs: SearchBenchReplayRun[] = [];
  for (const commit of commits) {
    for (const profileId of replay.profiles) {
      const profile = profilesById.get(profileId);
      const run = profile
        ? await runReplayCommit(cwd, replay.id, commit, profile.profile.id, profile.filePath)
        : replayErrorRun(replay.id, profileId, commit, new Error(`Unknown replay profile: ${profileId}`));
      runs.push(run);
      await writeFile(
        path.join(replayDir, `${safeSegment(replay.id)}__${safeSegment(commit.shortSha)}__${safeSegment(profileId)}.json`),
        JSON.stringify(run, null, 2),
      );
    }
  }
  return runs;
}

async function replayCommits(cwd: string, replay: SearchBenchCommitReplay): Promise<readonly ReplayCommit[]> {
  const args = ["log", "--format=%H", `-${replay.limit}`];
  if (replay.nonMerge) args.push("--no-merges");
  if (replay.since) args.push(`--since=${replay.since}`);
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  return stdout
    .split(/\r?\n/)
    .map((sha) => sha.trim())
    .filter(Boolean)
    .map((sha) => ({ sha, shortSha: sha.slice(0, 7) }));
}

async function runReplayCommit(
  repoCwd: string,
  replayId: string,
  commit: ReplayCommit,
  profileId: string,
  profilePath: string,
): Promise<SearchBenchReplayRun> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "stupify-replay-"));
  let worktreeAdded = false;
  try {
    const parent = `${commit.sha}^`;
    const stats = await commitStats(repoCwd, parent, commit.sha);
    await execFileAsync("git", ["worktree", "add", "--detach", tempDir, parent], { cwd: repoCwd, maxBuffer: 64 * 1024 * 1024 });
    worktreeAdded = true;
    const { stdout: patch } = await execFileAsync("git", ["diff", "--binary", parent, commit.sha], { cwd: repoCwd, maxBuffer: 128 * 1024 * 1024 });
    const patchPath = path.join(tempDir, "commit.patch");
    await writeFile(patchPath, patch);
    await execFileAsync("git", ["apply", "--cached", "--whitespace=nowarn", patchPath], { cwd: tempDir, maxBuffer: 128 * 1024 * 1024 });
    await rm(patchPath, { force: true });
    const result = await runCli(tempDir, ["--staged", "--json", "--search-profile", profilePath]);
    return replayResult(replayId, profileId, commit, result, stats);
  } catch (error) {
    return replayErrorRun(replayId, profileId, commit, error);
  } finally {
    if (worktreeAdded) {
      await execFileAsync("git", ["worktree", "remove", "--force", tempDir], { cwd: repoCwd, maxBuffer: 64 * 1024 * 1024 }).catch(async () => {
        await rm(tempDir, { recursive: true, force: true });
        await execFileAsync("git", ["worktree", "prune"], { cwd: repoCwd }).catch(() => undefined);
      });
    } else {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

async function commitStats(cwd: string, parent: string, target: string): Promise<Readonly<{ changedFiles: number; addedLines: number; deletedLines: number }>> {
  const { stdout } = await execFileAsync("git", ["diff", "--numstat", parent, target], { cwd, maxBuffer: 32 * 1024 * 1024 });
  let changedFiles = 0;
  let addedLines = 0;
  let deletedLines = 0;
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const [added, deleted] = line.split(/\s+/);
    changedFiles += 1;
    addedLines += numericStat(added);
    deletedLines += numericStat(deleted);
  }
  return { changedFiles, addedLines, deletedLines };
}

function replayResult(
  replayId: string,
  profileId: string,
  commit: ReplayCommit,
  result: SearchRunJson,
  stats: Readonly<{ changedFiles: number; addedLines: number; deletedLines: number }>,
): SearchBenchReplayRun {
  return {
    replayId,
    profileId,
    commitId: commit.shortSha,
    outcome: replayOutcome(result),
    changedFiles: stats.changedFiles,
    addedLines: stats.addedLines,
    deletedLines: stats.deletedLines,
    elapsedMs: result.stats.elapsedMs,
    skipped: result.stats.skipped ?? false,
    skipReason: result.stats.skipReason,
    targets: result.stats.searchTargets ?? result.stats.candidates ?? 0,
    inputTokens: result.stats.inputTokens ?? 0,
    repomixPackedTokens: result.stats.repomixTokens,
    modelCalls: result.stats.modelCalls,
    matches: result.matches,
    matchesByPattern: countMatches(result.matches),
  };
}

function replayOutcome(result: SearchRunJson): SearchBenchReplayRun["outcome"] {
  if (result.stats.skipReason === "input_too_large") return "skipped_input_too_large";
  if (result.stats.skipReason === "no_candidates") return "no_candidates";
  if (result.matches.length > 0) return "ran_with_matches";
  return "ran_no_matches";
}

function replayErrorRun(
  replayId: string,
  profileId: string,
  commit: ReplayCommit,
  error: unknown,
): SearchBenchReplayRun {
  return {
    replayId,
    profileId,
    commitId: commit.shortSha,
    outcome: "error",
    changedFiles: 0,
    addedLines: 0,
    deletedLines: 0,
    elapsedMs: 0,
    skipped: true,
    skipReason: "error",
    targets: 0,
    inputTokens: 0,
    modelCalls: 0,
    matches: [],
    matchesByPattern: {},
    error: error instanceof Error ? error.message : String(error),
  };
}

async function runCli(cwd: string, args: readonly string[]): Promise<SearchRunJson> {
  const startedAt = Date.now();
  const cliPath = process.argv[1];
  if (!cliPath) throw new Error("Could not resolve current CLI entrypoint.");
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd,
    env: process.env,
    maxBuffer: 128 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as SearchRunJson;
  return {
    ...parsed,
    stats: {
      ...parsed.stats,
      elapsedMs: parsed.stats.elapsedMs || Date.now() - startedAt,
    },
  };
}

function resultToBenchRun(
  profileId: string,
  result: SearchRunJson,
  identity: Readonly<{ fixtureId?: string; smokeId?: string; expected?: readonly SearchFixtureExpectation[] }>,
): SearchBenchRun {
  return {
    profileId,
    fixtureId: identity.fixtureId,
    smokeId: identity.smokeId,
    elapsedMs: result.stats.elapsedMs,
    modelCalls: result.stats.modelCalls,
    patterns: result.patterns,
    targets: result.stats.searchTargets ?? result.stats.candidates ?? 0,
    targetsByPattern: result.stats.targetsByPattern ?? {},
    inputTokens: result.stats.inputTokens ?? 0,
    repomixPackedTokens: result.stats.repomixTokens,
    skipped: result.stats.skipped ?? false,
    skipReason: result.stats.skipReason,
    matches: result.matches,
    expected: identity.expected,
    targetsPreview: result.stats.targetsPreview ?? [],
    matchesUsingCounterReasonAsProof: countCounterReasonProofs(result.matches),
  };
}

function errorRun(
  profileId: string,
  identity: Readonly<{ fixtureId?: string; smokeId?: string; expected?: readonly SearchFixtureExpectation[] }>,
  error: unknown,
): SearchBenchRun {
  return {
    profileId,
    fixtureId: identity.fixtureId,
    smokeId: identity.smokeId,
    elapsedMs: 0,
    modelCalls: 0,
    patterns: [],
    targets: 0,
    targetsByPattern: {},
    inputTokens: 0,
    skipped: true,
    skipReason: "error",
    matches: [],
    expected: identity.expected,
    targetsPreview: [],
    matchesUsingCounterReasonAsProof: 0,
    score: identity.fixtureId ? -3 : -5,
    error: error instanceof Error ? error.message : String(error),
  };
}

function scoreFixtureRun(run: SearchBenchRun, expected: readonly SearchFixtureExpectation[]): number {
  const activePatterns = new Set(run.patterns.map((pattern) => pattern as string));
  const activeExpected = expected.filter((item) => activePatterns.has(item.patternId));
  let score = run.skipped && activeExpected.some((item) => item.shouldMatch) ? -3 : 0;
  const matchCounts = countMatches(run.matches);
  const expectedPatterns = new Set(activeExpected.map((item) => item.patternId));
  for (const item of activeExpected) {
    const matched = (matchCounts[item.patternId] ?? 0) > 0;
    if (item.shouldMatch && matched) score += 5;
    if (item.shouldMatch && !matched) score -= 4;
    if (!item.shouldMatch && !matched) score += 2;
    if (!item.shouldMatch && matched) score -= 10;
  }
  for (const match of run.matches) {
    const id = match.patternId as string;
    if (!expectedPatterns.has(id)) score -= 6;
  }
  score -= (run.elapsedMs / 1000) * 0.05;
  score -= (run.inputTokens / 1000) * 0.001;
  return round(score);
}

function scoreSmokeRun(run: SearchBenchRun): number {
  let score = 0;
  if (run.skipped) score -= 5;
  if (run.matches.length > 3) score -= 3;
  if (run.elapsedMs > 60_000) score -= 5;
  if (run.inputTokens > 12_000 && run.skipped) score -= 5;
  score -= (run.elapsedMs / 1000) * 0.05;
  score -= (run.inputTokens / 1000) * 0.001;
  return round(score);
}

function summarize(
  profiles: readonly SearchProfile[],
  runs: readonly SearchBenchRun[],
): readonly ProfileResult[] {
  const rows = profiles.map((profile) => {
    const fixtureRuns = runs.filter((run) => run.profileId === profile.id && run.fixtureId);
    const smokeRuns = runs.filter((run) => run.profileId === profile.id && run.smokeId);
    const counts = fixtureRuns.reduce((acc, run) => addFixtureCounts(acc, run), emptyCounts());
    const positiveFixtureCount = fixtureRuns
      .flatMap((run) => (run.expected ?? []).filter((item) => run.patterns.some((pattern) => pattern === item.patternId)))
      .filter((expected) => expected.shouldMatch).length;
    const avgMs = fixtureRuns.length === 0
      ? 0
      : fixtureRuns.reduce((sum, run) => sum + run.elapsedMs, 0) / fixtureRuns.length;
    const decision = decisionForProfile(counts, positiveFixtureCount, smokeRuns);
    return {
      profileId: profile.id,
      fixtureScore: round(fixtureRuns.reduce((sum, run) => sum + (run.score ?? 0), 0)),
      falsePositives: counts.fp,
      falseNegatives: counts.fn,
      truePositives: counts.tp,
      trueNegatives: counts.tn,
      wrongPatterns: counts.wp,
      assignedCheckFalsePositives: counts.assignedFp,
      avgMs: Math.round(avgMs),
      smokeMatches: smokeRuns.reduce((sum, run) => sum + run.matches.length, 0),
      smokeSkipped: smokeRuns.filter((run) => run.skipped).length,
      matchesUsingCounterReasonAsProof: fixtureRuns.reduce((sum, run) => sum + run.matchesUsingCounterReasonAsProof, 0),
      decision,
    };
  });
  return rows.sort((a, b) => b.fixtureScore - a.fixtureScore);
}

function summarizeByCheck(runs: readonly SearchBenchRun[]): readonly CheckResult[] {
  const counts = new Map<string, ReturnType<typeof emptyCounts>>();
  for (const run of runs.filter((item) => item.fixtureId)) {
    const expected = run.expected ?? [];
    const activePatterns = new Set(run.patterns.map((pattern) => pattern as string));
    const activeExpected = expected.filter((item) => activePatterns.has(item.patternId));
    for (const item of activeExpected) {
      const current = counts.get(item.patternId) ?? emptyCounts();
      const matched = run.matches.some((match) => match.patternId === item.patternId);
      if (item.shouldMatch && matched) current.tp += 1;
      if (item.shouldMatch && !matched) current.fn += 1;
      if (!item.shouldMatch && matched) {
        current.fp += 1;
        current.assignedFp += 1;
      }
      if (!item.shouldMatch && !matched) current.tn += 1;
      counts.set(item.patternId, current);
    }
    const expectedPatterns = new Set(activeExpected.map((item) => item.patternId));
    for (const match of run.matches) {
      const id = match.patternId as string;
      if (expectedPatterns.has(id)) continue;
      const current = counts.get(id) ?? emptyCounts();
      current.fp += 1;
      current.wp += 1;
      counts.set(id, current);
    }
  }
  return [...counts.entries()]
    .map(([checkId, count]) => ({
      checkId,
      truePositives: count.tp,
      falsePositives: count.fp,
      falseNegatives: count.fn,
      wrongPatterns: count.wp,
      assignedCheckFalsePositives: count.assignedFp,
      decision: checkDecision(count),
    }))
    .sort((a, b) => a.checkId.localeCompare(b.checkId));
}

function addFixtureCounts(counts: ReturnType<typeof emptyCounts>, run: SearchBenchRun): ReturnType<typeof emptyCounts> {
  const expected = run.expected ?? [];
  const activePatterns = new Set(run.patterns.map((pattern) => pattern as string));
  const activeExpected = expected.filter((item) => activePatterns.has(item.patternId));
  const matchCounts = countMatches(run.matches);
  const expectedPatterns = new Set(activeExpected.map((item) => item.patternId));
  for (const item of activeExpected) {
    const matched = (matchCounts[item.patternId] ?? 0) > 0;
    if (item.shouldMatch && matched) counts.tp += 1;
    if (item.shouldMatch && !matched) counts.fn += 1;
    if (!item.shouldMatch && !matched) counts.tn += 1;
    if (!item.shouldMatch && matched) {
      counts.fp += 1;
      counts.assignedFp += 1;
    }
  }
  for (const match of run.matches) {
    const id = match.patternId as string;
    if (!expectedPatterns.has(id)) {
      if (!expectedPatterns.has(id)) counts.fp += 1;
      counts.wp += 1;
    }
  }
  return counts;
}

function emptyCounts() {
  return { tp: 0, tn: 0, fp: 0, fn: 0, wp: 0, assignedFp: 0 };
}

function decisionForProfile(
  counts: ReturnType<typeof emptyCounts>,
  positiveFixtureCount: number,
  smokeRuns: readonly SearchBenchRun[],
): string {
  if (counts.fp > 0) return "reject: false positives";
  if (counts.wp > 0) return "reject: wrong pattern";
  if (counts.tp < Math.ceil(positiveFixtureCount * 0.6)) return "reject: low recall";
  if (smokeRuns.some((run) => run.matches.length > 3)) return "reject: noisy smoke";
  if (smokeRuns.some((run) => run.elapsedMs > 60_000)) return "reject: slow smoke";
  if (smokeRuns.some((run) => run.skipped)) return "fixture candidate";
  return "candidate hook default";
}

function checkDecision(counts: ReturnType<typeof emptyCounts>): string {
  if (counts.fp > 0) return "not search-safe";
  if (counts.tp === 0 && counts.fn > 0) return "blind";
  if (counts.fn > counts.tp) return "low recall";
  return "candidate";
}

function countMatches(matches: readonly SearchMatch[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const match of matches) counts[match.patternId] = (counts[match.patternId] ?? 0) + 1;
  return counts;
}

function countCounterReasonProofs(matches: readonly SearchMatch[]): number {
  return matches.filter((match) => /counter_reason/i.test(match.proof)).length;
}

function emptyReplayOutcomeCounts() {
  return {
    runs: 0,
    no_candidates: 0,
    ran_no_matches: 0,
    ran_with_matches: 0,
    skipped_input_too_large: 0,
    error: 0,
    matches: 0,
    modelCalls: 0,
    targets: 0,
  };
}

async function writeRunFiles(
  runsDir: string,
  id: string,
  run: SearchBenchRun,
  description: string,
): Promise<void> {
  const safeId = safeSegment(id);
  await writeFile(path.join(runsDir, `${safeId}.json`), JSON.stringify(run, null, 2));
  await writeFile(path.join(runsDir, `${safeId}.md`), renderRunMarkdown(run, description));
}

function renderRunMarkdown(run: SearchBenchRun, description: string): string {
  return `# ${run.fixtureId ?? run.smokeId}

Profile: ${run.profileId}
Description: ${description}
Runtime: ${run.elapsedMs}ms
Targets: ${run.targets}
Model calls: ${run.modelCalls}
Input tokens: ${run.inputTokens}
Counter-reason proofs: ${run.matchesUsingCounterReasonAsProof}
Skipped: ${run.skipped ? `${run.skipReason ?? "yes"}` : "no"}
Score: ${run.score ?? "n/a"}

## Matches
${run.matches.length === 0 ? "(none)" : run.matches.map((match, index) => `${index + 1}. ${match.patternId} (${match.targetId})
   reason: ${match.reason}
   proof: ${match.proof}`).join("\n")}

## Expected
${(run.expected ?? []).length === 0 ? "(none)" : (run.expected ?? []).map((expected) => `- ${expected.patternId}: ${expected.shouldMatch ? "match" : "no match"}`).join("\n")}

## Targets
${run.targetsPreview.length === 0 ? "(none)" : run.targetsPreview.map((target) => `- ${target.targetId}: ${target.patternId} ${target.entityKind ?? ""} ${target.sourceKind ?? ""}`.trim()).join("\n")}

${run.error ? `## Error\n${run.error}\n` : ""}`;
}

function renderLeaderboard(rows: readonly ProfileResult[], perCheck: readonly CheckResult[]): string {
  const table = rows.map((row, index) =>
    `| ${index + 1} | ${row.profileId} | ${row.fixtureScore} | ${row.falsePositives} | ${row.wrongPatterns} | ${row.assignedCheckFalsePositives} | ${row.falseNegatives} | ${row.truePositives} | ${row.matchesUsingCounterReasonAsProof} | ${row.avgMs} | ${row.smokeMatches} | ${row.smokeSkipped} | ${row.decision} |`
  ).join("\n");
  const checkTable = perCheck.map((row) =>
    `| ${row.checkId} | ${row.truePositives} | ${row.falsePositives} | ${row.wrongPatterns} | ${row.assignedCheckFalsePositives} | ${row.falseNegatives} | ${row.decision} |`
  ).join("\n");
  return `# Search Bench Leaderboard

| rank | profile | fixture score | FP | wrong FP | assigned FP | FN | TP | counter-proof | avg ms | smoke matches | smoke skipped | decision |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
${table}

## Per-Check Summary

| check | TP | FP | wrong FP | assigned FP | FN | decision |
|---|---:|---:|---:|---:|---:|---|
${checkTable}
`;
}

function renderReplayMarkdown(runs: readonly SearchBenchReplayRun[]): string {
  const table = runs.map((run) => {
    const patterns = Object.entries(run.matchesByPattern)
      .filter(([, count]) => count > 0)
      .map(([pattern, count]) => count === 1 ? pattern : `${pattern}(${count})`)
      .join(", ") || "-";
    return `| ${run.profileId} | ${run.commitId} | ${run.changedFiles} | +${run.addedLines}/-${run.deletedLines} | ${run.outcome} | ${run.elapsedMs} | ${run.targets} | ${run.inputTokens} | ${run.matches.length} | ${patterns} | |`;
  }).join("\n");
  const outcomeTable = renderReplayOutcomeSummary(runs);
  return `# Real Staged Replay

${outcomeTable}

| profile | commit | files | +/- | outcome | ms | targets | input tokens | matches | patterns | manual |
|---|---|---:|---:|---|---:|---:|---:|---:|---|---|
${table}
`;
}

function renderReplayReviewMarkdown(runs: readonly SearchBenchReplayRun[]): string {
  const matched = runs.filter((run) => run.matches.length > 0);
  if (matched.length === 0) return "# Real Replay Review\n\nNo real replay matches.\n";
  return `# Real Replay Review

${matched.flatMap((run) => run.matches.map((match) => `## ${run.profileId} / ${run.commitId}

Pattern: ${match.patternId}
Target: ${match.targetId}
Reason: ${match.reason}
Proof: ${match.proof}
Manual label: [good / maybe / bad]
Notes:
`)).join("\n")}`;
}

function renderReplayOutcomeSummary(runs: readonly SearchBenchReplayRun[]): string {
  const byProfile = new Map<string, ReturnType<typeof emptyReplayOutcomeCounts>>();
  for (const run of runs) {
    const current = byProfile.get(run.profileId) ?? emptyReplayOutcomeCounts();
    current.runs += 1;
    current[run.outcome] += 1;
    current.matches += run.matches.length;
    current.modelCalls += run.modelCalls;
    current.targets += run.targets;
    byProfile.set(run.profileId, current);
  }
  const table = [...byProfile.entries()].map(([profile, counts]) =>
    `| ${profile} | ${counts.runs} | ${counts.no_candidates} | ${counts.ran_no_matches} | ${counts.ran_with_matches} | ${counts.skipped_input_too_large} | ${counts.error} | ${counts.matches} | ${counts.modelCalls} | ${counts.targets} |`
  ).join("\n");
  return `## Outcome Summary

| profile | runs | no candidates | ran no matches | ran with matches | input too large | errors | matches | model calls | targets |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${table}`;
}

async function resolveProfilePaths(profilePaths: readonly string[], configDir: string): Promise<readonly string[]> {
  return Promise.all(profilePaths.map((profilePath) => resolvePath(profilePath, configDir)));
}

async function resolveGlob(pattern: string, configDir: string): Promise<readonly string[]> {
  const resolved = await resolvePath(pattern, configDir, false);
  if (!resolved.includes("*")) return [resolved];
  const before = resolved.slice(0, resolved.indexOf("*"));
  const after = resolved.slice(resolved.indexOf("*") + 1);
  const dir = before.endsWith(path.sep) ? before.slice(0, -1) : path.dirname(before);
  const prefix = before.endsWith(path.sep) ? "" : path.basename(before);
  const entries = await readdir(dir);
  return entries
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(after))
    .map((entry) => path.join(dir, entry))
    .sort();
}

async function resolvePath(input: string, configDir: string, mustExist = true): Promise<string> {
  const expanded = input.startsWith("~/") ? path.join(process.env.HOME ?? "", input.slice(2)) : input;
  const fromCwd = path.resolve(expanded);
  const fromConfig = path.resolve(configDir, expanded);
  if (!mustExist || await exists(fromCwd)) return fromCwd;
  if (await exists(fromConfig)) return fromConfig;
  return fromCwd;
}

async function readProfile(filePath: string): Promise<Readonly<{ filePath: string; profile: SearchProfile }>> {
  const profile = JSON.parse(await readFile(filePath, "utf8")) as SearchProfile;
  if (!profile.id) throw new Error(`Search profile missing id: ${filePath}`);
  return { filePath, profile };
}

async function readFixture(filePath: string): Promise<Readonly<{ filePath: string; fixture: SearchFixture }>> {
  const fixture = JSON.parse(await readFile(filePath, "utf8")) as SearchFixture;
  if (!fixture.id) throw new Error(`Search fixture missing id: ${filePath}`);
  return { filePath, fixture };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveSmokeCwd(cwd: string | undefined): string | null {
  if (!cwd) return process.cwd();
  if (cwd === "$BEVYL_REPO") return process.env.BEVYL_REPO ?? null;
  if (cwd.startsWith("$BEVYL_REPO/")) {
    const root = process.env.BEVYL_REPO;
    return root ? path.join(root, cwd.slice("$BEVYL_REPO/".length)) : null;
  }
  return cwd.startsWith("~/") ? path.join(process.env.HOME ?? "", cwd.slice(2)) : cwd;
}

function resolveReplayCwd(replay: SearchBenchCommitReplay): string | null {
  if (replay.cwd) return expandPath(replay.cwd);
  if (replay.repoEnv) {
    const value = process.env[replay.repoEnv];
    return value ? expandPath(value) : null;
  }
  return process.cwd();
}

function expandPath(input: string): string {
  return input.startsWith("~/") ? path.join(process.env.HOME ?? "", input.slice(2)) : input;
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "run";
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function numericStat(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
