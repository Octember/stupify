# Gemma 4 llama.cpp Setup

Stupify's local runtime is `llama-server`. The CLI talks to its
OpenAI-compatible localhost API for every model, including Qwen and Gemma. This
keeps one paved road for inference and lets the model stay loaded between CLI
runs.

Stupify asks the managed server for a 65k context window where the model
supports it. The diff flow still uses small fixed line batches instead of custom
prompt-size accounting.

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

## Stupify POC Test

Run Gemma 4 through Stupify:

```sh
stupify --commit 873046a --checks duplicated_schema --model gemma-4-e4b
```

For lower-level debugging, print the prompts Stupify sends to `llama-server`:

```sh
STUPIFY_DEBUG_PROMPT=1 STUPIFY_DEBUG_MODEL=1 \
  stupify --commit 873046a --checks duplicated_schema --model gemma-4-e4b
```

Observed result on the known duplicated-schema POC:

```json
{
  "findings": [
    {
      "checkId": "duplicated_schema",
      "why": "The change adds a local payload type and mapper that copy fields from an imported result shape.",
      "proof": "batch-001:file-002:hunk-001"
    }
  ],
  "summary": "One duplicated-schema pattern was found."
}
```

## Current Product Decision

Keep Qwen 1.5B as the default because it is cheap and fast. Use Gemma 4 E4B as
the higher-quality local model:

```text
default: qwen2.5-coder-1.5b
quality: gemma-4-e4b
fast Gemma: gemma-4-e2b
```
