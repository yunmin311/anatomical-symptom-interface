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

# Ownership-aware port handling. Sourced, not duplicated: this file used to carry
# its own `free_port()` that SIGKILLed whatever held the port, and two other
# scripts in this repo carried the same copy.
# shellcheck source=../scripts/port-ownership.sh
if [ -r "$REPO/scripts/port-ownership.sh" ]; then
  # shellcheck disable=SC1091
  . "$REPO/scripts/port-ownership.sh"
else
  echo "[preview] FATAL: $REPO/scripts/port-ownership.sh is missing." >&2
  echo "[preview] Refusing to start: without it this script cannot tell its own" >&2
  echo "[preview] processes from someone else's, and a busy port would be answered" >&2
  echo "[preview] by killing them. Restore the file rather than working around it." >&2
  exit 1
fi

# Stop what we started, and nothing else.
#
# The process group in the pid file is ours by construction, so that kill is safe.
# The ports are checked afterwards only to REPORT a foreign holder: the old code
# killed it, which is how `pnpm preview:stop` once took down an unrelated service
# that happened to be on 8787.
stop() {
  if [ -f "$PIDFILE" ]; then
    kill -TERM -- "-$(cat "$PIDFILE")" 2>/dev/null
    for _ in 1 2 3 4 5 6; do
      kill -0 -- "-$(cat "$PIDFILE")" 2>/dev/null || break
      sleep 0.4
    done
    kill -9 -- "-$(cat "$PIDFILE")" 2>/dev/null
    rm -f "$PIDFILE"
  fi
  local conflict=0
  asi_release_port "$PORT" "$REPO" || conflict=1
  asi_release_port "$API_PORT" "$REPO" || conflict=1
  if [ "$conflict" = 0 ]; then
    echo "[preview] stopped"
  else
    echo "[preview] our processes are stopped, but a port is held by another program." >&2
    echo "[preview] Nothing of anyone else's was killed. See the CONFLICT lines above." >&2
    return 1
  fi
}

start() {
  cd "$REPO"
  [ -d apps/web/dist ] || { echo "[preview] no web build; run: pnpm --filter @asi/web build"; exit 1; }

  # A port owned by another program is a conflict to report, not a process to
  # remove. Checking before starting is what makes that true; after the fact it is
  # already too late.
  asi_require_port_free "$PORT" "$REPO" || return 1
  asi_require_port_free "$API_PORT" "$REPO" || return 1

  # Its own process group, so stopping kills the whole tree. Killing only the recorded PID
  # orphans the node children, which keep the ports bound and make the next run talk to a
  # dead server -- the same failure mode the gate runner already had to handle.
  #
  # ASI_BUILD_COMMIT is passed through ONLY when the caller set it. It used to be
  # defaulted to `git rev-parse HEAD` here, which handed start.mjs the checkout's
  # commit and made the preview report that instead of the commit its bundle was
  # actually built from. The version the user is looking at has to come from the
  # build stamp, so an unset variable stays unset.
  setsid env ASI_BUILD_COMMIT="${ASI_BUILD_COMMIT:-}" \
    node preview/start.mjs > "$LOG" 2>&1 < /dev/null &
  echo $! > "$PIDFILE"

  local deadline=$((SECONDS + 90))
  while [ $SECONDS -lt $deadline ]; do
    if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 \
       && curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
      echo "[preview] ready on http://127.0.0.1:$PORT (log: $LOG)"
      # The commit is the whole point of knowing which version is running: a
      # preview served from the wrong worktree looks identical in a browser.
      report_identity
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

# What is being served, and from where. Read from the running server where
# possible, because the point is to report the version ACTUALLY answering, not
# the version on disk.
report_identity() {
  local health
  health=$(curl -sf "http://127.0.0.1:$PORT/api/health" 2>/dev/null)
  if [ -n "$health" ]; then
    printf '%s' "$health" | python3 -c '
import json,sys
d=json.load(sys.stdin)
b=d.get("build",{})
print("[preview]   commit :", (b.get("commit") or "unknown")[:12])
print("[preview]   branch :", b.get("branch") or "unknown")
print("[preview]   health :", "ok" if d.get("ok") else "NOT OK")
print("[preview]   releaseReady:", d.get("releaseReady"), "| unreviewed safety rules:", str(d.get("unreviewedSafetyRules"))+"/"+str(d.get("totalSafetyRules")))
' 2>/dev/null || echo "[preview]   (health response could not be parsed)"
  fi
  echo "[preview]   serving: $REPO"
  echo "[preview]   anatomy: apps/web/dist (must be rebuilt after a source change)"
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