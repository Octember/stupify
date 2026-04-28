import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { hookSnippet, runHookCommand } from "../src/operator/hooks.ts";

test("hook install creates, status detects, and uninstall removes the managed hook", async () => {
  await withTempGitRepo(async (repo) => {
    const hookPath = path.join(repo, ".git", "hooks", "pre-commit");

    assert.equal(await runHookCommand("status"), "Stupify hook: not installed");
    assert.equal(await runHookCommand("install"), "Stupify hook: installed");
    assert.equal(await runHookCommand("status"), "Stupify hook: installed");
    assert.match(readFileSync(hookPath, "utf8"), /stupify --staged \|\| true/);

    assert.equal(await runHookCommand("uninstall"), "Stupify hook: uninstalled");
    assert.equal(existsSync(hookPath), false);
  });
});

test("hook install updates an existing Stupify-managed block", async () => {
  await withTempGitRepo(async (repo) => {
    const hookPath = path.join(repo, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, `#!/bin/sh\n# stupify hook start\nold command\n# stupify hook end\n`, "utf8");

    assert.equal(await runHookCommand("install"), "Stupify hook: updated");
    assert.equal(readFileSync(hookPath, "utf8"), `#!/bin/sh\n${hookSnippet()}\n`);
  });
});

test("hook install does not overwrite a non-Stupify hook", async () => {
  await withTempGitRepo(async (repo) => {
    const hookPath = path.join(repo, ".git", "hooks", "pre-commit");
    const original = "#!/bin/sh\necho custom\n";
    writeFileSync(hookPath, original, "utf8");

    const result = await runHookCommand("install");

    assert.match(result, /existing non-Stupify pre-commit hook found/);
    assert.equal(readFileSync(hookPath, "utf8"), original);
  });
});

test("hook uninstall removes only the managed block", async () => {
  await withTempGitRepo(async (repo) => {
    const hookPath = path.join(repo, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, `#!/bin/sh\necho before\n${hookSnippet()}\necho after\n`, "utf8");

    assert.equal(await runHookCommand("uninstall"), "Stupify hook: uninstalled");
    assert.equal(readFileSync(hookPath, "utf8"), "#!/bin/sh\necho before\n\necho after\n");
  });
});

async function withTempGitRepo(run: (repo: string) => Promise<void>): Promise<void> {
  const previous = process.cwd();
  const repo = mkdtempSync(path.join(tmpdir(), "stupify-hook-"));
  try {
    execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
    process.chdir(repo);
    await run(repo);
  } finally {
    process.chdir(previous);
    rmSync(repo, { recursive: true, force: true });
  }
}
