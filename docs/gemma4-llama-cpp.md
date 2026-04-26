# Gemma 4 llama.cpp Setup

Stupify's default runtime is `node-llama-cpp`. As of `node-llama-cpp@3.18.1`,
that bundled runtime cannot load Gemma 4 GGUF files:

```text
unknown model architecture: 'gemma4'
```

Until the Node binding catches up, use a sidecar `llama.cpp` binary for Gemma 4
experiments.

## Install llama.cpp

On macOS:

```sh
brew install llama.cpp
```

Verify:

```sh
llama-server --version
llama-cli --version
```

The tested local version was:

```text
llama.cpp b8940
```

## Download the test model

The tested file was the smallest useful Gemma 4 26B A4B GGUF quant from Unsloth:

```text
unsloth/gemma-4-26B-A4B-it-GGUF
gemma-4-26B-A4B-it-UD-IQ2_XXS.gguf
```

Download it into Stupify's model cache:

```sh
mkdir -p "$HOME/Library/Caches/stupify/models"

curl -L --fail \
  "https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/resolve/main/gemma-4-26B-A4B-it-UD-IQ2_XXS.gguf?download=true" \
  -o "$HOME/Library/Caches/stupify/models/gemma-4-26b-a4b-it-ud-iq2_xxs.gguf"
```

Expected local size:

```text
9.2G
```

The Q4/MXFP4 variants are much larger, roughly 16-17GB.

## Smoke Test

Run a non-interactive hello-world:

```sh
llama-cli \
  -m "$HOME/Library/Caches/stupify/models/gemma-4-26b-a4b-it-ud-iq2_xxs.gguf" \
  -p 'Return JSON only: {"ok": true, "message": "hello"}' \
  -n 80 \
  -c 4096 \
  --temp 0.5 \
  --no-display-prompt \
  --single-turn \
  --reasoning off \
  --no-warmup
```

Expected output:

```json
{"ok": true, "message": "hello"}
```

## Stupify POC Test

This is not wired into the CLI yet. To test Gemma 4 against Stupify's current
prompt, generate a prompt file from the existing modules and pass it to
`llama-cli`:

```sh
PROMPT_FILE=$(mktemp /tmp/stupify-gemma4-prompt.XXXXXX)

node --eval "
const out = process.argv[1];
const { projectionForCommit } = await import('./packages/cli/dist/git.js');
const { projectChange } = await import('./packages/cli/dist/change-projector.js');
const { artifactFromProjectedChange } = await import('./packages/cli/dist/repomix-adapter.js');
const { enabledChecks } = await import('./packages/cli/dist/checks.js');
const { findingsPrompt } = await import('./packages/cli/dist/prompts.js');
const fs = await import('node:fs/promises');

const projection = await projectionForCommit('873046a');
const projected = await projectChange(projection);
try {
  const artifact = await artifactFromProjectedChange(projected);
  const prompt = findingsPrompt(
    { id: 'change-001', artifacts: [artifact] },
    enabledChecks(['duplicated_schema']),
  );
  await fs.writeFile(out, prompt);
  console.error({ promptChars: prompt.length, artifactChars: artifact.text.length });
} finally {
  await projected.cleanup();
}
" "$PROMPT_FILE"

llama-cli \
  -m "$HOME/Library/Caches/stupify/models/gemma-4-26b-a4b-it-ud-iq2_xxs.gguf" \
  -f "$PROMPT_FILE" \
  -n 220 \
  -c 32768 \
  --temp 0.5 \
  --no-display-prompt \
  --single-turn \
  --reasoning off \
  --no-warmup
```

Observed result on the known duplicated-schema POC:

```json
{
  "checks": [
    {
      "sourceId": "873046a",
      "checkId": "duplicated_schema",
      "matched": true,
      "why": "The function toShareCardPayload maps fields one-for-one from a FindingsResult into a new ShareCardPayload type with identical property names.",
      "proof": "packages/cli/src/share-card.ts-hunk-1"
    }
  ]
}
```

Observed timing:

```text
real 20.74s
Prompt: 446.3 t/s
Generation: 37.7 t/s
```

## Current Product Decision

Do not make Gemma 4 the default yet.

It needs a second runtime path because `node-llama-cpp` cannot load `gemma4`.
The likely future shape is:

```text
default: node-llama-cpp + qwen2.5-coder-1.5b
experimental: external llama.cpp binary + Gemma 4
```

That keeps the default CLI simple while preserving a path for higher-quality
local judgments.
