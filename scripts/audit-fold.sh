#!/usr/bin/env bash
# Run the fold/overflow measurement against a running app.
#
#   bash scripts/audit-serve.sh --fresh --check-fresh
#   bash scripts/audit-fold.sh
set -uo pipefail

SOURCE=${BASH_SOURCE[0]}
while [ -L "$SOURCE" ]; do
  DIR=$(cd -P "$(dirname "$SOURCE")" && pwd)
  SOURCE=$(readlink "$SOURCE")
  [[ $SOURCE != /* ]] && SOURCE=$DIR/$SOURCE
done
cd "$(cd -P "$(dirname "$SOURCE")/.." && pwd)" || exit 1

TOOLS=${ASI_GATE_TOOLS:-$HOME/.cache/asi-gate-tools}
export PLAYWRIGHT_MODULE="$TOOLS/node_modules/playwright-core/index.mjs"
export CHROMIUM_PATH=${ASI_GATE_CHROMIUM:-$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome}
export ASI_WEB_URL=${ASI_WEB_URL:-http://127.0.0.1:5277}

node scripts/audit-fold.mjs
