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

# 3. run the pipeline
node scripts/build-anatomy.mjs --region shoulder \
  --input assets/anatomy/source \
  --out assets/anatomy/generated \
  --grid 10
```

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

## Why the source ids are not our ids

Every layer above the viewer keys off `asiId`, and the source `meshName` is
carried as provenance only. Third-party terminologies get renamed and re-released.
If `Supraspinatus_tendon_L` were the identity, an upstream rename would silently
repoint a user's saved visual selection at a different structure. See
`docs/adr/0002-anatomy-model-source.md`.

## Phase 1 scope

Shoulder only, as a vertical slice. `neck`, `lower_back` and `knee` have no
mapping yet and the build says so rather than guessing.

The `FMA` bindings in a generated manifest are `unverified`. Nothing has been
checked against FMA Explorer, and a code is only marked `verified` after a human
has done that.
