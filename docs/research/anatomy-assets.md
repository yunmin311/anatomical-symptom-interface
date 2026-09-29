# Anatomy assets — research and decision

**Question:** where do labelled, layered, licence-clean 3D anatomy models come from,
and what does it cost to make one usable?

**Status:** decision deferred. V1 ships with a schematic 2D SVG map. This doc records
the options so the Phase 1 decision is an informed one rather than a scramble.

## What we actually need

1. **Named structures** with stable IDs we control.
2. **A region hierarchy** (body → region → sub-region → structure).
3. **Layers** we can toggle: skin, fascia, muscle, tendon, ligament, joint, bone, nerve, vessel.
4. **A licence** that survives contact with a real product.
5. **Reasonable geometry** — not research-grade topology.
6. Under ~10MB for the four V1 regions, or the app dies on load.

---

## Option A — BodyParts3D (Database Center for Life Science, Japan)

**What it is:** ~1,500 anatomical structures as OBJ/GLB, derived from the **Foundational
Model of Anatomy (FMA)**, with a full region hierarchy and English + Japanese names.
CC-BY-SA 2.1 JP.

**Strengths**
- **The FMA derivation is the killer feature.** We are already planning to bind our
  structures to FMA. BodyParts3D *is* that binding, already done, by an institution
  that maintains it. That removes an entire verification project.
- Named, hierarchical, licence that permits commercial use with attribution and share-alike.
- Freely redistributable. No per-user cost at any scale.

**Weaknesses**
- Research dataset: geometry is dense and unoptimised. Expect a heavy decimation pass.
- Naming is FMA-flavoured, not patient-friendly. Every structure still needs a
  `layTerm` written by a human.
- Not designed for interactive use; you own the whole conversion pipeline.

**Verdict: the strongest V1 3D candidate.** The FMA alignment outweighs the pipeline cost.

---

## Option B — BioDigital Human

**What it is:** a hosted, browser-embeddable 3D human with a Developer Platform and a
Viewer API — camera control, object visibility, selection, highlight, search, dissection.

**Strengths**
- **The best-in-class reference for what the Anatomical Model Layer should feel like.**
  Their API surface is effectively the spec for our `AnatomyAdapter` interface.
- Production quality, already solved the hard rendering problems.
- Free tier / demo access makes it trivial to study the interaction.

**Weaknesses**
- Hosted. Availability is not ours to guarantee.
- Pricing and licensing for a real product are not published clearly enough to plan around.
- Proprietary asset — we could not ship our own version of it.
- Structural lock-in: their object IDs, their hierarchy, their API.

**Verdict: study it, do not depend on it.** Copy the interaction contract. Run a spike
against their API to see whether the free tier is enough for Phase 0 validation, then
decide deliberately. Treat any dependency as time-boxed and reversible.

---

## Option C — Z-Anatomy

**What it is:** an open human anatomy model authored in Blender, distributed for
educational use with region-based dissections and labelled structures.

**Strengths**
- Built in Blender — far cleaner topology than research datasets, so it renders well.
- Region-based rather than structure-based grouping, which matches how users think.
- Free and openly licensed.

**Weaknesses**
- Smaller structure set than BodyParts3D. Less depth for tendon/ligament/nerve work.
- **Licence needs verification before any commercial use.** Confirm redistribution terms.
- Less maintained; check the last commit and open issues before depending on it.

**Verdict: viable alternative or complement.** If its licence checks out, it is the
better *rendering* asset while BodyParts3D is the better *terminology* asset.

---

## Option D — Visualize Anatomy / medical illustration sources

Commercial 3D assets (Anatomage, 3D Organon, Visible Body academic licence) and
classical atlases.

- **Grey's Anatomy (1918)** — public domain, high-quality plates, but 2D and pre-modern.
  Genuinely useful for `layTerm` wording and for the lay-term ↔ anatomical-term pairs.
- **Sobotta / Netter / Thieme** — excellent, but **copyrighted, not redistributable**.

**Verdict: reference and writing material only.** Never as shipped assets. Netter in
particular is the standard clinicians recognise; learning its visual conventions is
worthwhile, copying it is not.

---

## Recommendation

| Phase | Asset | Rationale |
|---|---|---|
| **Phase 0 (now)** | Schematic 2D SVG, authored in-repo | Validates "do users localise better visually?" in a day, with zero licensing and zero download. Already built. |
| **Phase 1** | **BodyParts3D → GLB**, decimated, with a generated `asi:*` manifest | FMA alignment is worth the pipeline. Terms become a reference, not a guess. |
| **Phase 1 (alt)** | Z-Anatomy for rendering + BodyParts3D for terminology, if its licence clears | Best visual quality, still licence-clean. |
| **Phase 2+** | Own pipeline in Blender, seeded from the above | Full control, own asset, own ID space. The only durable answer long-term. |

### The one artefact that matters

Whatever we pick, the deliverable is not the mesh. It is the **manifest**:

```jsonc
{
  "asiId": "asi:shoulder.supraspinatus-tendon",
  "meshName": "Supraspinatus_tendon_L",
  "layer": "tendon",
  "region": "shoulder",
  "subRegionId": "shoulder.lateral",
  "fma": "29823",          // status: "unverified" until checked
  "layTerm": "the tendon over the top of the shoulder joint",
  "bounds": { "min": [...], "max": [...] }
}
```

Everything upstream — the SVG map, the 3D viewer, the interview engine, the summary —
keys off `asiId`. The mesh format is a swappable detail. Building the manifest first,
against 2D, means the 3D upgrade is a rendering change and not a data migration.

## Why 2D first is the right call, not a compromise

- The core validation question (§12 of the plan: *do users describe location better
  with a visual aid?*) does not require 3D. It requires a visual aid.
- People self-report in front/back terms — "the front of my shoulder" — and a 2D
  front/back map matches that language better than a model they have to rotate.
- 2D is keyboard accessible, screen-reader addressable, and works on a five-year-old
  phone. A 3D canvas is a worse form for the first interaction.
- 3D's real value is the **layer** interaction — hide skin, show the cuff, highlight a
  tendon. That is exactly what the interview engine needs, and exactly what a
  `showLayers` command on the adapter interface will drive later.

The 2D map is the control. The 3D model is the enhancement.
