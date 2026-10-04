#!/usr/bin/env bash
# Start the app for the design audit, on its own ports.
#
#   bash scripts/audit-serve.sh [--fresh] [--check-fresh]
#
#   --fresh        delete the scratch DB and re-seed it
#   --check-fresh  prove the module being SERVED is the module on disk
#
# The two processes are started directly rather than through `pnpm dev`. The
# wrapper adds a parent that survives a kill of its children, so a later run can
# end up talking to the previous run's server — which is how an audit ends up
# reporting defects that were already fixed. `strictPort` is on, so a port that
# cannot be taken is an error rather than a silent move to the next one.
#
# The freshness check is not decoration. /mnt/e does not emit inotify events, so
# Vite keeps serving a stale transform cache after an edit. Bytes cannot be
# compared (Vite serves esbuild output, not the file), but string literals do
# survive the transform, and a stale cache is precisely a module missing the
# literals an edit just added.
set -uo pipefail

SOURCE=${BASH_SOURCE[0]}
while [ -L "$SOURCE" ]; do
  DIR=$(cd -P "$(dirname "$SOURCE")" && pwd)
  SOURCE=$(readlink "$SOURCE")
  [[ $SOURCE != /* ]] && SOURCE=$DIR/$SOURCE
done
REPO=$(cd -P "$(dirname "$SOURCE")/.." && pwd)
cd "$REPO" || exit 1

API_PORT=${ASI_AUDIT_API_PORT:-8877}
WEB_PORT=${ASI_AUDIT_WEB_PORT:-5277}
DB=${ASI_AUDIT_DB:-/tmp/asi-audit.sqlite}
LOGDIR=${ASI_AUDIT_LOGDIR:-/tmp/asi-audit}
mkdir -p "$LOGDIR"

pids_on() { ss -tlnpH "sport = :$1" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u; }

free_port() {
  local port=$1 pids
  for p in $(pids_on "$port"); do kill -9 "$p" 2>/dev/null; done
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -z "$(pids_on "$port")" ] && return 0
    sleep 1
  done
  printf 'port %s is still held by: %s\n' "$port" "$(pids_on "$port" | tr '\n' ' ')" >&2
  return 1
}

free_port "$API_PORT" || exit 1
free_port "$WEB_PORT" || exit 1

if [ "${1:-}" = "--fresh" ]; then
  rm -f "$DB"
  ( cd packages/server && ASI_DB_PATH="$DB" npx tsx src/db/seed.ts ) >"$LOGDIR/seed.log" 2>&1 || {
    echo "!! seed failed:" >&2
    tail -20 "$LOGDIR/seed.log" >&2
    exit 1
  }
  echo "seeded $DB"
fi

rm -rf apps/web/node_modules/.vite

(
  cd packages/server && ASI_DB_PATH="$DB" ASI_PORT="$API_PORT" \
    ASI_RELEASE_PROFILE=development ANTHROPIC_API_KEY='' \
    setsid npx tsx src/index.ts >"$LOGDIR/api.log" 2>&1 < /dev/null &
  echo $! >"$LOGDIR/api.pgid"
)
(
  cd apps/web && ASI_WEB_PORT="$WEB_PORT" ASI_API_ORIGIN="http://127.0.0.1:$API_PORT" \
    setsid npx vite >"$LOGDIR/web.log" 2>&1 < /dev/null &
  echo $! >"$LOGDIR/web.pgid"
)

ready=0
for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/api/health" 2>/dev/null &&
    curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" != "1" ]; then
  echo "!! the audit app did not come up" >&2
  tail -20 "$LOGDIR/api.log" >&2
  tail -20 "$LOGDIR/web.log" >&2
  exit 1
fi

printf 'api:  %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$API_PORT/api/health")"
printf 'web:  %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/")"
printf 'glb:  %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/anatomy/shoulder/left/shoulder/asi-shoulder-deltoid-acromial-part.glb")"
printf 'api via proxy: %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/api/health")"

if [ "${2:-}" = "--check-fresh" ]; then
  module=${ASI_FRESHNESS_MODULE:-src/anatomy/BodyMap.tsx}
  node scripts/audit-freshness.mjs "http://127.0.0.1:$WEB_PORT/$module" "apps/web/$module"
fi

echo "logs in $LOGDIR — stop with: scripts/audit-serve.sh (a rerun frees both ports first)"