#!/usr/bin/env bash
# Who owns a port, and what may be done about it.
#
# Sourced by preview/preview.sh, scripts/audit-serve.sh and scripts/final-gates.sh.
# Not executable on its own.
#
# ## WHY THIS FILE EXISTS
#
# All three of those scripts used to free a port the same way:
#
#     pids=$(ss -lptnH "sport = :$1" | grep -oP 'pid=\K[0-9]+')
#     [ -n "$pids" ] && kill -9 $pids
#
# which reads like "stop the previous run" and is actually "SIGKILL every process
# that happens to own this port, whatever it is". On a machine where other projects
# run, `pnpm preview:stop` killed an unrelated service with no record of what died
# and no way to tell afterwards. A busy port is a CONFLICT TO REPORT, not
# permission to remove someone's process.
#
# ## THE RULE
#
# A process may be stopped only if it is verifiably ours: its working directory or
# its command line names this repository, or its pid was recorded in a pid file we
# wrote. Everything else is reported, with enough detail to act on, and the call
# fails. When the answer cannot be established — /proc unreadable, no permission —
# the answer is "not ours", because the failure mode of guessing wrong is an
# unrelated process dying.

# Listening pids on a TCP port. Empty when nothing holds it.
asi_port_pids() {
  ss -lptnH "sport = :$1" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u
}

# One line naming a process, for a message a human has to act on.
asi_describe_pid() {
  local pid="$1" cwd cmd
  cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
  cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-160 || true)
  printf 'pid %-7s cwd=%-44s cmd=%s\n' "$pid" "${cwd:-unknown}" "${cmd:-unknown}"
}

# Is this process ours? Usage: asi_pid_is_ours <pid> <repo> [pid_file...]
#
# Fails closed. An unanswerable question is answered "no".
asi_pid_is_ours() {
  [ $# -ge 2 ] || return 1
  local pid="$1" repo="$2" cwd cmd file
  shift 2
  [ -n "$pid" ] && [ -n "$repo" ] && [ -d "/proc/$pid" ] || return 1

  # Recorded by us, so by definition ours.
  for file in "$@"; do
    [ -f "$file" ] || continue
    grep -qx "$pid" "$file" 2>/dev/null && return 0
  done

  cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
  case "$cwd" in "$repo" | "$repo"/*) return 0 ;; esac

  cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
  case "$cmd" in *"$repo"*) return 0 ;; esac

  return 1
}

# Free a port, but only of our own processes.
#
#   asi_release_port <port> [repo] [pid_file...]
#
# Returns 0 when the port ends up free, 1 when a foreign process still holds it.
# Never kills anything it cannot prove it started.
asi_release_port() {
  [ $# -ge 1 ] || return 1
  local port="$1" repo="${2:-}" pids pid conflicts=0
  if [ $# -ge 2 ]; then shift 2; else shift 1; fi
  pids=$(asi_port_pids "$port")
  [ -z "$pids" ] && return 0

  for pid in $pids; do
    if asi_pid_is_ours "$pid" "$repo" "$@"; then
      echo "[port] :$port held by our own process; stopping it"
      asi_describe_pid "$pid"
      # TERM first so a server can close its database and its listeners cleanly.
      # SIGKILL is the fallback, and only against a process we own.
      kill -TERM "$pid" 2>/dev/null
      for _ in 1 2 3 4 5 6; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.4
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null
      fi
    else
      conflicts=1
      echo "[port] CONFLICT: :$port is held by a process this script did not start." >&2
      asi_describe_pid "$pid" >&2
      echo "[port] Not stopping it. Change the port for this project, or stop that" >&2
      echo "[port] process yourself if it is no longer needed." >&2
    fi
  done
  return $conflicts
}

# Refuse to start on a port someone else owns. Same ownership test as above, so
# a rerun of our own stack is fine and a collision is a clear message.
asi_require_port_free() {
  [ $# -ge 1 ] || return 1
  local port="$1" repo="${2:-}" pids pid
  if [ $# -ge 2 ]; then shift 2; else shift 1; fi
  pids=$(asi_port_pids "$port")
  [ -z "$pids" ] && return 0
  for pid in $pids; do
    asi_pid_is_ours "$pid" "$repo" "$@" && continue
    echo "[port] CONFLICT: cannot start on :$port — held by another program:" >&2
    asi_describe_pid "$pid" >&2
    echo "[port] Override with the project's port variable, e.g." >&2
    echo "[port]   ASI_PREVIEW_PORT=8090   ASI_API_PORT=8790   ASI_WEB_PORT=5180" >&2
    return 1
  done
  return 0
}