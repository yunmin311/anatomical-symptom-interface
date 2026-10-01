#!/usr/bin/env bash
# The audit needs to live in the repo, not in a temp script: it is what stops the
# mapping table from drifting back to invented filenames, and it is how a human
# checks our bindings against the source. This reads the gitignored archive.
set -uo pipefail
ROOT=/mnt/e/1project/anatomical-symptom-interface
SRC="$ROOT/assets/anatomy/source"
cd "$SRC"

echo "=== archive present? ==="
if [ ! -f isa_BP3D_4.0_obj_99.zip ]; then
  echo "  NO ARCHIVE. See assets/anatomy/README.md for the exact file and URL."
  echo "  Nothing is reported rather than reported from assumption."
  exit 2
fi
echo "  $(stat -c%s isa_BP3D_4.0_obj_99.zip) bytes"
echo "  sha256 $(sha256sum isa_BP3D_4.0_obj_99.zip | cut -d' ' -f1)"

echo
echo "=== the identity bridge, if downloaded ==="
for f in isa_parts_list_e.txt isa_element_parts.txt; do
  [ -f "$f" ] && echo "  $f present ($(wc -l < "$f") lines)" || echo "  $f MISSING -- mesh names cannot be resolved"
done
[ -d obj/isa_BP3D_4.0_obj_99 ] || { echo "  obj/ MISSING -- extract the archive first"; exit 2; }
echo "  $(ls obj/isa_BP3D_4.0_obj_99 | wc -l) obj files"

echo
echo "=== how many structures would bind, against the REAL files? ==="
cd "$ROOT"
node scripts/build-anatomy.mjs --region shoulder \
  --input "$SRC/obj/isa_BP3D_4.0_obj_99" \
  --out /tmp/audit-gen --grid 10 2>&1 | grep -E 'bound|unmapped|struct.*wanted|meshes read'