#!/usr/bin/env bash
# Start / stop / restart the preview, and wait for it to be genuinely ready.
#
# A separate script because the preview is three processes and ad-hoc `&` plus `sleep` is how
# you end up testing a half-started preview and blaming the code. `ready` polls /api/health
# AND the web shell, so "up" means both halves answer, not just that a port is bound.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${ASI_PREVIEW_PORT:-8080}"
API_PORT="${ASI_API_PORT:-8787}"
LOG="${ASI_PREVIEW_LOG:-/tmp/asi-preview.log}"
PIDFILE="/tmp/asi-preview.pgid"

free_port() {
  local pids
  pids=$(ss -lptnH "sport = :$1" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u)
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null
  return 0
}

stop() {
  if [ -f "$PIDFILE" ]; then
    kill -9 -- "-$(cat "$PIDFILE")" 2>/dev/null
    rm -f "$PIDFILE"
  fi
  free_port "$PORT"
  free_port "$API_PORT"
  sleep 1
  echo "[preview] stopped"
}

start() {
  cd "$REPO"
  [ -d apps/web/dist ] || { echo "[preview] no web build; run: pnpm --filter @asi/web build"; exit 1; }

  # Its own process group, so stopping kills the whole tree. Killing only the recorded PID
  # orphans the node children, which keep the ports bound and make the next run talk to a
  # dead server -- the same failure mode the gate runner already had to handle.
  setsid env ASI_BUILD_COMMIT="${ASI_BUILD_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}" \
    node preview/start.mjs > "$LOG" 2>&1 < /dev/null &
  echo $! > "$PIDFILE"

  local deadline=$((SECONDS + 90))
  while [ $SECONDS -lt $deadline ]; do
    if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 \
       && curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
      echo "[preview] ready on http://127.0.0.1:$PORT (log: $LOG)"
      return 0
    fi
    # If the runner died, stop waiting and say so with its own output.
    if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "[preview] FAILED to start:"
      tail -25 "$LOG"
      return 1
    fi
    sleep 1
  done
  echo "[preview] TIMED OUT waiting for readiness:"
  tail -25 "$LOG"
  return 1
}

case "${1:-restart}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; start ;;
  status)
    curl -sf "http://127.0.0.1:$PORT/api/health" \
      | python3 -c 'import json,sys; d=json.load(sys.stdin); print("ok", d["ok"], "| deploy", d["build"]["deployKind"], "| commit", d["build"]["commit"][:12], "| releaseReady", d["releaseReady"], "| unreviewed", str(d["unreviewedSafetyRules"])+"/"+str(d["totalSafetyRules"]))' \
      || echo "[preview] not responding"
    ;;
  log)     tail -"${2:-40}" "$LOG" ;;
  *) echo "usage: $0 {start|stop|restart|status|log}"; exit 2 ;;
esac