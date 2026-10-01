#!/usr/bin/env bash
# Every gate that must pass before Phase 1A is called done, in one run.
#
# WHY THIS IS A REPO TOOL AND NOT A LOCAL SCRIPT. It used to live at
# data/run/final-gates.sh, which is inside a gitignored directory, hardcoded to one
# absolute checkout path, and run 11 gates while its own report said 12. A gate
# you cannot reproduce is a gate you cannot rely on, and a report that overstates
# what ran is worse than no report. So: it lives in scripts/, resolves its own
# repo root, starts the servers it needs, and reports PASS / FAIL / SKIP per gate
# with the reason for every skip.
#
# LOCATION INDEPENDENT. The root comes from this script's own path, so the repo
# can be cloned anywhere -- including a Windows /mnt/<drive> mount, where the old
# hardcoded /mnt/e path was simply wrong.
#
#   bash scripts/final-gates.sh              # all gates
#   bash scripts/final-gates.sh unit smoke   # just these
#
# Exit code is 0 only when nothing FAILED and nothing was SKIPPED for want of
# tooling. A skip is reported as a failure of the run, because "the browser gate
# did not run" and "the browser gate passed" must never look the same in a CI log.
set -uo pipefail

# --- resolve the repo root from this file, following symlinks -----------------
SOURCE=${BASH_SOURCE[0]}
while [ -L "$SOURCE" ]; do
  DIR=$(cd -P "$(dirname "$SOURCE")" && pwd)
  SOURCE=$(readlink "$SOURCE")
  [[ $SOURCE != /* ]] && SOURCE=$DIR/$SOURCE
done
REPO=$(cd -P "$(dirname "$SOURCE")/.." && pwd)
cd "$REPO"

# --- ports. Distinct per process so two runs cannot cross-talk. ----------------
API_PORT=${ASI_GATE_API_PORT:-8799}
WEB_PORT=${ASI_GATE_WEB_PORT:-5199}
BASE="http://127.0.0.1:$API_PORT"
WEB_URL="http://127.0.0.1:$WEB_PORT"

# A scratch database, always deleted: a gate run must never touch real health data,
# and `data/` is gitignored precisely because that is where it would otherwise go.
WORK=$(mktemp -d "${TMPDIR:-/tmp}/asi-gates-XXXXXX")
DB="$WORK/gates.sqlite"
EVIDENCE="$WORK/evidence"
mkdir -p "$EVIDENCE"

# --- browser-gate tooling ------------------------------------------------------
# playwright-core and a chromium build are large and are not a repo dependency.
# If they are absent the browser gates are SKIPPED with a reason, never quietly
# passed and never silently dropped from the count.
TOOLS=${ASI_GATE_TOOLS:-$HOME/.cache/asi-gate-tools}
export PLAYWRIGHT_MODULE="$TOOLS/node_modules/playwright-core/index.mjs"
export AXE_MODULE="$TOOLS/node_modules/@axe-core/playwright/dist/index.js"
export CHROMIUM_PATH=${ASI_GATE_CHROMIUM:-$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome}
export ASI_WEB_URL="$WEB_URL"
export ASI_BASE="$BASE"
export ASI_SCREENSHOTS="$EVIDENCE"

declare -a PASSED=() FAILED=() SKIPPED=()
fails=0

# Optional gate selection: `bash scripts/final-gates.sh unit smoke adapter`.
# Filtering matters here because the full set boots a browser and a server, and
# bisecting a hang needs to be able to run one gate at a time. WITH_GATES="-"
# means "no filter", so an explicit `-` still runs everything.
ONLY_GATES=("-")
if [ "$#" -gt 0 ]; then
  case "$1" in
    -*) ;;
    *) ONLY_GATES=("$@") ;;
  esac
fi

wants() {
  local name=$1 i
  for i in "${ONLY_GATES[@]}"; do
    [ "$i" = "-" ] && return 0
    [ "$i" = "$name" ] && return 0
  done
  return 1
}

have_browser_tooling() {
  [ -f "$PLAYWRIGHT_MODULE" ] && [ -f "$CHROMIUM_PATH" ] && [ -f "$AXE_MODULE" ]
}

# --- the servers ---------------------------------------------------------------
# Each server is started with `setsid`, so it becomes its own process-group leader
# and the whole tree (npx -> node -> nothing) can be killed as a group. Killing
# only the recorded PID would orphan the node child, leave the port bound, and make
# the NEXT run talk to a dead run's server.
api_pgid=""
web_pgid=""

kill_group() {
  local pgid=$1
  [ -n "$pgid" ] || return 0
  kill -9 -- "-$pgid" 2>/dev/null
  kill -9 "$pgid" 2>/dev/null
  return 0
}

cleanup() {
  local code=$?
  kill_group "$web_pgid"
  kill_group "$api_pgid"
  # Belt and braces: anything still holding either port goes, whatever its parent.
  for p in "$WEB_PORT" "$API_PORT"; do
    pids=$(ss -lptnH "sport = :$p" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u)
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null
  done
  wait 2>/dev/null
  # The scratch DATABASE is always deleted: it is health-shaped data and it is in
  # a temp dir. The evidence logs are kept when something failed, because "the
  # a11y gate failed" with no output is a report nobody can act on.
  if [ "$code" -ne 0 ] || [ "$fails" -gt 0 ] || [ "${#SKIPPED[@]}" -gt 0 ]; then
    echo
    echo "gate output kept in: $EVIDENCE"
  else
    rm -rf "$WORK"
  fi
  return $code
}
trap cleanup EXIT INT TERM

wait_for() {
  local url=$1 name=$2 tries=${3:-120}
  for _ in $(seq 1 "$tries"); do
    curl -sf -o /dev/null "$url" && return 0
    sleep 0.5
  done
  echo "  !! $name never became ready at $url" >&2
  return 1
}

start_servers() {
  # A stale server from an earlier run would answer /api/health and make this run
  # believe it passed against somebody else's process. Killing by PORT, because a
  # cmdline pattern does not reliably match a detached `npx tsx` child.
  for p in "$API_PORT" "$WEB_PORT"; do
    pids=$(ss -lptnH "sport = :$p" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u)
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null
  done
  sleep 1

  # `setsid` makes the child a process-group leader, so cleanup can kill the tree
  # rather than leaving an orphan node holding the port.
  ( cd packages/server && ASI_DB_PATH="$DB" ASI_PORT="$API_PORT" \
      ASI_RELEASE_PROFILE=development ANTHROPIC_API_KEY='' \
      setsid npx tsx src/index.ts >"$WORK/api.log" 2>&1 & echo $! >"$WORK/api.pgid" )
  api_pgid=$(cat "$WORK/api.pgid" 2>/dev/null)
  wait_for "$BASE/api/health" api || return 1

  # Seed the scratch database, or every history-shaped gate fails for the boring
  # reason that there is no history. It runs against $DB, never against a real
  # file, which is why this script mktemps its own and deletes it on exit.
  #
  # The old runner assumed somebody had already seeded whatever server it found,
  # which is why "38 smoke checks" could be reported against an empty database.
  echo "  seeding the scratch database"
  ( cd packages/server && ASI_DB_PATH="$DB" npx tsx src/db/seed.ts ) >"$WORK/seed.log" 2>&1 || {
    echo "  !! seed failed:" >&2
    tail -20 "$WORK/seed.log" >&2
    return 1
  }

  # The dev server's /api proxy must point at THIS run's API. The vite config
  # reads it, and its own default is the normal 8787, so a gate run that forgot
  # this would talk to whatever happened to be on 8787 -- or to nothing.
  ( cd apps/web && ASI_WEB_PORT="$WEB_PORT" ASI_API_ORIGIN="$BASE" \
      setsid npx vite --port "$WEB_PORT" --strictPort \
      >"$WORK/web.log" 2>&1 & echo $! >"$WORK/web.pgid" )
  web_pgid=$(cat "$WORK/web.pgid" 2>/dev/null)
  wait_for "$WEB_URL" web || return 1
  return 0
}

# --- gate runner ---------------------------------------------------------------
run() {
  local name=$1; shift
  local needs_api="${NEEDS_API:-0}" needs_web="${NEEDS_WEB:-0}"
  if ! wants "$name"; then
    # Not counted at all: a gate that was never asked for has neither passed nor
    # been skipped, and saying otherwise would make a filtered run's summary lie.
    return 0
  fi
  echo "########## $name ##########"
  if [ "$needs_api" = "1" ] && ! curl -sf -o /dev/null "$BASE/api/health"; then
    echo "-> $name SKIPPED (no API)"; SKIPPED+=("$name: no API"); return 0
  fi
  if [ "$needs_web" = "1" ] && ! curl -sf -o /dev/null "$WEB_URL"; then
    echo "-> $name SKIPPED (no web server)"; SKIPPED+=("$name: no web server"); return 0
  fi
  if [ "$needs_web" = "1" ] && ! have_browser_tooling; then
    echo "-> $name SKIPPED (no playwright-core/chromium; see scripts/final-gates.sh)"
    SKIPPED+=("$name: browser tooling absent")
    return 0
  fi
  if "$@" >"$EVIDENCE/last-$name.txt" 2>&1; then
    echo "-> $name PASS"; PASSED+=("$name")
  else
    echo "-> $name FAIL"; FAILED+=("$name")
    tail -25 "$EVIDENCE/last-$name.txt"
    fails=$((fails + 1))
  fi
}

# ============================================================================
# The gate set.
# ============================================================================

# --- no server needed ---
run typecheck   pnpm typecheck
run unit        pnpm test
run build       pnpm --filter @asi/web build

# --- from here the API is needed, so it is started and torn down with the run ---
# The no-server gates above run first on purpose: a broken typecheck should not
# be reported alongside six browser timeouts.
if [ "${#ONLY_GATES[@]}" -gt 1 ] || { [ "${#ONLY_GATES[@]}" -eq 1 ] && [ "${ONLY_GATES[0]}" != "-" ]; }; then
  start_servers
else
  if ! start_servers; then
    echo "!! servers did not start; every API gate will be reported as SKIPPED" >&2
    tail -20 "$WORK/api.log" 2>/dev/null
    tail -20 "$WORK/web.log" 2>/dev/null
  fi
fi
NEEDS_API=1
run smoke           node scripts/smoke.mjs
run releasegate     node scripts/check-release-gate.mjs

# The safety-metadata gate reads a health document, so it is FED one rather than
# pointed at a path that has to exist first. The old runner passed
# "$EV/health.json" and nothing had written it, which is the kind of gate that
# passes because its input was empty.
echo "########## safetymeta ##########"
if ! wants safetymeta; then
  :
else
curl -sf "$BASE/api/health" -o "$EVIDENCE/health.json"
if node scripts/check-safety-metadata.mjs "$EVIDENCE/health.json" >"$EVIDENCE/last-safetymeta.txt" 2>&1; then
  echo "-> safetymeta PASS"; PASSED+=("safetymeta")
else
  echo "-> safetymeta FAIL"; FAILED+=("safetymeta")
  tail -25 "$EVIDENCE/last-safetymeta.txt"; fails=$((fails + 1))
fi
fi

# --- targeted suites that the umbrella `unit` run also covers, run separately so
#     a failure names the concern instead of a file ---
run migrations   node --experimental-strip-types --no-warnings --test packages/server/test/migrations.test.ts
run placeid      node --experimental-strip-types --no-warnings --test packages/server/test/spatial-history.test.ts
run reopen       node --experimental-strip-types --no-warnings --test packages/server/test/episode-reopen.test.ts
run adapter      node --experimental-strip-types --no-warnings --test apps/web/test/asset-scene-adapter.test.ts
run lateurl      node --experimental-strip-types --no-warnings --test apps/web/test/timeout-late-resolve.test.ts
run urlglbunit   node --experimental-strip-types --no-warnings --test apps/web/test/url-geometry.test.ts
run viewernodes  node --experimental-strip-types --no-warnings --test apps/web/test/viewer-projection.test.ts

# --- needs the API and the web server ---
NEEDS_API=1 NEEDS_WEB=1
run browser     node apps/web/test/browser.mjs
run a11y        node apps/web/test/accessibility.mjs
run hitzones    node apps/web/test/hit-zones.mjs
run three3d     node apps/web/test/three3d.mjs
run fallback    node apps/web/test/fallback.mjs
run urlglb      node apps/web/test/url-geometry-browser.mjs
# The gate the old runner omitted from its own report.
run evidence    node apps/web/test/evidence.mjs

# ============================================================================
echo
echo "=== per-package test counts ==="
grep -hE 'ℹ (tests|pass|fail)' "$EVIDENCE/last-unit.txt" 2>/dev/null || true
echo
echo "=== gates ==="
for g in "${PASSED[@]:-}"; do [ -n "$g" ] && echo "  PASS    $g"; done
for g in "${FAILED[@]:-}"; do [ -n "$g" ] && echo "  FAIL    $g"; done
for g in "${SKIPPED[@]:-}"; do [ -n "$g" ] && echo "  SKIP    $g"; done
echo
echo "  passed ${#PASSED[@]}  failed ${#FAILED[@]}  skipped ${#SKIPPED[@]}"
echo
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  echo "### INCOMPLETE: ${#SKIPPED[@]} gate(s) skipped. Treat this run as failed. ###"
fi
echo "################ TOTAL FAILURES: $fails ################"
[ "$fails" -gt 0 ] && exit 1
[ "${#SKIPPED[@]}" -gt 0 ] && exit 1
exit 0