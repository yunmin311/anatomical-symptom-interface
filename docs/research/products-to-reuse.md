# Products to learn from, borrow from, or reuse

Grouped by what we would actually *do* with them. Links are to official sources only.

---

## 1. Anatomy visualisation — the model layer

### BioDigital Human — the reference implementation
- Developer platform: https://developer.biodigital.com/
- Viewer API: https://developer.biodigital.com/docs/widget/getting-started/overview

**What to take:** the API contract. Their viewer exposes camera, object visibility,
selection, highlight and search — which is precisely our `ViewerCommand` / `AnatomyAdapter`
surface. Study the interaction, then re-implement behind our own interface.
**What not to take:** the dependency. Hosted, proprietary, unpublished pricing for real
product use. If we embed it, we have made someone else's roadmap our critical path.
**Action:** 1-day spike. Embed their widget, drive it from our orchestrator, and see
whether the agent-controlled-viewer experience actually feels better than the 2D map.
If it does, that is a strong Phase 1 signal — and a decision to make deliberately.

### BodyParts3D (DBCLS) — the asset source
- https://lifesciencedb.jp/bp3d/

**What to take:** the meshes and the FMA-derived structure hierarchy. CC-BY-SA 2.1 JP,
commercially usable with attribution. See `anatomy-assets.md`.

### Z-Anatomy — the rendering-quality alternative
**What to take:** Blender-authored geometry with region-based dissections. Nicer to look
at and lighter than research datasets. Verify the licence before committing.

### Visible Body / Anatomage — commercial reference
**What to take:** interaction design reference. Do not ship their assets.

---

## 2. Symptom collection and clinical interviewing

### Infermedica
- API guide: https://help.infermedica.com/how-to-start-building-a-simple-symptom-checker-with-infermedica-api
- Body avatar article: https://infermedica.com/blog/articles/the-role-of-body-avatars-in-symptom-checkers-and-how-to-work-with-them

**What to take:** their body-avatar article is the best published thinking on *why* a
visual body aid changes symptom collection — read it before designing the map. Also study
how their question set narrows by region, which is what our `INTERVIEW` registry does.
**What not to take:** as a diagnosis backend. The plan explicitly warns against binding
the product to one third-party diagnosis API. Use them as a design reference and, if
useful, as a Phase 3 validated layer — behind its own interface, not in the core path.

### Ada Health, Buoy Health, Symptoma
**What to take:** UX benchmarks for symptom checkers. Specifically:
- How few questions they ask before feeling useful. Our 2–3 minute target is the same
  problem; compare their step counts.
- How they present **confidence without being falsely reassuring**. This is hard, and
  their answer is a reasonable prior art for our candidate/confirmed separation.
- Their copy tone under uncertainty. Study how they avoid both alarmism and false comfort.
- How they end a session. We end with a pre-visit summary, which is a deliberate
  difference worth being able to justify.

### NHS 111 online
**What to take:** the best-known example of rule-based, non-diagnostic triage with
plausible, well-tested wording. Useful prior art for how a red-flag message should read:
plain, specific, action-oriented, no hedging, no disease names. This is the closest
existing model to what our rule engine is trying to be.

---

## 3. MSK-first verticals — the closest competitors

### KHealth, Hinge Health, Physitrack, Kaia
**What to take:** these are the products that already bet on MSK-first. Read their intake
flows, their triage copy, and their escalation language. Hinge in particular is a
good model for a long-running MSK relationship rather than a one-off consultation —
which is the same bet as the Personal Anatomical Health Map.
**What to take from the gap:** none of them lead with *anatomical localisation as a
first-class record structure*. They lead with exercise programmes and chat. That gap is
the opportunity.

---

## 4. Anatomy education — how to name things

### Ken Hub, Kenhub-style apps, TeachMeAnatomy
**What to take:** the `layTerm` discipline. Every structure in our ontology needs a
plain-language name next to the anatomical one, written the way a patient would
describe it — "the tendon that runs down the front of the shoulder joint", not
"tendon of the long head of the biceps brachii". Kenhub and TeachMeAnatomy both do
this consistently and it is directly copyable as a writing standard.

### Gray's Anatomy (1918) — public domain
**What to take:** as a **writing reference** for lay phrasing, and as historical
anatomical illustration. Public domain, so no licensing issue.

### Netter / Sobotta / Thieme
**What to take:** the visual conventions clinicians recognise. Do not redistribute.

---

## 5. Interoperability — Phase 2, design now, build later

### FHIR R4 — https://hl7.org/fhir/
**What to take:** design `clinical_assertions` to map onto FHIR resources
(`Condition`, `Observation`, `DiagnosticReport`, `CarePlan`) *now*, even though V1
never sends them. The table already separates diagnosis/test/treatment/outcome, which
is roughly FHIR's own split. Doing it now avoids a rewrite when a clinic asks for an
integration.

### SNOMED CT — https://www.snomed.org/
**What to take:** the clinical terminology to bind `coding.snomedCt` to. The
International release is free in most jurisdictions; the US release is licensed from
NLM. Verify before binding.

### FMA — http://si.washington.edu/projects/fma
**What to take:** the anatomical reference ontology. BodyParts3D is derived from it.

### ICD-10 / ICD-11
**What to take:** only for billing-adjacent output. Never as an input vocabulary —
patients do not think in ICD codes.

### mCODE (minimal Common Oncology Data Elements)
**What to take:** a worked example of a narrow, well-scoped clinical data standard for
one condition area. Good template for how narrow V1 should stay.

### Open mHealth, Apple HealthKit, Google Health Connect
**What to take:** the Phase 2 wearable connectors. `device_import` is already a
first-class `sourceType` in the data model, so the seam exists.

---

## 6. Standards and regulation — read before Phase 3, not before V1

- FDA Clinical Decision Support Software guidance:
  https://www.fda.gov/medical-devices/medical-devices-news-and-events/town-hall-clinical-decision-support-software-final-guidance-03112026
- WHO Triage Tools: https://www.who.int/tools/triage
- IMDRF SaMD guidelines: https://www.imdrf.org/

**Why it matters now, not later:** the moment this product moves from "help me describe
symptoms" toward "recommend what to do about this specific person", it crosses from
health information into regulated software. The architecture in `01-architecture.md`
is built to make that a separate, separable layer — but only if the separation is
maintained from day one, which is exactly why the rule engine is deterministic and the
summary generator never calls a model.

---

## 7. Tooling that fits this project specifically

### Obsidian
The vault at `E:\1obsidian\Obsidian Vault` is already the user's knowledge store. The
records are already structured. A Markdown exporter that writes each episode into the
vault, with the body-map pin as a link and the summary as a callout, is roughly 50 lines
and makes the Personal Anatomical Health Map usable in the tool they already live in.
**Recommendation: build this early.** It is the cheapest possible retention strategy —
if the history is readable in Obsidian, the user has a reason to come back.

### MCP (Model Context Protocol)
**What to take:** expose the record store as an MCP server so a desktop assistant can
read and append episodes without a browser. Natural second surface for this product.

### Playwright
**What to take:** the missing test layer. The interview answer → record mapping in
`session.ts` is currently untested and is the most likely thing to rot silently.

### Excalidraw / rough.js
**What to take:** if "mark on your own body" ever goes beyond a schematic point, a
freehand overlay is a strong interaction. Lower priority than depth selection.

---

## Summary — what to do first

| Priority | Action | Effort |
|---|---|---|
| 1 | Read Infermedica's body-avatar article | 1 hour |
| 2 | Study NHS 111 triage wording and rewrite our rule copy to match | 1 day |
| 3 | Build the Obsidian exporter | half a day |
| 4 | BioDigital spike: does agent-driven 3D beat the 2D map? | 1–2 days |
| 5 | Verify Z-Anatomy licence; decide BodyParts3D vs Z-Anatomy | half a day |
| 6 | Write `layTerm` for all V1 structures using the Kenhub standard | 2–3 days |
| 7 | Playwright tests for `session.ts` | 1 day |
