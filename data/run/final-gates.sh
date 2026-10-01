#!/usr/bin/env bash
# All required gates in one run. Prints a compact verdict per gate.
set -uo pipefail
REPO=/mnt/e/1project/anatomical-symptom-interface-design
cd "$REPO"
EV="$REPO/data/design-phase1-evidence"
TOOLS="$HOME/.cache/asi-design-tools"

export PLAYWRIGHT_MODULE="$TOOLS/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/index.mjs"
export AXE_MODULE="$TOOLS/node_modules/@axe-core/playwright/dist/index.js"
export CHROMIUM_PATH="$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"
export ASI_WEB_URL=http://127.0.0.1:5189
export ASI_SCREENSHOTS="$EV"
export ASI_BASE=http://127.0.0.1:8787
mkdir -p "$EV"
fails=0

run() {
  local name=$1; shift
  echo "########## $name ##########"
  if "$@" >"$EV/last-$name.txt" 2>&1; then
    echo "-> $name OK"
  else
    echo "-> $name FAILED"
    tail -25 "$EV/last-$name.txt"
    fails=$((fails+1))
  fi
}

run typecheck   pnpm typecheck
run test        pnpm test
run build       pnpm --filter @asi/web build
run smoke       node scripts/smoke.mjs
run safetymeta  node scripts/check-safety-metadata.mjs "$EV/health.json"
run browser     node apps/web/test/browser.mjs
run a11y        node apps/web/test/accessibility.mjs
run hitzones    node apps/web/test/hit-zones.mjs
run three3d     node apps/web/test/three3d.mjs
run fallback    node apps/web/test/fallback.mjs
run urlglb      node apps/web/test/url-geometry-browser.mjs

echo
echo "=== test counts ==="
grep -E 'ℹ (tests|pass|fail)' "$EV/last-test.txt" 2>/dev/null || true
echo
echo "################ TOTAL FAILURES: $fails ################"
exit $((fails > 0))
