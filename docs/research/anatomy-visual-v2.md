# Anatomy Visual V2 — asset source decision

Status: **research gate.** No production code changed on this branch.
Branch: `visual/anatomy-atlas-v2`, based on `origin/main` (`3337353`).

Scope: replace the anatomy **visualisation** architecture and redo the product
visual design. The engineering/domain V1 stays valid. Nothing in
`packages/shared`, `packages/server`, `packages/mcp` is changed by the research
itself.

> **Correction notice.** An earlier revision of this document claimed the source
> asset contains no anatomical category data and that individual named structures
> do not exist. **Both claims were wrong**, and wrong in a way that would have
> killed the project. The error came from reading the coarse *concept* table
> instead of the per-mesh headers. Section 1.1 states the corrected finding and
> section 1.5 records how it was caught.

---

## 1. Why the current result failed — diagnosed, not guessed

### 1.1 The real diagnosis: identity is present, presentation is absent

Measured across all 2234 OBJ files in
`assets/anatomy/source/obj/isa_BP3D_4.0_obj_99/`:

| Signal | Count | Meaning |
|---|---|---|
| files containing `mtllib` | **0** | no material library ships with the geometry |
| files containing `usemtl` | 2234 | every file *names* a material that does not exist |
| files containing `g ` groups | 2234 | one group per file |
| files carrying `English name` in the header | 2234 | **per-structure anatomical name** |
| files carrying `Concept ID : FMA…` | 2234 | **per-structure FMA identity** |
| files carrying `Representation ID : BP…` | 2234 | per-structure BP identity |
| files carrying `Bounds(mm)` | 2234 | **per-structure extent, in millimetres** |
| files carrying `Volume(cm3)` | 2234 | per-structure volume |

So the geometry carries **complete anatomical identity** — name, ontology id,
extent, volume, laterality — and carries **no presentation data whatsoever**.
Every part names a material that was never shipped.

That is the actual root cause of "visually ambiguous gray geometry" and of
"muscles / tendons / bones / nerves / vessels cannot be understood as layers".
It is not a shader bug and not a missing taxonomy. **The renderer had nothing to
colour by, so everything defaulted to one gray.**

### 1.2 Individual named structures DO exist — at mesh granularity, not concept granularity

This is the load-bearing correction. `isa_parts_list.txt` lists only 2905
**coarse concepts** such as `muscle of upper limb`, and its names are what a
naive keyword search hits — which is how the earlier revision concluded "no
individual muscles". That conclusion was an artefact of the wrong table.

The fine granularity is one level down, in `isa_element_parts.txt`
(29549 rows: `concept id → element file id`) plus the OBJ headers. One coarse
concept maps to many individually-named meshes. Measured:

| Coarse concept | Concept name | Mesh files | Individually named members |
|---|---|---|---|
| `muscle of upper limb` | FMA9621 | 78 | `Right pectoralis minor`, `Right serratus anterior`, `Right subclavius`, `Long head of right biceps brachii`, … |
| `intrinsic muscle of shoulder` | FMA32520 | 10 | `Right infraspinatus muscle`, `Right subscapularis`, `Right supraspinatus`, `Right teres major`, `Right teres minor` |
| `extrinsic muscle of shoulder` | FMA32516 | 8 | `Right serratus anterior`, `Right levator scapulae`, `Right rhomboid major`, `Right rhomboid minor` |
| `bone organ` | FMA5018 | 203 | `Right scapula`, `Right clavicle`, `Right humerus`, `Tenth thoracic vertebra`, `Hyoid bone`, … |

Laterality is explicit in the data, three ways over: a `Right`/`Left` name
prefix (247 Right, 276 Left, 477 unprefixed), and 241 files carrying a mirrored
`M` filename suffix (`FJ1500.obj` right, `FJ1500M.obj` left).

### 1.3 The domain already has a tissue-layer taxonomy

`packages/shared/src/anatomy.ts:22-50` declares:

```
TissueLayer = skin | subcutaneous | fascia | muscle | tendon | ligament
            | joint | bone | nerve | vessel | organ
TISSUE_LAYER_ORDER — the same list, ordered superficial → deep
```

and `StructureSchema` carries `layer` (`anatomy.ts:79`), populated per structure
and consumed by `layerOf(structure)` in `anatomy-capability.ts:157`.

So the layer axis already exists in the domain and already reaches the manifest
(`anatomy-pipeline.ts:781` writes `structure.layer`). What it never did was reach
the **renderer** as appearance. That is the gap, and it is much smaller than
"build a taxonomy from scratch".

Known limits of the existing enum, for the visual work: `vessel` does not split
artery from vein; `subcutaneous` and `joint` are depth categories rather than
tissue classes; and a single superficial→deep ordering puts `nerve` and `vessel`
below `bone`, which is not how the body is organised. These are domain
decisions and are recorded in §6, not silently changed.

### 1.4 The viewer has no visual model to hang layers on

Measured in the current code:

- No `clippingPlanes`, no `localClippingEnabled`, no `DoubleSide`. **Zero**
  clipping or cross-section code anywhere in the repo.
- No per-layer opacity. Opacity is derived from selection state only
  (`three3d.ts:1017-1062`): active subregion 0.95, idle 0.8, selected 1.0,
  rejected 0.35, default idle 0.62.
- `showLayers` / `hideLayers` exist in the `ViewerCommand` union and are
  implemented in both adapters, but **no production code dispatches them** —
  tests only.
- **No isolate.** The word does not appear in any viewer code.
- **No orbit.** `Body3d.tsx:20-21` states there is no drag-to-rotate
  requirement; the only way past occluding geometry is a camera preset.
- `CameraPreset` is `position` + `target` only (`three3d.ts:69-74`).
- "Layers currently shown" is a **read-only** `<ul>` of names
  (`BodyMap.tsx:525-531`).

### 1.5 How the §1.1/§1.2 error was caught

The decisive test was to stop reading concept names and start reading mesh
headers, then check whether a coarse concept's member meshes are spatially
distinct volumes. They are — `Right supraspinatus` is a 125×79×35 mm box at
z 1307–1343, `Right subscapularis` a 103×97×130 mm box at z 1195–1325. Different
boxes, different names, different FMA ids. Those are separate anatomical
structures, and the archive always had them.

The lesson generalises: **the coarse table is a lossy index over the fine data,
and it is the wrong place to look when the question is "what can I actually
show".**

### 1.6 Why the 2D map is not salvageable

`apps/web/src/anatomy/svg-geometry.ts` is 474 lines of hand-authored cubic-Bézier
path strings across four view silhouettes and 14 zones. One detail is load-bearing
and any replacement must respect it: `location.point` is persisted as 0..1 against
`VIEW_W=100 × VIEW_H=186` (`svg-geometry.ts:26-33`), so that box is a storage
contract. A replacement 2D surface must keep the same normalised coordinate space
or every stored pin moves.

---

## 2. Source comparison

### 2.1 BodyParts3D 4.0 — the incumbent, and the licence-clean choice

DOI `10.18908/lsdba.nbdc00837-000`, README dated 2025-02-27. Already on disk:
the archive `isa_BP3D_4.0_obj_99.zip` plus five metadata tables.

- **Coverage** — 2234 individually-named meshes, whole body, FMA-identified,
  explicit laterality. Measured 6,681,030 triangles whole-body, median 960
  triangles per mesh.
- **Mesh quality** — this is the **99% polygon-reduction** package. Per-mesh
  triangle counts are honest rather than uniform: `Right scapula` 26,172,
  `Right serratus anterior` 49,212, `Right pectoralis minor` 9,468, but
  `Right deltoid` (spinal part) 1,900 and `Right teres minor` 506. Coarse but
  usable, and the variation is a fact to design around, not to hide.
- **Layer hierarchy** — identity and hierarchy both present, via the FMA IS-A
  table (§3.4). Presentation absent, and that is our work.
- **Blender compatibility** — OBJ import is trivial and already proven by
  `scripts/build-anatomy.mjs`.
- **Cross-section** — none. It is a surface mesh set.
- **Licence** — **CC BY 4.0 International**, see §3.

### 2.2 Z-Anatomy — reference only, not a source

Repo `Z-Anatomy/Models-of-human-anatomy`, 218 stars, last push 2026-10-04.
Content is a Blender *application template*, not loose meshes: `Z-Anatomy.zip`
(86.7 MB), `TA2.csv` (1.5 MB, Terminologia Anatomica 2), `Anatomy-shortcuts.py`
(291 KB), `CheatSheet.png`. Zenodo record `4953712` ships a 130.0 MB
`Z-Anatomy.zip` under DOI `10.5281/zenodo.4953712`.

Genuinely impressive: 5000+ structures, 3500+ definitions, TA2-organised, and its
own add-on already implements *"show/hide/isolate only the parts of interest"* and
*"create cross sections"*.

**But it is disqualified as a production source** by §3.3 — it embeds
NonCommercial components. Used here strictly as:

- product reference,
- Blender workflow reference,
- interaction reference.

Its Python is read for behaviour, not copied. The brief's "reimplement
interaction concepts from requirements/behaviour" applies directly.

### 2.3 BioDigital Human — product benchmark only

UX target, not a dependency: progressive complete-body hierarchy, structure
search, isolate, hide/show, opacity, system filtering, labels, camera
navigation, cross sections. Their viewer is proprietary and vendor-hosted.
Making ASI depend on it would invert the local-first premise. What to take is
the interaction vocabulary and labelling density — design input, freely reusable.

### 2.4 NIH Visible Human Project

The licence-cleanest option and the only true cross-section source.

- **Licence** — **public domain** (US federal government work). NLM: *"the VHP
  provides a public-domain library of cross-sectional cryosection, CT, and MRI
  images"*. Since July 2019 no licence or registration is required.
  The ODbL / "No License Provided" strings on data.gov and the Virginia portal
  describe the *catalogue metadata record*, not the images.
- **Data** — male: 1871 axial anatomical sections at 1 mm, 2048×1216 px, 0.33 mm
  per pixel, 24-bit colour, ~15 GB; plus 1 mm axial CT and 4 mm axial MRI of head
  and neck.
- **Role** — volumetric, not a mesh atlas. Meshing is a real project
  (segmentation → surface extraction), not a conversion. Does not solve layers.
  Candidate for genuine axial/coronal/sagittal cutaway later.

### 2.5 Open Anatomy Project (Brigham and Women's Hospital / SPL)

Found during the search; recorded so it is not rediscovered. CT-derived atlases —
SPL/NAC brain, inner ear, knee, head & neck, abdomen, liver — with skeletal,
vasculature, muscle and organ content, built in 3D Slicer. Real clinical-quality
geometry, and *knee* is directly relevant to a later phase. **Licence not
verified**; treated as blocked pending a check.

### 2.6 Decision matrix

| Criterion | BodyParts3D 4.0 | Z-Anatomy | BioDigital | Visible Human | Open Anatomy |
|---|---|---|---|---|---|
| Coverage | 2234 named meshes, whole body, FMA | 5000+ structures, TA2 | complete, commercial | whole body, volumetric | region atlases |
| Mesh quality | 99% reduced; per-mesh 506–49k tris | retopo'd, instanced | production | n/a (volumetric) | clinical CT |
| Individual structures | **yes** | yes | yes | no | yes |
| Layer hierarchy | **FMA IS-A tree present** | likely authored | authored | none | authored |
| Presentation metadata | **none** (0 mtllib) | authored | authored | n/a | authored |
| Blender compatibility | OBJ import, proven | **native** | n/a | external meshing | Slicer |
| Web export | already done | needs a pass | n/a | needs meshing | viewer exists |
| Licence | **CC BY 4.0** | conflicting, has NC parts | proprietary | **public domain** | unverified |
| Redistribution | **yes, attribution** | ShareAlike + NC problem | no | **yes, unrestricted** | blocked |
| Commercial use | **yes** | **no** (NC parts) | no | yes | blocked |
| Cross-section | no | implemented in its add-on | yes | **native slices** | no |
| Mobile suitability | good (small) | needs LOD work | n/a | n/a | varies |
| Integration cost | **lowest** | highest | n/a | very high | unknown |

**Decision: BodyParts3D 4.0 is the production source.** It is the only candidate
that is simultaneously licence-clean for commercial redistribution, complete at
individual-structure granularity, whole-body, already integrated, and backed by
an authoritative ontology. Everything it lacks — presentation, layers in the
renderer, cross-section — is work we can do and own. The things it does not lack
were only invisible because the pipeline never read them.

---

## 3. Licence analysis

Product requirement: ASI must remain **commercially usable and legally
redistributable**. Code is MIT; assets carry their own recorded licences. **No NC
asset in production.**

### 3.1 Code and assets are already correctly separated

- Root `package.json`: `"license": "MIT"`.
- `.gitignore:22-26` already excludes `assets/anatomy/source/` and says
  *"BodyParts3D SOURCE assets: large, third-party, CC BY 4.0, and never ours to
  redistribute."*
- `packages/shared/src/anatomy-mapping.ts:484-491` already pins:

```ts
export const BODYPARTS3D_LICENCE = {
  id: 'CC-BY-4.0',
  name: 'Creative Commons Attribution 4.0 International',
  url: 'https://dbarchive.biosciencedb.jp/en/bodyparts3d/lic.html',
  attribution: 'BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International',
  verifiedOn: '2025-02-27',
} as const;
```

The comment above it (`:472-483`) already records the exact trap this pass had to
avoid: an earlier draft recorded CC-BY-SA 2.1 JP, "which was the licence under
which BodyParts3D shipped until early 2025 and is still quoted on the project's
own editor site and in most third-party mirrors."

**The OBJ file headers are the stale artefact.** They carry a 2013-era
`CC Attribution-Share Alike 2.1 Japan` notice baked into the archive, alongside
`Compatibility version : 4.0`. Reading the licence out of a file header instead of
the licensor's current page is how the earlier revision got this wrong. The repo
was already right; the research was wrong.

Under CC BY 4.0 there is **no share-alike obligation** on derivative meshes, so
the geometry can be redistributed with attribution and the MIT code grant stays
clean. That is what makes §2.6 possible.

### 3.2 Provenance pass for the exact bytes we hold

Recorded per the required schema:

| Field | Value |
|---|---|
| Source project | BodyParts3D |
| Source URL | `https://dbarchive.biosciencedb.jp/en/bodyparts3d/lic.html` |
| Exact release | 4.0 (mesh archive, 2013/05) |
| Concept release | 4.3i (maintained concept list) |
| Archive | `isa_BP3D_4.0_obj_99.zip` |
| Size | 142,903,898 bytes |
| **SHA256** | `40665852C49F218326590E204DB91064A1ECFC3C6F8CBD7BBBCAAC62C7CD409E` |
| Acquisition date | 2026-10-01 20:38:30 (file creation; `assets/anatomy/source/` is gitignored and fetched by script) |
| Licence id | `CC-BY-4.0` |
| Licence URL | as above |
| Attribution | `BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International` |
| Modified | **yes** — decimated and re-encoded to GLB by `scripts/build-anatomy.mjs` |
| Derivative obligation | attribution only; no share-alike under CC BY 4.0 |
| Redistribution allowed | **yes**, with attribution |
| Commercial use allowed | **yes** |

**Not verified:** the licence page could not be re-fetched during this pass.
`dbarchive.biosciencedb.jp` resolves to `198.18.0.112` on this machine — a
fake-IP from the local proxy (RFC 2544 benchmark range) — and TLS to it fails
from both Windows schannel and WSL OpenSSL. The `verifiedOn: 2025-02-27` date is
therefore carried forward from the repo's existing record rather than
re-established today. It is corroborated by three independent in-repo sources
(`anatomy-mapping.ts:485`, `.gitignore:22`, and the pipeline's
`BODYPARTS3D_LICENCE.id`) and by the product decision. **A machine that can reach
DBCLS directly should re-run this pass.**

Also unavailable for the same reason: the `partof_*` tables
(`partof_parts_list*`, `partof_inclusion_relation_list*`,
`partof_element_parts.txt`). Only the `isa_*` set was ever fetched. §3.4 shows
the IS-A set is sufficient for classification, so this is a gap in completeness
rather than a blocker — but the PART-OF decomposition is not available for
verification.

### 3.3 Z-Anatomy is disqualified as a production source

Its own attribution block, verbatim:

```
- BodyParts3D — CC-BY-SA 2.1 Japan
- "Brainder" and "White matter" from the University of Washington   <- no licence stated
- Cranial Nerves and Foramina — Univ. of Dundee, CAHID — CC-BY 4.0
- Anatomy of the Inner Ear — Univ. of Dundee School of Medicine — CC-BY-NC-SA 4.0   <- NC
- Kidney — by Lissie Cowley — CC-BY-NC 4.0                                        <- NC
- Wikipedia — CC-BY-SA 3.0
```

Two **NonCommercial** components sit inside a work whose top level is declared
CC BY-SA 4.0. The NC terms do not disappear because the aggregate header says
otherwise, and CC BY-SA 4.0 §3(b) forbids adding measures that restrict what the
licence permits. So the full work is **not commercially redistributable**, which
the product requirement forbids.

There is also a direct conflict between the two official distributions:

| Distribution | Declared licence |
|---|---|
| GitHub `License.txt` / `Readme.md` | CC BY-SA 4.0 |
| Zenodo `4953712` rights field (the citable DOI) | CC BY 4.0 |

These are incompatible and cannot both be satisfied — an independent supply-chain
reason not to depend on it.

Consequence, and it is a strict rule going forward: **Z-Anatomy is read-only
reference.** No asset from it enters ASI. Its code is not copied into the MIT
codebase — the add-on's own licence is not stated either — and its behaviour is
reimplemented from the requirement.

### 3.4 A classification IS derivable from the authoritative tables

The brief asked whether the hierarchy is usable. Measured on
`isa_inclusion_relation_list.txt`:

- 2904 edges, 2904 children, **exactly one parent per child** — 0 multi-parent nodes.
- **Exactly one root**: `FMA62955 anatomical entity`.
- No relation-type column, and none is needed: it is a clean **IS-A tree**, not a
  mixed IS-A/PART-OF graph. (The PART-OF tables would be a separate file, and
  are absent — §3.2.)
- Depth 0–19, mode around depth 12–13.

The spine, from the root:

```
anatomical entity
└ physical anatomical entity
  ├ immaterial anatomical entity → anatomical space, anatomical boundary entity
  └ material anatomical entity
    ├ anatomical set
    └ anatomical structure      ← the branch that matters
```

And real classification paths resolve as expected:

```
humerus          → long bone          → bone organ   → organ with cavitated organ parts → …
subclavian artery→ systemic artery   → artery       → segment of arterial tree organ   → …
scapula          → flat bone          → bone organ   → organ with cavitated organ parts → …
muscle of head   → muscle organ (FMA5022) → …
```

So the rule is: walk up the IS-A tree from a concept until a node matches a tissue
class, and record that node plus its depth as the confidence signal. That is
derived from the licensor's own ontology, not from colour, geometry, filename
shape or guesswork. Anything whose chain never reaches an unambiguous class node
is marked **UNKNOWN** and sent for manual review, per the brief.

### 3.5 Required repository changes before any new asset lands

1. `assets/anatomy/LICENSE.md` — per-source record using the schema in §3.2:
   source project, exact URL, release, acquisition date, checksum, licence id,
   licence URL, attribution, modified?, derivative obligation, redistribution
   allowed?, commercial use allowed?
2. Keep geometry out of every MIT-licensed path. `assets/anatomy/source/` (input)
   and `assets/anatomy/generated/` + `apps/web/public/anatomy/` (output) are the
   boundary. Nothing under them may be described as MIT.
3. Carry a per-part provenance record into the generated manifest so attribution
   cannot be lost in the pipeline. `AssetManifestEntry` already has
   `licence`, `source` and `geometry` slots (`anatomy-pipeline.ts:690-715`) — add
   the checksum and acquisition date there.
4. Assert the NC rule in code: a build that sees a licence id containing `NC` or
   `NonCommercial` must fail, the way `assertProductionSceneIsReal`
   (`active-scene.ts:237-250`) already refuses a fixture scene.
5. Confirm `AnatomyAttribution.tsx` renders the attribution string from §3.2
   verbatim — it is the only licence text a user ever sees.

---

## 4. Root-cause summary for the visual work

| Reported symptom | Actual cause | Layer to fix |
|---|---|---|
| "crude hand-made schematic" (2D) | hand-authored Bézier paths | asset/source |
| "small regional bundle of meshes" | 95 GLBs, region-only exports | asset pipeline |
| "visually ambiguous gray geometry" | **no material data in the source at all** (0 `mtllib`) | asset pipeline + material system |
| "cannot read structures as layers" | **identity and hierarchy are present but never reached the renderer**; `TissueLayer` exists and stops at the manifest | viewer |
| "Front/Back/Left/Right are camera presets" | they are; `position`+`target` only | viewer |
| "no isolate/hide/layer/opacity/clipping" | genuinely absent; `showLayers`/`hideLayers` unreachable from production | viewer |
| "typography hierarchy weak" | **no type scale in `tokens.css` at all**; 19 literal font sizes, 10 in the workspace | design system |
| "canvas does not dominate" | layout | design system |

---

## 5. Blender: route and pipeline role

### 5.1 Environment

| Item | Value |
|---|---|
| Blender version | 4.5.14 (4.5 LTS) |
| Build | `blender-4.5.14-windows-x64` |
| Platform | Windows x64, full GUI |
| Distribution | official portable **ZIP**, not the MSI |
| Reason | the MSI requires elevation to write `C:\Program Files\Blender Foundation`; this session is not elevated and MSI failed with `Error 1303` |
| Implication | same application and same version, unpacked rather than registered; no Start Menu entry, no file associations, no machine-wide change, removable by deleting one folder |

### 5.2 Why Blender is needed even though the source is already OBJ

Blender's role here is **three things, and only these three**:

1. **Presentation.** Build the material and layer system in one place, once,
   instead of hand-maintaining per-mesh GLB variants. This is the single biggest
   win and the direct answer to §1.1.
2. **Licence isolation.** Export a curated subset with per-part provenance,
   keeping the boundary between "we redistribute BodyParts3D under CC BY 4.0 with
   attribution" and "we did not modify the source" explicit and auditable.
3. **Pipeline ergonomics.** Bounding-box extraction, laterality derivation,
   normal checks, triangle budgets, LOD tiers — all trivially scriptable.

Blender is **not** for modelling anatomy, and no anatomy is generated or
AI-created. The geometry is the licensor's.

### 5.3 MCP bridge

One bridge, as instructed: **`ahujasid/mcp-for-blender`**, the current package
name — not the legacy `blender-mcp`. Telemetry disabled
(`DISABLE_TELEMETRY=true`), socket bound to localhost only, never exposed to the
network.

Chosen over `dcc-mcp-blender` (named first in the brief) on maturity: ~30,000
stars and pushed 2026-09-30, against ~45 stars and three days old.

Before any anatomy is touched, four operations must be proven with recorded
evidence, and the run stops if any fails rather than debugging anatomy through a
broken bridge:

1. read scene
2. create / manipulate a trivial object
3. assign / change a material
4. export a GLB

Recorded per the brief: Blender exact version, MCP package exact version, addon
version, port, and round-trip evidence.

### 5.4 What the shoulder spike draws from

Measured inventory for the right shoulder, from the local archive — the evidence
that the spike is buildable without inventing anything:

- **Bone** — `Right clavicle`, `Right scapula`, `Right humerus`
- **Rotator cuff** — `Right supraspinatus`, `Right infraspinatus muscle`,
  `Right subscapularis`, `Right teres minor`, `Right teres major`
- **Deltoid** — three parts: acromial, clavicular, spinal
- **Trapezius** — three parts: ascending, descending, transverse
- **Other muscle** — `Right pectoralis minor`, pectoralis major (3 parts),
  `Right serratus anterior`, serratus posterior superior/inferior,
  `Right rhomboid major`, `Right rhomboid minor`, `Right levator scapulae`,
  `Right subclavius`, biceps brachii (long/short head), triceps brachii
  (long/lateral/medial head)
- **Artery** — axillary, circumflex scapular, dorsal scapular, subscapular,
  suprascapular, thoracodorsal, thoraco-acromial
- **Vein** — axillary, circumflex scapular, subscapular, suprascapular,
  thoracodorsal

59 right-side structures, 27 left-side equivalents, plus 1000 meshes in the
shoulder band overall. Every one has a name, an FMA id, laterality and bounds.

**Honest gap:** there are no shoulder nerves, tendons, ligaments or cartilage in
this source. Brachial plexus, axillary nerve, suprascapular nerve, the rotator
cuff tendons and the glenohumeral ligaments are **absent**. Per the brief's "at
least one deeper structure class **where source data supports it**" and "no
invented tissue category", the spike demonstrates depth via the vascular layer,
and the absent classes are reported as absent rather than faked.

---

## 6. Domain boundary

Nothing in this work touches clinical rules, medical interview semantics, episode
identity, provenance semantics, storage semantics, or MCP/API semantics.

The user-selection semantics that must survive any viewer rewrite:

| Rule | Location |
|---|---|
| canonical id set, ordered-unique, first-occurrence-wins | `packages/shared/src/symptom.ts:234-278` (`projectUserSelection`) |
| derived `selectedByUser`, never hand-written | `packages/shared/src/symptom.ts:261-264` |
| field policy note forbidding independent writes | `packages/shared/src/field-policy.ts:121-141` |
| `requiresUserSource` gate | `packages/shared/src/anatomy.ts:573` |
| pinned by | `packages/shared/test/user-selection.test.ts` |

Viewer-side mirrors that must keep matching semantics: `svg2d.ts:120-143`,
`three3d.ts:406-437`, and material precedence
`selected > rejected > highlighted > idle` at `three3d.ts:1032-1058`.

**Requirements to document rather than invent state for:**

1. `TissueLayer` does not distinguish artery from vein, which §4 of the brief
   requires as distinct visual categories. Either the enum gains `artery` and
   `vein`, or the visual system needs a second axis orthogonal to depth. This is
   a domain decision.
2. `TISSUE_LAYER_ORDER` is a single superficial→deep sequence that places `nerve`
   and `vessel` beneath `bone`. Real anatomy is not linear in depth. Whether the
   ordering stays authoritative for anything is a domain question.
3. "Which structures exist in the viewer" is a viewer/asset concern and must not
   become a new persisted clinical field.

---

## 7. Status

| Item | State |
|---|---|
| Branch | `visual/anatomy-atlas-v2`, rebased onto `origin/main` `3337353` |
| Research gate | **passed** — source selected, licence cleared, pipeline route fixed |
| Blender 4.5.14 | installed (portable ZIP), version confirmed |
| MCP bridge | pending four-operation proof (§5.3) |
| Licence provenance | recorded (§3.2); DBCLS re-fetch blocked by local proxy |
| `partof_*` tables | not held, unreachable; IS-A set sufficient (§3.4) |
| Shoulder inventory | scoped from real data (§5.4) |
| Design system | not started — §6 of the brief requires the type scale before UI work |
| Right shoulder spike | not started |