#!/usr/bin/env bash
set -uo pipefail
cd /mnt/e/1project/anatomical-symptom-interface-design

git add apps/web/src/anatomy/types.ts \
        apps/web/src/anatomy/manifest.ts \
        apps/web/src/anatomy/three3d.ts \
        apps/web/src/state/session.ts
git commit -q -F - <<'MSG'
feat(ui): load real GLB geometry, bind scene graphs, and reset the viewer

The url geometry path never existed. buildScene() skipped every entry whose
geometry.type was not 'primitive', so a manifest could describe a GLB and the
viewer would silently draw nothing for it: the one thing a viewer that reports
success must never do.

What changed:

- mount() awaits every url asset before resolving, through three's GLTFLoader.
  A viewer that reports ready before its geometry exists is indistinguishable
  from a broken one.
- A missing nodeName, a failed load, or an asset with no mesh aborts the mount,
  which lands on the 2D map. Failing loudly beats a body with holes in it.
- An entry may bind a root Object3D. A GLB is a scene graph, not a mesh, so
  visibility and materials are applied to the whole subtree and a raycast on any
  descendant resolves back to the entry's asiId through a private reverse index.
  Engine handles still never cross the boundary.
- Camera framing is computed from the loaded Box3, so a real asset is framed on
  its own extent instead of being pushed into fixture primitive coordinates.
- One load per url, shared by every entry naming it: a real pipeline ships many
  parts in one file.
- Assets are bounded by a timeout and released on both the failure and the
  dispose path, so a fetch that lands after unmount adopts nothing.

Two invariants the command vocabulary had been violating:

- reject and setHighlighted filtered selectedStructureIds, so a visual dismissal
  or a re-localisation could silently unselect something the record still listed
  as user-pointed. Selection is presentation-mirrored from
  location.userSelectedStructureIds and only setSelected or a click may change
  it. A selected structure now also outranks rejection in material precedence.
- reset() only moved the camera, so a new episode inherited the previous one's
  selection, candidates, rejections and pin. It now projects the fresh record,
  as does re-localisation. This needed a clearPin command: the vocabulary could
  not otherwise express "no pin", which is the whole reason the state survived.

assertNonMedical no longer bans url geometry outright, since that is how the
path gets tested at all. It now requires any manifest that loads external assets
to name them in externalAssetNotice, which is the hook the canonical manifest
will fill with real provenance.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG

git add apps/web/test/url-geometry.test.ts \
        apps/web/test/session-viewer-state.test.ts \
        apps/web/test/anatomy.test.ts
git commit -q -F - <<'MSG'
test(ui): cover the GLB path against real bytes, and the reset projection

23 node tests drive real GLB through three's actual GLTFLoader. Only the
transport is injected, because a headless test has no fetch; node resolution,
scene-graph adoption, identity, materials, picking and bounds are the
production path in every case.

The fixture is two non-medical quads under a Group, in
apps/web/public/fixtures/non-medical-two-quads.glb, built by a committed
generator so the bytes are reviewable and not a binary blob of unknown origin.
It is deliberately not anatomy: a Group with two named descendant meshes and a
union extent nothing in the manifest declares.

Cases, labelled to match the review: A/A2/A3 load and mount-before-ready, B
nested identity and picking, B3 independent nodes from one file, C depth on real
materials, D candidate/selected/deselected, E failure and empty-asset fallback,
F dispose mid-load, G framing from loaded bounds, H/I reset and re-localisation,
J selection immutability.

Reverting the six behaviours this fixes fails 5 of them, so they are not
vacuous. Two of the failures are worth keeping in mind: the non-recursive
raycast and the identity-only-root lookup are what made a descendant mesh
unresolvable, and root-only materials are what would have left a 20-mesh GLB
mostly in the colour the asset shipped with.

session-viewer-state.test.ts drives the real store, not the adapters. The
adapters always handled every command correctly; the bug was that reset and
describe only added. A test on the adapter alone would have passed throughout.

url-geometry-browser.mjs is the browser-level gate: no injected transport, a
real HTTP fetch of the GLB, a real WebGL context. It found two things the node
tests could not — three names the loaded root after the glTF scene rather than
after its Group, and framing a whole graph must differ from framing one node of
it.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG

git add apps/web/public apps/web/test/fixtures apps/web/test/url-geometry-browser.mjs \
        data/run/final-gates.sh
git commit -q -F - <<'MSG'
test(ui): add the browser-level GLB gate and its fixture asset

The node tests inject a transport, which by definition hides everything the
transport is responsible for: a fetch the server 404s, an asset the bundler will
not serve, a material whose shader does not compile. This gate injects nothing —
the production GLTFLoader does a real HTTP fetch of a real GLB and a real WebGL
context draws it.

Ten checks: the GLB is served with a glTF content type, mount adopts a real
four-level scene graph, a descendant raycast resolves to the manifest asiId over
real WebGL, depth and highlight reach loaded materials, framing follows loaded
bounds and differs between a graph and one node, a 404 falls back to 2D with a
reason and no canvas, and dispose mid-fetch leaves nothing behind.

final-gates.sh now runs it as a twelfth gate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG

git add apps/web/src/anatomy/svg2d.ts docs/design/phase1a-anatomy-workspace.md
git commit -q -F - <<'MSG'
docs(ui): correct the url-geometry status and align the 2D adapter

The manifest guard no longer bans external assets, so the docs describing it as
doing so were wrong. The documented rule is now the one that holds: a fixture
must carry a disclaimer, and any manifest that loads external assets must name
them in externalAssetNotice.

The design note also claimed a missing asset was "a manifest problem to report,
not a crash". That is the opposite of what is implemented, and of what it should
be: an incomplete 3D body reports success and looks like absent anatomy. mount()
now aborts and the workspace falls back to 2D, and the note says so.

svg2d gains the same two invariant fixes as the 3D adapter, so the selection
rules are not a property of the renderer rather than of the contract.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG

echo "=== log ==="
git log --oneline -6
echo "=== status ==="
git status --porcelain=v1
echo "(clean if empty)"