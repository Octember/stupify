import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli, type CliOptions } from "repomix";
import type { ProjectedChange } from "./change-projector.js";
import type { ChangeArtifact } from "./types.js";

export async function artifactFromProjectedChange(change: ProjectedChange): Promise<ChangeArtifact> {
  const serialized = await repomix(change.tempDir);
  return {
    id: change.id,
    label: change.label,
    text: `TARGET CHANGE
Base: ${change.base}
Target: ${change.target}
Commits:
${change.logs || "(none)"}

REPOMIX OUTPUT:
${serialized}`,
  };
}

async function repomix(rootDir: string): Promise<string> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "stupify-repomix-"));
  const outputPath = path.join(tempDir, "repomix-output.xml");
  const options: CliOptions = {
    output: outputPath,
    style: "xml",
    compress: true,
    outputShowLineNumbers: true,
    includeDiffs: true,
    quiet: true,
  };

  try {
    await runCli(["."], rootDir, options);
    return await readFile(outputPath, "utf8");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
