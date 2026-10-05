# RIGHT SHOULDER — geometry acceptance gate

**Verdict: GEOMETRY PASS**, with the caveats in §5.

Gate purpose: decide whether the 99%-reduction BodyParts3D 4.0 geometry is good
enough to build a viewer on, BEFORE any web work. If mesh fidelity itself had
failed, the correct action was to stop and resume source research — not to rescue
it with shaders, transparency or camera tuning. It did not fail.

Branch `visual/anatomy-atlas-v2`. Blender 4.5.14 LTS, headless
(`blender --background`), EEVEE Next.

---

## 1. What was built

`spikes/shoulder-geometry/`

| File | Role |
|---|---|
| `build-shoulder-blend.py` | imports the scoped shoulder anatomy, authors presentation materials, builds lighting and camera, saves `shoulder.blend` |
| `render-gate-one.py` | renders ONE (config, view) pair from the .blend |
| `shoulder.blend` | the built scene |
| `renders/*.png` | 20 gate renders: 5 configurations × 4 views |
| `probe-frame.py`, `probe-materials.py`, `diagnose-blank.py` | diagnostics written while the pipeline was failing; kept because they are what caught the failures |

Reproduce:

```bash
blender --background --factory-startup --python spikes/shoulder-geometry/build-shoulder-blend.py
# then, per pair:
blender --background spikes/shoulder-geometry/shoulder.blend \
        --python spikes/shoulder-geometry/render-gate-one.py -- bone-only front
node scripts/scope-shoulder-review.mjs      # regenerates the inputs first
```

## 2. Structures used — 43, all from real sourced anatomy

Scoped by declared vocabulary, not by a bounding box. The first attempt derived
the region from the anchors' union bounds and swept in 802 meshes including
liver segments and teeth; a box around scapula-to-humerus is not a definition of
"shoulder". Every name below was resolved against the real archive and reported
as found or absent.

| Role | Count | Structures |
|---|---|---|
| bone | 3 | scapula, clavicle, humerus |
| muscle | 27 | rotator cuff (supraspinatus, infraspinatus, subscapularis, teres minor, teres major); deltoid ×3 parts (acromial, clavicular, spinal); trapezius ×3 parts; pectoralis minor + pectoralis major ×3 parts; serratus anterior + posterior superior/inferior; rhomboid major/minor; levator scapulae; subclavius; biceps long/short head; triceps long/lateral/medial head |
| artery | 7 | axillary, suprascapular, circumflex scapular, dorsal scapular, subscapular, thoracodorsal, thoraco-acromial trunk |
| vein | 5 | axillary, suprascapular, circumflex scapular, subscapular, thoracodorsal |
| skin | 1 | whole-body `Skin` mesh |
| **total triangles** | **402,490** | 199,108 excluding whole-body skin |

**Declared absent, deliberately:** `Right axillary nerve`, `Suprascapular
nerve`. BodyParts3D has 42 nerve meshes in the entire body and **none** in the
shoulder — no brachial plexus, no axillary or suprascapular nerve. There are also
no shoulder tendons, ligaments or cartilage. The spike therefore does not claim a
nerve layer, and must not imply one.

## 3. Materials came from the reviewed classification, not from names

Every material is assigned from `anatomy-system-map.json`, whose classes come
from a walk of the licensor's own FMA IS-A hierarchy. `render-gate-one.py` reads
`system` per mesh id and looks up `ASI_<system>`; it contains no name pattern.

| System | Base colour | Rationale |
|---|---|---|
| bone | 0.945, 0.925, 0.855 ivory | standard anatomical illustration |
| muscle | 0.520, 0.185, 0.155 dull red-brown | deliberately desaturated: a vivid red muscle in a health product reads as inflammation, and nothing here is inflamed |
| artery | 0.680, 0.105, 0.105 | convention |
| vein | 0.150, 0.265, 0.540 | convention |
| nerve / cartilage / tendon / ligament / fascia / gland / skin | defined, unused at the shoulder | present for later regions |

Each render logs what it actually showed, by system, so a config that silently
shows everything is visible in the log and not only in the pixels:

```
[GATE] supraspinatus-only   lateral  visible=  1 inframe=  1 systems={"selected:Right supraspinatus": 1}
[GATE] bone-only            front    visible=  3 inframe=  3 systems={"bone": 3}
[GATE] bone-muscle          back     visible= 30 inframe= 28 systems={"bone": 3, "muscle": 27}
[GATE] vascular-overlay     oblique  visible= 15 inframe= 15 systems={"bone": 3, "artery": 7, "vein": 5}
```

Selection is a **separate visual state**, not an anatomical material: a cyan
`(0.35, 0.95, 1.0)` at 0.55 emission. It reads unambiguously as "you picked
this" and cannot be mistaken for tissue, inflammation, or a finding.

## 4. Judgement, criterion by criterion

| Requirement | Verdict | Evidence |
|---|---|---|
| not a gray blob | **PASS** | every structure carries its class material |
| bone immediately distinguishable | **PASS** | `bone-only__front.png` — clavicle S-curve, scapula blade with glenoid, acromion and coracoid, humeral head and tubercle, all unmistakable |
| individual muscles understandable | **PASS** | `muscle-only__back.png` — trapezius with three converging parts, deltoid cap, rhomboids, levator scapulae, serratus all separable, with fibre striation |
| surface vs deep legible | **PASS** | `bone-muscle__oblique.png` — superficial deltoid over deeper muscle, exposed bone where nothing covers it |
| at least one deeper class where source supports it | **PASS** | `vascular-overlay__oblique.png` — axillary artery/vein pair through the armpit, suprascapular branches over the scapular spine; artery vs vein instantly separable through translucent bone |
| isolate | **PASS** | `supraspinatus-only__*.png` — exactly one structure, cyan, framed on itself |
| material distinction | **PASS** | bone/muscle/artery/vein separable at a glance in every combination |
| Front/Back/Left/Right framing correct | **PASS** | after fixing §6.1 — verified by axis assertion, not by eye alone |
| no guessed anatomy | **PASS** | 2 agent-proposed classifications, flagged; 2 declared-absent nerves |

## 5. Caveats — real limits, carried forward

1. **Visible faceting at close range.** The supraspinatus is 878 triangles and its
   flat facets are plainly visible when isolated and framed. Serratus anterior
   shows planar banding in the combined view. This is the 99% polygon reduction
   and it does not go away in the browser.
2. **Ragged mesh edges.** Reduction tore some boundaries — visible as fraying at
   the serratus inferior border and at the supraspinatus insertion.
3. **No shoulder nerves, tendons, ligaments or cartilage exist in this source.**
   Not a rendering problem; the data is absent. A viewer must not offer a nerve
   toggle for this region.
4. **Skin is whole-body only** (203,382 triangles, 1.72 m). There is no regional
   skin, so a skin toggle will need either the whole body or a different source.
5. **Vessel geometry is coarse.** Several shoulder vessels are 15–25 mm across
   and 200–800 triangles; they read as tubes, not as fine branches.
6. **BodyParts3D 4.0 99% is the only published bulk geometry.** Historical 3.0
   had a 95% package; it is a different release and was not substituted.

## 6. Six defects found by looking, not by reasoning

Every one of these produced a plausible-looking success. None would have been
caught by a passing test.

### 6.1 The importer silently rotated the body

`wm.obj_import` defaults to `forward_axis='NEGATIVE_Z'`, `up_axis='Y'`. The
imported y range came out as −1506…−969 mm, which is exactly −(source z). With
that default, **Front/Back/Left/Right would have addressed the wrong sides of the
body** and produced plausible, confident, wrong pictures. Fixed with
`forward_axis="Y", up_axis="Z"`, and guarded by an assertion comparing the
imported bounding box against the reviewed source bounds per axis, which now
reports `all three axes agree`.

### 6.2 Twenty blank renders reported as success

The first batch wrote 20 files, every one exactly 962,087 bytes, every one an
empty world-coloured rectangle. Cause: `wm.obj_import` re-centres each mesh on
its own origin, so mesh data arrived at z≈0 regardless of body position, and the
subsequent offset pushed the shoulder 1.24 m below the camera target. Cause of
the *concealment*: the byte counts were plausible and nothing checked the pixels.

Now fixed, and every render is refused if nothing is in frame. Two further traps
in the same guard: the in-frame test used `matrix_world.translation`, which is a
shared offset point for all 43 objects and sits permanently outside the frame —
it reported 0/27 in frame for twenty correct renders — and the camera aimed at
the world origin rather than the visible set's centre, which threw isolated
structures out of frame as soon as the distance tightened.

### 6.3 Area lights were never aimed

Left at their default they emit straight down and lit the floor.

### 6.4 Exposure was about two stops hot

900 W area lights at 0.9 m bleached muscle and bone to the same near-white,
destroying the exact judgement the render exists to support. Lights are now
derived from the subject radius. `view_transform` is pinned to `Standard`, not
Blender 4's AgX default, which desaturates highlights — the wrong behaviour when
the question is whether muscle reads differently from bone.

### 6.5 The isolate was a silent no-op

`supraspinatus-only` passed `["muscle"]`, so all 27 muscles rendered and the
output was byte-identical to `muscle-only`. What gave it away was not the
picture but two suspiciously equal byte counts. Configs now log their visible set.

### 6.6 The selection highlight was rendering white

`ASI_selection_highlight` had no users, and Blender drops zero-user datablocks
when saving a .blend — so it was absent from the file and the isolate fell back to
an empty material slot. Fixed with `use_fake_user`, plus a defensive recreate in
the render script. Separately, materials were being created per object rather
than per system, yielding `ASI_muscle.001` … `ASI_muscle.027`.

**Also recorded:** over the MCP bridge only the FIRST `bpy.ops.render.render()`
per scene succeeds — a four-view batch produced one image, always the first view,
with status success and no traceback. The gate renders are therefore headless and
one-frame-per-process. The bridge remains the right tool for interactive
inspection; it is not the right tool for a gate that must repeat.

## 7. What this unlocks

Geometry passes, so per the agreed order the next steps are the viewer
capabilities: system visibility, isolate, hide, opacity, search, selection, the
four camera presets, orbit, pan, zoom, reset, region focus — and then a 3D
section / clipping view, which must be labelled as a section over surface meshes
and **not** as a CT/MRI-like anatomical slice. True axial/coronal/sagittal
sections need volumetric data and remain a later source decision.

Design-system work follows the anatomy, per the agreed order.

The domain stays untouched. The user-selection semantics that must survive any
viewer rewrite are listed in `docs/research/anatomy-visual-v2.md` §6 and are
unchanged by this spike.