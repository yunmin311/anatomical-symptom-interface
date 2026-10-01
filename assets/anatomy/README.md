# Anatomy assets

Generated 3D assets for the anatomy viewer, and the contract for producing them.

**`generated/` is empty on purpose.** The geometry that belongs here comes from
BodyParts3D, and this repository does not contain it. What is committed is the
pipeline and the manifest contract; what is missing is one external file, listed
below. When it is supplied, `generated/` fills with small, reproducible GLB files
and a `manifest.json` that are worth reviewing in a diff.

## The one external file needed

| | |
|---|---|
| **File** | `isa_BP3D_4.0_obj_99.zip` |
| **Dataset** | BodyParts3D, Database Center for Life Science, Japan |
| **Release** | 4.0 (2013/05), 99% polygon-reduced OBJ meshes |
| **Concept list** | 4.3i — note the gap: the maintained concept list is newer than the mesh archive |
| **Licence** | Creative Commons Attribution 4.0 International |
| **Licence page** | <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html> (last updated 2025-02-27) |
| **DOI** | 10.18908/lsdba.nbdc00837-000 |

Required attribution, which must ship with any redistributed asset:

```
BodyParts3D, (c) The Database Center for Life Science
Licensed under Creative Commons Attribution 4.0 International.
Licence page: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
(licence page last updated 2025-02-27)
```

The licence is CC BY 4.0 and **not** CC-BY-SA 2.1 JP, which is what most
third-party mirrors and the project's own editor site still quote. That matters:
CC-BY-SA would impose share-alike on redistributed derivatives, CC BY 4.0 does
not. The `verifiedOn` date in the manifest exists so a future licence change is
detectable rather than discovered later. See `docs/research/anatomy-assets.md`.

## Producing the assets

```bash
# 1. obtain the archive yourself, from the URL above
# 2. extract the .obj files somewhere gitignored:
mkdir -p assets/anatomy/source
unzip -q ~/Downloads/isa_BP3D_4.0_obj_99.zip -d assets/anatomy/source

# 3. run the pipeline, once per side
#
# `--side` is not a display option. One `asiId` is one structure, and BodyParts3D
# ships two files for it, so the side decides WHICH REAL MESH becomes the entry --
# and it is recorded as `laterality` from the source concept the mapping named.
# Building both into one directory would let one side overwrite the other, which is
# how a left manifest ends up pointing at right geometry.
for SIDE in left right; do
  node scripts/build-anatomy.mjs --region shoulder --side "$SIDE" \
    --input assets/anatomy/source/obj/isa_BP3D_4.0_obj_99 \
    --out "assets/anatomy/generated/$SIDE" \
    --grid 10
  node scripts/embed-anatomy-manifest.mjs --side "$SIDE"
done
```

Nothing is mirrored. The right shoulder is built from the source's own right-side
meshes (`FJ1468`, `FJ1500M`-style base ids) against different FMA concepts, and the
`laterality` gate checks that on both sides.

With no `--input` the script prints the file it needs and the exact command to
run, and writes nothing. It will not download the archive, will not commit it,
and will not fabricate a stand-in for it.

## What the pipeline does

1. **Select** the V1 region's structures from the meshes actually present.
2. **Bind** each to an `asiId` from our own anatomy, using a candidate-name
   table. A structure with no matching mesh is **reported as unmapped and left
   out**. It is never guessed at: a mesh bound to the wrong `asiId` would render
   as a structure the user never pointed at, and the record would then claim they
   did.
3. **Reduce** geometry by vertex clustering. Deterministic, no native dependency,
   and cannot fail to converge. `--grid` sets the target resolution.
4. **Encode** binary glTF 2.0, one mesh per file, no runtime dependency.
5. **Validate** against the manifest contract and the geometry budget, and write
   nothing at all if validation fails.
6. **Emit** `manifest.json` with the licence, attribution and source provenance on
   every entry.

The output is byte-reproducible: the same input produces the same manifest and the
same GLBs, which is what makes a generated manifest reviewable.

## How the manifest reaches the viewer

There is exactly one path, and it is one-directional:

```text
generated/<side>/manifest.json → parseManifest()      validate against the domain
                             → toRendererScene()      and the budget
                             → RendererSceneManifest  apps/web/src/anatomy/asset-scene-adapter.ts
                             → the renderer mounts it
```

Things worth knowing before you add a field or change one:

- **The generated `manifest.json` is the asset authority.** The web app has a
  renderer contract (`apps/web/src/anatomy/scene-manifest.ts`) and no licence
  authority of its own. Do not extend one into the other.
- **`subRegionIds` is a list and stays one.** The deltoid is reachable from both
  `shoulder.anterior` and `shoulder.lateral`, and one mesh serves both. Neither
  the adapter nor the renderer may reduce that to its first element; a
  `soleSubRegionId` appears only when there is exactly one member.
- **One mesh per file**, which is why the adapter deliberately does not set
  `nodeName`. A future multi-part file sets it on the scene entry.
- **Attribution is derived.** `externalAssetNotice` is computed from
  `licence.attribution`, `source.dataset` and `source.release`, and
  `assertSceneAttribution` refuses a scene whose string disagrees — so it cannot
  be written by hand and cannot drift from the licence above.
- **`laterality` is copied, never derived.** The side is established once, by the
  mapping naming a real source concept, and travels
  `AssetManifestEntry → RendererSceneEntry → PickResult` unchanged. Nothing infers
  it from a filename, an `M` suffix, an x coordinate, a camera angle or which half
  of the screen a mesh lands on. `buildProductionScene` refuses a build whose
  manifest disagrees with its own `--side`, and the `laterality` gate checks both
  shoulders.
- **`geometry.units` is `mm`, and it was measured.** The archive carries no unit
  field. BodyParts3D documents its model as an adult human male, and the source
  meshes span 1729.74 units top to bottom: 1.73 m as millimetres, 17.3 m as
  centimetres, 1730 m as metres. Camera framing stays unit-agnostic and derives
  its near and far planes from the measured scene, so a source in different units
  will still frame correctly.
- **The pipeline is proven without the real archive**, using clearly-labelled
  synthetic geometry in `apps/web/test/`: canonical manifest → validate → adapter
  → scene → real GLB bytes → `GLTFLoader` → three.js scene graph → descendant
  mesh → canonical `asiId` → structure selection. So the integration is tested
  even though the asset is not here yet.

## Why the source ids are not our ids

Every layer above the viewer keys off `asiId`, and the source `meshName` is
carried as provenance only. Third-party terminologies get renamed and re-released.
If `Supraspinatus_tendon_L` were the identity, an upstream rename would silently
repoint a user's saved visual selection at a different structure. See
`docs/adr/0002-anatomy-model-source.md`.

## Phase 1 scope

Shoulder only, as a vertical slice. `neck`, `lower_back` and `knee` have no
mapping yet and the build says so rather than guessing. Carrying all four through
the pipeline is Phase 1B.

The `FMA` bindings in a generated manifest are `unverified`. Nothing has been
checked against FMA Explorer, and a code is only marked `verified` after a human
has done that.
