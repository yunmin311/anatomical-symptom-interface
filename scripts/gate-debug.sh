#!/usr/bin/env bash
# Run the design gates and keep their output where it can be read afterwards.
#
# `final-gates.sh` deletes its scratch directory on a clean run and prints the
# path on a dirty one, so a failing browser gate can be read — but only if you
# know to look, and only until the next run. This keeps the per-gate logs and the
# PNGs in one place.
#
#   bash scripts/gate-debug.sh                 # every gate
#   bash scripts/gate-debug.sh userflow a11y   # only these
#
# ASI_GATE_OUT chooses the destination (default data/gateout, which is
# gitignored, so evidence never lands in a commit).
set -uo pipefail

SOURCE=${BASH_SOURCE[0]}
while [ -L "$SOURCE" ]; do
  DIR=$(cd -P "$(dirname "$SOURCE")" && pwd)
  SOURCE=$(readlink "$SOURCE")
  [[ $SOURCE != /* ]] && SOURCE=$DIR/$SOURCE
done
cd "$(cd -P "$(dirname "$SOURCE")/.." && pwd)" || exit 1

OUT=${ASI_GATE_OUT:-data/gateout}
mkdir -p "$OUT"

timeout "${ASI_GATE_TIMEOUT:-3600}" bash scripts/final-gates.sh "$@" >"$OUT/run.txt" 2>&1
code=$?

scratch=$(grep -oE '/tmp/asi-gates-[A-Za-z0-9]+' "$OUT/run.txt" | tail -1)
if [ -n "$scratch" ] && [ -d "$scratch/evidence" ]; then
  cp "$scratch/evidence"/last-*.txt "$OUT/" 2>/dev/null
  cp "$scratch/evidence"/*.png "$OUT/" 2>/dev/null
  cp "$scratch"/*.log "$OUT/" 2>/dev/null
fi

awk '/=== gates ===/,0' "$OUT/run.txt"
echo "exit=$code  logs in $OUT"
exit $code