#!/usr/bin/env bash
# First boot of a stupify reviewer VM on exe.dev (hand it to `ssh exe.dev new --setup-script`): keyless codex via
# the exe-llm gateway, bun, and the state dir. The engine, config.env, and the cron arrive with deploy/push.sh.
set -e
export PATH="$HOME/.bun/bin:/usr/local/bin:$PATH"
mkdir -p "$HOME/.codex" "$HOME/.stupify/state"

# Keyless codex: the `llm` integration fronts a ChatGPT plan, so the box holds no API key. Left alone if a
# provider is already configured (codex writes its own trust entries here between runs).
if ! grep -q model_provider "$HOME/.codex/config.toml" 2>/dev/null; then
  cat > "$HOME/.codex/config.toml" <<EOF
model_provider = "exe-llm"

[model_providers.exe-llm]
name = "exe-llm"
base_url = "https://llm.int.exe.xyz/v1"
requires_openai_auth = false

[projects."$HOME/.stupify/repo"]
trust_level = "trusted"

[projects."$HOME/.stupify/worktrees"]
trust_level = "trusted"
EOF
fi

command -v bun >/dev/null 2>&1 || curl -fsSL https://bun.sh/install | bash

echo "stupify vm-setup done"
