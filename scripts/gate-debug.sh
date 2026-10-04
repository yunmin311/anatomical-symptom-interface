#!/usr/bin/env bash
# Run the gates and keep their per-gate output where it can be read afterwards.
#
#   bash scripts/gate-debug.sh                 # every gate
#   bash scripts/gate-debug.sh userflow a11y   # only these
#
# ASI_GATE_KEEP is what makes this tool work. `final-gates.sh` deletes its scratch
# directory on a clean run, and this script copies the per-gate logs out
# afterwards — so without it, a clean run deleted the directory before anything
# could read it and this tool silently produced an empty directory on exactly the
# runs where you most want to read what a gate actually asserted.
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

ASI_GATE_KEEP=1 timeout "${ASI_GATE_TIMEOUT:-3600}" bash scripts/final-gates.sh "$@" >"$OUT/run.txt" 2>&1
code=$?

scratch=$(grep -oE '/tmp/asi-gates-[A-Za-z0-9]+' "$OUT/run.txt" | tail -1)
copied=0
if [ -n "$scratch" ] && [ -d "$scratch/evidence" ]; then
  cp "$scratch/evidence"/last-*.txt "$OUT/" 2>/dev/null && copied=$((copied+1))
  cp "$scratch/evidence"/*.png "$OUT/" 2>/dev/null && copied=$((copied+1))
  cp "$scratch"/*.log "$OUT/" 2>/dev/null && copied=$((copied+1))
fi

awk '/=== gates ===/,0' "$OUT/run.txt"
if [ "$copied" -eq 0 ]; then
  # A tool that reports success while having saved nothing is worse than no tool.
  echo "!! no gate logs were copied out of $scratch — this run's per-gate output is NOT in $OUT" >&2
fi
echo "exit=$code  logs in $OUT"
exit $code