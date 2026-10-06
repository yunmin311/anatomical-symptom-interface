# Two anatomy manifests, and why they must stay two

There are two anatomy documents in this repository. They describe overlapping
geometry and they are **not** interchangeable. A viewer build once wrote one over
the other and destroyed the canonical contract; this file exists so that is
unrepeatable.

| | canonical | atlas |
|---|---|---|
| path | `assets/anatomy/generated/<region>/<side>/manifest.json` | `assets/anatomy/atlas/<region>/<side>/atlas-manifest.json` |
| schema | `AssetManifestSchema` | `AtlasManifestSchema` |
| written by | `scripts/build-anatomy.mjs` | `scripts/build-atlas-manifest.mjs` |
| one entry per | canonical `asi:*` structure | mesh the viewer can draw |
| right shoulder | 10 entries | 43 structures |
| answers | "which anatomy does ASI claim, and on what evidence" | "what can the viewer draw, and what may a record name" |
| consumed by | the product, embedded at build time | the 3D viewer only |

## Why the viewer needs its own document

The canonical ontology is deliberately coarse. The right shoulder has 10 canonical
entries because that is what ASI claims to model. BodyParts3D has 42 shoulder
meshes: a clavicle, a humerus, every vessel in the axilla, the three parts of the
deltoid, muscles the ontology has no `asi:` id for at all.

A viewer restricted to canonical entries could not show a clavicle. So the atlas
carries all 43 — and 33 of them have **no canonical identity**. That is the whole
reason for a second contract, and the reason it cannot simply be a looser version
of the first.

## The crosswalk

Every atlas structure states where it stands with respect to the canonical
ontology:

```jsonc
{
  "id": "bp3d:FJ3384",              // the atlas's own id -- NEVER a domain id
  "sourceMeshName": "FJ3384",       // the BodyParts3D mesh it was built from
  "canonicalAsiId": "asi:shoulder.scapula",
  "symptomRecordSelectable": true,
  // ...
}
```

and for a structure with no mapping:

```jsonc
{
  "id": "bp3d:FJ3362",              // right clavicle
  "canonicalAsiId": null,
  "symptomRecordSelectable": false,
  // ...
}
```

The invariant, enforced in `validateAtlasManifest` and in
`test/anatomy-contract-split.test.ts`:

> **`symptomRecordSelectable === true` requires a non-null `canonicalAsiId` matching `asi:*`.**

A view-only structure may still be **displayed, searched, hovered, isolated and
hidden**. It simply has no legal value to write. This is the only thing standing
between a raw `bp3d:FJ####` id and a persisted `SymptomRecord` structure id — the
one way this atlas could corrupt real records.

A crosswalk entry is derived by matching **source mesh**, not label: the canonical
manifest records which mesh it bound to a given `asi:*` structure, and the atlas
records the same mesh. The label is presentation text and can be reworded; the
mesh cannot.

## Provenance survives

Viewer-specific does not mean provenance-free. Each atlas structure carries a
source mesh, a laterality, FMA id and status, the presentation system and its
classification, the ontology verification axis, triangle count, and bounds in both
unit systems.

Units are explicit rather than a single `units` field, because the previous viewer
manifest said `units: "metres"` while every `boundsMm` field it carried was in
millimetres:

```jsonc
"coordinateSystem": {
  "sourceUnits": "mm",
  "renderUnits": "m",
  "sourceToRenderScale": 0.001,
  "glTFYUp": true,
  "sourceAxes": { "anterior": "-Y", "posterior": "+Y", "superior": "+Z", "bodyRight": "-X" }
}
```

The axis convention is provenance, not decoration: an importer once rotated the body
silently and every camera preset became confidently wrong.

Coverage stays honest too. `unavailableInSource` is **derived**: a system is listed
when the whole-body source has meshes of it and this region has none. Each entry
carries `wholeBodySourceCount`, which must be positive — a not-in-source claim with
a zero count would say the tissue does not exist in anatomy, which is a different
claim.

## One source of truth, two generated products

Neither manifest is hand-maintained.

```
assets/anatomy/generated/anatomy-system-map.json        <- tissue class per mesh
assets/anatomy/generated/anatomy-system-map.review.json <- reviewed overrides
assets/anatomy/generated/shoulder-scene.json            <- per-mesh bounds, triangles
assets/anatomy/atlas/shoulder/right/coverage-notes.json <- gap prose only
assets/anatomy/generated/shoulder/right/manifest.json    <- CANONICAL, the authority
                                  |
                                  v
              scripts/build-atlas-manifest.mjs  ->  atlas-manifest.json
```

Prose lives only in `coverage-notes.json`; every **number** in the atlas manifest is
derived, so a second source of truth cannot drift in.

## What is enforced

`packages/shared/test/anatomy-contract-split.test.ts`:

- **A** every canonical manifest parses as an `AssetManifest`, and all sides of a
  region use the *same* shape
- **B** `anatomy-laterality.test.ts` is unchanged and passing — those 12 tests read
  real committed builds as their evidence and are the reason this split exists
- **C** every atlas manifest parses as an `AtlasManifest`
- **D** every atlas structure names a source mesh, a laterality consistent with its
  build, and coordinate metadata that converts correctly
- **E** `symptomRecordSelectable` implies a real canonical `asi:*` id that resolves
  to a domain structure; view-only structures have no canonical id; and
  `getStructure('bp3d:…')` is `undefined`
- **F** path ownership: no atlas document is committed at a canonical path, the
  generator and exporter refuse to write there, the viewer fetches
  `atlas-manifest.json`, and both trees exist as separate directories

## Rebuilding

```bash
# 1. canonical geometry + manifest (needs the BodyParts3D OBJ source)
node scripts/build-anatomy.mjs --region shoulder --side right \
  --input <dir-of-objs> --out assets/anatomy/generated --grid 10

# 2. atlas geometry (Blender; writes GLBs only, no manifest)
blender --background spikes/shoulder-geometry/shoulder.blend \
  --python spikes/shoulder-geometry/export-web-glb.py

# 3. atlas manifest (derived; refuses to write into assets/anatomy/generated/)
node scripts/build-atlas-manifest.mjs --region shoulder --side right
```

Step 3 asserts the canonical manifest still parses as a canonical manifest before
writing anything, so a step-2 regression cannot pass unnoticed.