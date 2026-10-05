# Anatomy Visual V2 — asset source decision

Status: **research gate.** No production code has been changed on this branch.
Branch: `visual/anatomy-atlas-v2`, based on `origin/main` (`dbd9c1f`).

Scope: replace the anatomy **visualisation** architecture and redo the product
visual design. The engineering/domain V1 stays valid. Nothing in
`packages/shared`, `packages/server`, `packages/mcp` is touched by this work.

---

## 1. Why the current result failed — diagnosed, not guessed

Three independent causes, in order of severity.

### 1.1 There is no anatomical category data in the asset at all

This is the root cause of "muscles / tendons / bones / nerves / vessels cannot be
understood as layers". It is **not** a shader bug.

`assets/anatomy/source/obj/isa_BP3D_4.0_obj_99/` holds 2234 OBJ files. Measured
across the whole set:

| Signal | Count | Meaning |
|---|---|---|
| files containing `mtllib` | **0** | no material library ships with the geometry |
| files containing `usemtl` | 2234 | every file *names* a material that does not exist |
| files containing `g ` groups | 2234 | one group per file |

So the OBJ set references a material per part and then never provides it. There is
no colour, no tissue type, no layer assignment anywhere in the geometry.

The accompanying tables confirm it:

- `isa_parts_list.txt` — 2905 rows, columns `concept id / representation id / en / kanji / kana`.
  **No tissue-class column.** FMA id and English name only.
- `isa_element_parts.txt` — 29549 rows, `concept id / name / element file id`. Decomposition only.
- `isa_inclusion_relation_list.txt` — FMA parent/child edges (IS-A + PART-OF). Ontology only.

Name-keyword frequency across the 2905 parts shows the coverage shape:

```
artery 684   vein 318   bone 88   muscle 93   vertebra 63   nerve 55
duct 58   cartilage 44   ligament 38   organ 52   gland 16   tendon 8   fascia 8
```

Two consequences:

1. **A layer taxonomy has to be authored.** It cannot be read off the asset. The
   FMA IS-A tree can be walked to high-level ancestors to *derive* a taxonomy,
   but FMA's high-level nodes are anatomical structures, not tissue types, so that
   walk is real work with a hand-checked mapping table — not a one-liner.
2. **Vascular coverage is heavily over-represented** relative to the other
   systems. Any naive "load everything and colour by name" approach will produce a
   body that is mostly blood vessels.

### 1.2 The geometry on disk is the 99% polygon-reduction set

`README_e.html` and every OBJ header confirm: `Polygon reduction rate = 99%`.
BodyParts3D publishes several reduction rates; only the most aggressive one is in
the repo. This is a direct cause of "visually ambiguous gray geometry" — coarse
silhouettes and mushy surface detail that no material system can rescue.

Every OBJ header does carry useful metadata, which is worth keeping:

```
# File ID       : FJ1252
# Representation: BP5633
# Concept ID    : FMA59763
# English name  : Gingiva of upper jaw
# Bounds(mm)    : (-35.46,-181.68,1461.35)-(34.14,-127.71,1479.84)
# Volume(cm3)   : 21.7585
```

Per-part anatomical bounds in mm. That is enough to auto-derive region bounding
boxes and laterality checks without hand-authoring a region table.

### 1.3 The viewer has no visual model to hang layers on

Measured in the current code:

- No `clippingPlanes`, no `localClippingEnabled`, no `DoubleSide`. **Zero** clipping
  or cross-section code anywhere in the repo.
- No per-layer opacity. Opacity is derived from selection state only
  (`three3d.ts:1017-1062`): active subregion 0.95, idle 0.8, selected 1.0, rejected
  0.35, default idle 0.62.
- `showLayers` / `hideLayers` exist in the `ViewerCommand` union and are implemented
  in both adapters, but **no production code dispatches them** — tests only.
- **No isolate.** The word does not appear in any viewer code.
- **No orbit.** `Body3d.tsx:20-21` states there is no drag-to-rotate requirement.
  The only way past occluding geometry is a camera preset.
- `CameraPreset` is `position` + `target` only (`three3d.ts:69-74`). No per-view
  layer masks, no per-view clipping.
- "Layers currently shown" is a **read-only** `<ul>` of names (`BodyMap.tsx:525-531`).

So "layer controls do not visibly change the anatomy" is literal: there is no layer
control, and `setDepth` only maps to `layersForDepth` (`three3d.ts:1406-1417`).

### 1.4 Why the 2D map is not salvageable

`apps/web/src/anatomy/svg-geometry.ts` is 474 lines of hand-authored cubic-Bézier
path strings across four view silhouettes and 14 zones. One detail is load-bearing
and must be respected by any replacement: `location.point` is persisted as 0..1
against `VIEW_W=100 × VIEW_H=186` (`svg-geometry.ts:26-33`), so that box is a
storage contract. A replacement 2D surface must keep the same normalised coordinate
space or every stored pin moves.

---

## 2. Source comparison

### 2.1 Z-Anatomy

Repo: `Z-Anatomy/Models-of-human-anatomy`, 218 stars, 49 forks, last push 2026-10-04.
Content is **not** loose meshes — it is a Blender *application template*:

| File | Size | What it is |
|---|---|---|
| `Z-Anatomy.zip` | 86.7 MB | the `.blend` template — 5000+ structures, this is the atlas |
| `Z-Biomechanics.7z` | 21.6 MB | biomechanics variant |
| `TA2.csv` | 1.5 MB | Terminologia Anatomica 2 (2019) nomenclature table |
| `Anatomy-shortcuts.py` | 291 KB | the viewer/labelling add-on |
| `CheatSheet.png` | 283 KB | keymap reference |

Zenodo record `4953712` (DOI `10.5281/zenodo.4953712`) distributes the same
`Z-Anatomy.zip` at **130.0 MB**. Note the size mismatch against GitHub's 86.7 MB —
different revisions, so pick one and record which.

Assessment:

- **Coverage** — 5000+ structures vs BodyParts3D's 2905, and organised per **TA2**.
  This is the strongest coverage of any open whole-body atlas.
- **Layer hierarchy** — this is the decisive advantage. Z-Anatomy is built by an
  anatomist/medical illustrator (Gauthier Kervyn) for teaching, so the
  per-structure system/layer categorisation BodyParts3D lacks is very likely
  already authored. **This has to be verified against the actual `.blend`, not
  assumed** — see §5.
- **Blender compatibility** — native. It *is* a Blender template. No conversion.
- **Cross-section / isolate** — already implemented in its own add-on. The project
  description lists, verbatim: *"to easily add labels, -import definitions, -to
  automatically display the labels and definition of the active object, -to
  translate all the structures at once, **-to create cross sections**, -to reach all
  the object's collections in two clicks, -to show/hide/**isolate** only the parts of
  interest"*. That is a working reference implementation of §3's requirements, in
  Python, in a file we can read. We are porting, not inventing.
- **Web export** — none shipped. Requires a Blender export pass. Unverified.

### 2.2 BodyParts3D 4.0 (current source, already on disk)

DOI `10.18908/lsdba.nbdc00837-000`, dated 2025-02-27, 2234 OBJ at 99% reduction,
plus the five metadata tables already listed. Licence **CC BY-SA 2.1 Japan**,
confirmed in every OBJ header.

- **Coverage** — 2905 parts, whole body, FMA-identified. Genuinely complete.
- **Mesh quality** — this is the *reduced* set. Full/low-rate variants are separately
  downloadable and are the obvious fix for §1.2.
- **Layer hierarchy** — absent. See §1.1.
- **Blender compatibility** — OBJ import is trivial and well-trodden.
- **Cross-section** — no. It is a surface mesh set.
- **Attribution already present** — `AnatomyAttribution.tsx` renders a disclosure,
  and `attribution` is enforced by `assertProductionSceneIsReal`
  (`active-scene.ts:237-250`). That machinery is reusable as-is.

### 2.3 BioDigital Human — product benchmark only

Use as the **UX target**, not as a dependency. Benchmarking the interaction model
they are known for: complete-body hierarchy with progressive disclosure, structure
search, isolate, hide/show, opacity, system filtering, labels, camera/navigation,
cross sections.

- **Do not build on it.** Their viewer is proprietary and vendor-hosted. Making ASI
  depend on it would invert the architecture: ASI's whole premise is local-first
  and provider-agnostic. No API decision has been made and none is proposed.
- **What to steal** — the interaction vocabulary, and the *labelling density*. That
  is design input, freely reusable.

### 2.4 NIH Visible Human Project

The licence-cleanest option, and the only true cross-section source.

- **Licence** — **public domain** (US federal government work). NLM: *"the VHP
  provides a public-domain library of cross-sectional cryosection, CT, and MRI
  images"*. As of July 2019 the NLM data licence was replaced by plain Terms and
  Conditions and **no registration is required**.
  Note: the data.gov/Virginia catalogue rows show ODbL and "No License Provided"
  respectively — those describe the *catalogue metadata record*, not the images.
  Do not mistake them for the image licence.
- **Data** — male: 1871 axial anatomical sections at 1 mm, 2048×1216 px, 0.33 mm
  per pixel, 24-bit colour, ~15 GB. Plus 1 mm axial CT and 4 mm axial MRI of head
  and neck.
- **Volumetric, not a mesh atlas.** Meshing it is a real project (segmentation →
  surface extraction), not a format conversion. It does not solve layers.
- **Role** — the reference for genuine axial/coronal/sagittal cutaway. Also a
  licence-clean way to source cross-sectional imagery.

### 2.5 Open Anatomy Project (Brigham and Women's Hospital / SPL)

Found during the search; worth recording. CT-derived atlases — SPL/NAC brain, inner
ear, knee, head & neck, abdomen, liver — with skeletal, vasculature, muscle and
organ content, built in 3D Slicer, viewed via Open Anatomy Browser. Real
clinical-quality geometry, and *knee* is directly relevant to a later phase.

**Licence not yet verified.** Treat as blocked until checked; it is a
Brigham/Harvard research asset and commercial use is the open question. Recorded
here so it is not rediscovered later, not as a recommendation.

### 2.6 Decision matrix

| Criterion | Z-Anatomy | BodyParts3D | BioDigital | Visible Human | Open Anatomy |
|---|---|---|---|---|---|
| Coverage | 5000+ structures, TA2 | 2905 parts, FMA | complete, commercial | whole body, volumetric | region atlases |
| Mesh quality | retopo'd, instanced, completed | **99% reduced on disk**; better rates available | production | n/a (volumetric) | clinical CT |
| Layer hierarchy | **likely authored** — verify in `.blend` | **absent** | authored | none | authored |
| Blender compatibility | **native** (it is a template) | OBJ import | n/a | external meshing | Slicer |
| Web export | none — needs a pass | already done | n/a | needs meshing | viewer exists |
| Licence (as declared) | **conflicting** — see §3 | CC BY-SA 2.1 Japan | proprietary | **public domain** | unverified |
| Redistribution | ShareAlike + possible NC | ShareAlike | no | **yes, unrestricted** | blocked |
| Attribution | long, multi-party, required | one line, present in code | n/a | courtesy NLM | blocked |
| Performance | must be decimated/streamed | current 1.4 MB total | n/a | must be meshed | varies |
| Cross-section | **implemented in its add-on** | no | yes | **native slices** | no |
| Mobile suitability | needs LOD work | good (small) | n/a | n/a | varies |
| Integration cost | **highest** (new pipeline) | lowest (already built) | n/a | very high | unknown |

---

## 3. Licence analysis — the blocking finding

The brief said: *"derivative assets must NOT silently inherit the repository MIT
licence."* Confirmed, and the situation is worse than that.

### 3.1 ASI is MIT

Root `package.json` declares `"license": "MIT"`.

### 3.2 BodyParts3D is ShareAlike

CC BY-SA 2.1 Japan. ShareAlike is copyleft. A derivative of BY-SA material must
carry BY-SA, and ASI's MIT grant cannot extend to it. So the current arrangement
is already only safe because it never bundled the geometry into the code grant —
the geometry sits in `assets/` and `public/` as data. **That separation must be
made explicit and enforced, not left implicit.** It needs its own licence file and
attribution block that no MIT header can override.

### 3.3 Z-Anatomy is CC BY-SA 4.0 *and* incorporates NonCommercial parts

The repo's own attribution block, verbatim:

```
- BodyParts3D — CC-BY-SA 2.1 Japan
- "Brainder" and "White matter" from the University of Washington   <- no licence stated
- Cranial Nerves and Foramina — Univ. of Dundee, CAHID — CC-BY 4.0
- Anatomy of the Inner Ear — Univ. of Dundee School of Medicine — CC-BY-NC-SA 4.0   <- NC
- Kidney — by Lissie Cowley — CC-BY-NC 4.0                                        <- NC
- Wikipedia — CC-BY-SA 3.0
```

Two **NonCommercial** components sit inside a work whose top level is declared
CC BY-SA 4.0. Those NC terms do not evaporate because the aggregate header says
otherwise, and CC BY-SA 4.0 §3(b) forbids adding technological or legal measures
that restrict what the licence permits. So:

1. **The full Z-Anatomy work cannot be redistributed on commercial terms**, whatever
   its header claims.
2. **The upstream declaration is internally inconsistent**, which means "what is the
   licence of Z-Anatomy" has no clean single answer. That is a supply-chain risk in
   itself.

### 3.4 Two official distributions of the same asset declare different licences

| Distribution | Declared licence |
|---|---|
| GitHub `License.txt` / `Readme.md` | **CC BY-SA 4.0** |
| Zenodo `4953712` rights field | **CC BY 4.0** |

These are incompatible. A downstream user cannot satisfy both. Attribution here is
citable (`10.5281/zenodo.4953712`), so the conflict has to be resolved deliberately
and recorded, not glossed.

### 3.5 Conclusion for this project

- **Do not adopt Z-Anatomy wholesale.** NC contamination plus a licence conflict
  plus an unstated licence for the UW brainder component is too much for an asset
  that must be redistributable in a health product.
- **Where Z-Anatomy is still valuable:** its `Anatomy-shortcuts.py` is a readable
  reference for cross-section and isolate implementation, and its `TA2.csv` is a
  nomenclature table. Reading a GPL/CC script for ideas is fine; **copying its code
  into MIT ASI is not**, and the add-on's own licence is not stated in the
  attribution block either. Treat as read-only reference.
- **The Blender step is a licence-isolation tool, not just a geometry tool.** That
  reframing is the strongest argument for it: Blender is how you take a mixed-licence
  aggregate and export a subset with a defensible provenance record per part.

### 3.6 Required repository changes before any asset lands

1. `assets/anatomy/LICENSE.md` — per-source licence, attribution string, and an
   explicit statement that no asset is covered by the root MIT grant.
2. Keep geometry out of any MIT-licensed path. `assets/` and `public/anatomy/` are
   the boundary; nothing under them may be described as MIT.
3. A provenance record per exported part, carried into the manifest so attribution
  is not lost in the pipeline.
4. Verify the BodyParts3D CC BY-SA 2.1 Japan attribution text currently surfaced by
   `AnatomyAttribution.tsx` matches the licence's required wording exactly.

**This is a legal question, not an engineering one. It needs your decision or your
lawyer's, not mine.** Everything below is written on the assumption that a
redistributable, attribution-clean, commercially-safe atlas is required.

---

## 4. Root-cause summary for the visual work

| Reported symptom | Actual cause | Layer to fix |
|---|---|---|
| "crude hand-made schematic" (2D) | hand-authored Bézier paths | asset/source, §5 of brief |
| "small regional bundle of BodyParts3D meshes" | 95 GLBs, region-only exports | asset pipeline |
| "visually ambiguous gray geometry" | 99% polygon reduction **and** no material data at all | asset pipeline |
| "muscles/tendons/bones/nerves/vessels cannot be read as layers" | **no tissue-class data exists in the asset** | taxonomy authoring |
| "Front/Back/Left/Right are camera presets" | they are; `position`+`target` only | viewer |
| "no isolate/hide/layer/opacity/clipping/cross-section" | genuinely not implemented; `showLayers`/`hideLayers` unreachable from production | viewer |
| "typography hierarchy too weak" | 19 literal font sizes, 10 in the workspace, **no type scale in `tokens.css` at all** | design system |
| "canvas does not dominate" | layout | design system |

---

## 5. Recommendation, and what must be verified before committing

No route is endorsed yet. Two things must be checked in the actual data first,
because they decide it.

### 5.1 Open question A — does Z-Anatomy's `.blend` really carry a layer taxonomy?

Everything favourable about Z-Anatomy rests on this. Its TA2 organisation may be
*nomenclature only* (i.e. "this part is called X") with no system assignment at all
— in which case its advantage over BodyParts3D is naming and labelling, not
layers, and the case for it weakens a lot given §3.

Resolve by opening `Z-Anatomy.zip` in Blender and dumping the collection structure
and per-object custom properties. Cheap, decisive.

### 5.2 Open question B — is a licence-clean categorised atlas obtainable at all?

Three outcomes, in descending preference:

1. **BodyParts3D at a better polygon reduction + an authored taxonomy.** Keeps the
   clean single-party CC BY-SA 2.1 Japan provenance we already ship, and the
   `isa_inclusion_relation_list.txt` FMA edges give a real basis for authoring the
   taxonomy rather than guessing it. Cost: taxonomy is our work and needs clinical
   review — which this project already has a home for in `unreviewedSafetyRules`
   style metadata.
2. **Z-Anatomy with NC-bearing components surgically excluded** in Blender. Highest
   fidelity, but leaves a per-part provenance question and a citation conflict.
3. **Visible Human for cross-sections, a categorised surface atlas for the mesh.**
   Licence-clean on the slicing axis, but two sources to reconcile.

Option 1 is the one I would defend today, on licence grounds alone. It is also the
cheapest, because the pipeline already exists — what is missing is geometry
resolution and a taxonomy, not a new toolchain.

### 5.3 Blender route

Required either way, and §5.2 option 2 makes it mandatory. Blender is **not
currently installed** on this machine — not on Windows, not in WSL — and **no MCP
bridge is configured** (both `~/.claude.json` mcpServers and the opencode config are
empty of MCP servers).

Candidates found, with the brief's "prefer mature Codex-compatible" in mind:

| Route | Stars | Last push | Note |
|---|---|---|---|
| `ahujasid/mcp-for-blender` | ~30.0k | 2026-09-30 | by far the most mature; explicitly "any LLM" |
| `dcc-mcp/dcc-mcp-blender` | ~45 | 2026-10-04 | the `dcc-mcp` suite (core/blender/maya) |
| `arjun988/blender-skills` | ~267 | 2026-07-10 | 94 Blender skills for Codex/Cursor/Claude |
| `webita/blender-codex-mcp` | ~6 | 2026-04-29 | small, Codex-specific |

Recommendation: **`ahujasid/mcp-for-blender`** — 30k stars and actively maintained,
against 45 for `dcc-mcp-blender`. The brief names `dcc-mcp` first, but it is ~1/650th
the size and three days old. One bridge only, as instructed.

Note the irony worth stating plainly: the whole point of this pass is to stop
hand-making anatomy, and Z-Anatomy's *own* Python already does isolate, labels and
cross sections. A large part of §3 may be **portable from a file we can read**,
without a model in the loop at all.

---

## 6. Domain boundary

Nothing here touches clinical rules, interview semantics, episode identity,
provenance semantics, storage semantics, or MCP/API semantics.

The user-selection semantics that must survive any viewer rewrite, with their
current locations:

| Rule | Location |
|---|---|
| canonical id set, ordered-unique, first-occurrence-wins | `packages/shared/src/symptom.ts:234-278` (`projectUserSelection`) |
| derived `selectedByUser`, never hand-written | `packages/shared/src/symptom.ts:261-264` |
| field policy note forbidding independent writes | `packages/shared/src/field-policy.ts:121-141` |
| `requiresUserSource` gate | `packages/shared/src/anatomy.ts:573` |
| pinned by | `packages/shared/test/user-selection.test.ts` |

Viewer-side mirrors exist in both adapters and must keep matching semantics:
`svg2d.ts:120-143`, `three3d.ts:406-437`, and the material precedence
`selected > rejected > highlighted > idle` at `three3d.ts:1032-1058`.

One new domain requirement to document rather than invent state for: the brief's
"which structures exist in the viewer" is a **viewer/asset** concern. It must not
become a new persisted clinical field. If a viewer capability turns out to need
domain support, it gets written up as a requirement, not invented.

---

## 7. Blockers requiring your decision

1. **Blender is not installed.** Windows and WSL both checked. Installing it is a
   ~1.5 GB download and a machine-level change, so it needs your go-ahead.
   Confirm: Blender for Windows (GUI, matches the Z-Anatomy template workflow), or
   headless in WSL for scripted batch export?
2. **No Blender MCP bridge is configured.** Recommendation
   `ahujasid/mcp-for-blender` above. Confirm before I wire one.
3. **The Figma skills named in the brief do not exist in this environment.**
   Verified — `figma-generate-design`, `figma-generate-library`, `figma-use` are all
   absent, as is every other Figma integration. Available design-adjacent skills are
   `frontend-design` (design guidance) and `tabbit` (browser visual verification).
   So §0's "use the Figma skills" cannot be followed as written, and there is no
   Figma account or token here. Proposed substitute: do the design-system pass as a
   written spec plus implemented tokens in `tokens.css` — the type scale that does not
   exist yet — and verify visually with `tabbit`. Say if you would rather supply a
   Figma MCP server first.
4. **PR #12 is open, not merged.** The brief says to start from clean main *after*
   it merges. It is `CLEAN`/`MERGEABLE`, touches only `scripts/audit-serve.sh`
   (-5 lines), and cannot conflict with docs. This branch is based on `dbd9c1f`
   (`origin/main`). If you want it rebased after #12 lands, say so — it is a
   one-command rebase.
5. **The licence questions in §3 need a human answer**, especially whether ASI must
   stay redistributable and commercially safe. Option 1 in §5.2 is my recommendation
   and the most defensible, but it means authoring a taxonomy with clinical review.