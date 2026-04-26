import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli, type CliOptions } from "repomix";
import type { ProjectedChange } from "./change-projector.ts";
import type { ChangeArtifact } from "./types.ts";

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
  const configPath = path.join(tempDir, "repomix.config.json");
  await writeFile(configPath, "{}\n");

  const options: CliOptions = {
    config: configPath,
    output: outputPath,
    style: "xml",
    // Preserve implementation bodies for diff judgment; compression is too lossy for this audit.
    compress: false,
    outputShowLineNumbers: true,
    includeDiffs: true,
    truncateBase64: true,
    quiet: true,
  };

  try {
    await runCli(["."], rootDir, options);
    return await readFile(outputPath, "utf8");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
