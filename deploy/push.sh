#!/usr/bin/env bash
# Build the engine and put it on a reviewer VM. The minute cron runs the new bundle on its next tick; nothing
# restarts. A first push also writes config.env and installs the cron. GH_HOST rides on the cron line, not in
# config.env: gh reads it from the environment, and a Bun process can't hand a runtime env write to a child.
#   deploy/push.sh stupify-acme-widgets                                            # update the engine
#   deploy/push.sh stupify-acme-widgets acme/widgets stupify-acme-widgets.int.exe.xyz   # first push
set -euo pipefail
vm="${1:?usage: deploy/push.sh <vm> [owner/repo <github-integration>.int.exe.xyz]}"
host="$vm.exe.xyz"
bun build src/review-sweep.ts --target=bun --format=esm --outfile=dist/review-sweep.ts
scp -q dist/review-sweep.ts "$host:/tmp/review-sweep.new.ts"
if [ $# -ge 3 ]; then
  ssh "$host" "printf 'REPO_SLUG=%s\n' '$2' > \"\$HOME/.stupify/config.env\" && (crontab -l 2>/dev/null | grep -v review-sweep.ts || true; echo \"*/1 * * * * GH_HOST=$3 \$HOME/.bun/bin/bun \$HOME/.stupify/review-sweep.ts >> \$HOME/.stupify/state/cron.log 2>&1\") | crontab -"
fi
ssh "$host" 'chmod +x /tmp/review-sweep.new.ts && mv /tmp/review-sweep.new.ts "$HOME/.stupify/review-sweep.ts"'
echo "pushed $(shasum dist/review-sweep.ts | cut -c1-8) to $vm"
