# After V1

V1 is an **engineering baseline**, not a product. Tagged `v1.0.0-rc.1` at `eaf69e9`.

What that tag means, precisely:

- ASI V1 is **engineering complete** — four regions with audited 3D anatomy, the location-first
  record, per-field provenance, deterministic safety rules, the clinician-readable summary, the
  spatial health map, and three surfaces over one atomic write path.
- **NOT clinically reviewed.** All 10 safety rules are unreviewed, 7 of them urgent/emergency.
  `releaseReady` is `false` and the `release` profile refuses to start.
- **NOT approved for medical release.**
- **2D anatomy is placeholder artwork**, hand-made. It is not anatomical.
- **FMA bindings are unverified** — every one is a concept id from the dataset, not a checked
  anatomical mapping.

Verified at that tag: **95** production GLBs (82 bilateral + 13 real midline), **674** unit
tests, **38/38** smoke, **27/27** gates with zero skips.

Current `main` is ahead of that tag. As of the post-V1 integration it verifies at **680** unit
tests (the extra six are the preview deployment's own health assertions) and **28/28** gates —
the twenty-eighth is a `hooks` gate that fails by naming a `data-testid` a redesign removed,
instead of failing somewhere unrelated.

The V1 **product-design refinement** is merged into `main` (PR #11). What it changed, and what
it deliberately did not, is in [`DESIGN_HANDOFF.md`](DESIGN_HANDOFF.md); the measurements behind
it are in [`docs/design/v1-product-audit.md`](docs/design/v1-product-audit.md).

---

## The two tracks are parallel, not a chain

**This is the most important correction in this document, and the previous version had it
wrong.**

The earlier draft numbered Release Readiness as §1 and Product Refinement as §2, said "three
sections, in the order they actually gate on", and then gave a sequencing diagram containing
only Release Readiness and Phase 2. Read as a whole that says: *the interface cannot be
improved until the safety rules are clinically reviewed.* That is false, and it was expensive to
leave in a planning document — it reads as a reason to stop working.

They are parallel tracks with different owners and different clocks:

| | **A · Release Readiness** | **B · Product Refinement** |
|---|---|---|
| What it is | External validation and licensed assets | Internal craft on a working product |
| Owner | A qualified clinical reviewer; an art/asset licensee; whoever checks FMA | This repository, any agent or person |
| Blocked by an external human? | **Yes, entirely** | **No** |
| Blocked by the other track? | No | **No** |
| What it gates | Whether ASI may carry **real patient data** | Whether ASI is **pleasant to use** |
| Can it start today? | Only §A.4 usability sessions can | **Yes, and it has been** |

The tracks are genuinely independent, and the design pass is the proof: PR #11 landed a
substantial product/UX change while all 10 safety rules remain unreviewed, and nothing in it
touched a rule, a threshold, a wording or a write path.

**One thing is a genuine dependency, and it is not between these two tracks:** ASI must not
carry real patient data until track A is done. That is a constraint on *deployment*, not on
work. Track B improves a product that may only ever hold synthetic data until track A completes,
and it should keep going regardless — a prototype used with fictional data is exactly how track
A gets its evidence in the first place.

Neither track waits for Phase 2 (§C), and Phase 2 waits for neither.

---

## A · Release readiness

Until all four are done, ASI must not carry real patient data. This is not a matter of the
software being unfinished — the rules are *unvalidated*, which is a different thing from untested.

### A.1 Clinical review of the safety rules

**The single blocking item.** 10 rules, 7 urgent/emergency: `msk.cauda_equina`,
`msk.neck_trauma_neuro`, `msk.trauma_deformity_no_lift`, `msk.hot_joint_fever`,
`msk.cold_pale_hand`, `msk.systemic_symptoms`, `msk.unable_to_bear_weight`.

The rules are pure predicates over typed signals, they are unit-tested, and they are **not
reviewed by anyone qualified to judge whether they are clinically correct.** A test proves the
predicate fires on the signal it was written for; it cannot prove the signal is the right thing
to act on, that the threshold is right, or that the wording is safe to show a patient.

Needs a qualified clinician to review, per rule: is the trigger right, is the action
proportionate, is the wording safe, what should it escalate to. Then set
`verificationStatus`/`review` metadata honestly — **`unreviewedSafetyRules` must go to 0 by
review, never by editing the count.** It is currently asserted by
`scripts/check-safety-metadata.mjs` precisely so it cannot be made to look finished.

While this is outstanding, `ASI_RELEASE_PROFILE=release` refusing to boot is the correct
behaviour. It must keep refusing.

### A.2 Professional externally sourced 2D anatomy

Every region has a schematic SVG fallback. They are drawn by hand, they are not anatomical, and
someone reviewing this product will reasonably assume they are. Either replace them with
professionally sourced artwork under a redistributable licence, or label them unmistakably as
placeholders in the UI. Shipping hand-drawn anatomy beside real 3D anatomy and not marking the
difference is the kind of thing that erodes trust in the accurate parts.

**Partly done.** The interface now labels the surface explicitly — the toolbar reads
`Schematic 2D map`, and the map states "A schematic. It locates an area; it does not show
tissue." The artwork itself is unchanged and remains a release blocker. Note that the label is
*not* a substitute for the asset: it removes the deception, not the limitation.

### A.3 FMA verification

Every structure carries an FMA concept id at `status: "unverified"`, taken from the dataset.
They have not been checked against a real FMA release, so a clinician looking one up may find a
different concept, a broader one, or nothing. Verification is a lookup-and-record exercise
against a licensed FMA release, with the licence and the verification date recorded per entry —
the provenance fields already exist for exactly this.

### A.4 Usability validation

V1 has never been watched being used. The engineering gates assert the flow *works*: 33 flow
assertions across three widths, on scripted input. Nobody has yet observed whether a person can
do it — whether the localisation refusal is understood, whether "visual selection, not a finding"
lands, whether the correction flow feels safe to use. Watch at least five sessions with real
people before believing the design.

**This is the one item on track A that is not waiting on an external party.** It needs five
people and a script, and it can start now. It is also the only way to find out whether the
refinement in track B helped, which makes it the one place the two tracks genuinely inform each
other.

---

## B · Product refinement

The V1 flow is verified correct. These make it usable, not merely working. **Not blocked by
track A; several items are already done and are marked.**

### B.0 Done in PR #11

- **The interface stopped lying about its own anatomy.** The toolbar read `3D · fixture volumes`
  and the footer `Schematic only: it does not show tissue` above a live canvas showing real
  CC-BY BodyParts3D geometry. A user reading that had no reason to trust the accurate parts.
- **Locate is a workspace, not a form.** The region is the largest text on the screen and the
  four facts — area, side, depth, view — are stated in one place instead of an `h2`, a tab and a
  12px caption.
- **Selection continuity.** Returning to Locate showed the recorded area with no control pressed
  and a **disabled** primary action. The draft now starts from the record.
- **Depth is a rail, in words a person uses**, and its consequence is stated as a slice rather
  than as a list of tissue names.
- **Mobile.** No horizontal scroll at 375 (was `383px` of document in a `375px` viewport). The
  area list sits directly under the map instead of most of a scroll below it. The canvas
  instruction is visible on every surface at every width.
- **Interview progress** states the position, both counts, and that "I am not sure" is recorded
  as an answer and stays separate from "no".
- **Review** separates what was answered from what was never asked, instead of eight
  consecutive `Not asked` rows.
- **History** leads with the patient's own words rather than a `"<region> — <date>"` placeholder,
  and each place shows when it was last used.
- **Summary** leads with the patient's own words; `chiefComplaint` is unchanged word for word.

### B.1 Real-anatomy viewer UX

- Picking a structure on real 3D anatomy is finicky. Occlusion, small targets, no hover
  affordance worth the name.
- View presets exist; switching between them is not discoverable.
- Camera and orientation are not retained between episodes, so comparing "before" is manual.
- No way to isolate or hide layers, which is what makes deep structures findable.

### B.2 Spatial Health Map UX

- The map answers *where and how often*. It cannot answer *getting worse*, because V1 has no
  answer history (§C.1) — and the aggregate is easy to misread as severity. It is labelled; the
  label needs to be stronger.
- No time range control.
- **A region filter already exists** (the body-area index filters the list), which the previous
  draft of this document claimed was missing.
- The 2D body map is placeholder artwork (§A.2), which caps how much this can be improved before
  that lands. That is a dependency on an **asset**, not on clinical review — worth naming
  precisely, because it is the one place track B is genuinely waiting on something.

### B.3 Mobile interaction

375 px passes the gates, and after PR #11 the layout defects are fixed. What remains is
comfort, not correctness:

- 3D picking on a small screen with no hover is a precision problem.
- Point placement on a schematic needs a larger target than a fingertip.
- The area list still requires a short scroll on a 375×812 screen; the map and the sticky action
  bar leave about 979px of content above the first area control.

### B.4 Interview / review / summary UX

- **Progress, grouping and "not asked" are done** (§B.0). Resume is not: leaving mid-interview
  and coming back is only possible by reopening the episode.
- Correction works and withdraws properly, and the UI now labels a corrected answer as
  corrected. What is still missing is anything that *invites* a correction, and any statement
  that correcting an answer will change what a clinician reads.
- The summary is clinician-readable and not designed to be *patient*-read. **Decide which it is
  and say so.** PR #11 led it with the patient's own words, which is a step toward patient-read
  without having made that decision.

### B.5 Open capability requests from the design pass

Frontend work that could not honestly be completed without a domain decision. In full, with
options and recommendations, in the audit. The blocking one:

- **Depth cannot express "not the skin".** `Depth` is `superficial | intermediate | deep |
  unknown`. Recommended: a separate `depthQualifier` claim beside the enum. No fifth value was
  invented.

Also open: per-field suggested-vs-chosen status; episode titles; `layTerm` for every V1
structure; one source for a field's user-facing wording; and the fact that a spatial count is a
count of *records*, not occurrences.

---

## C · Phase 2

**Deliberately not started.** V1 has no answer history, so there is nothing yet to build a
longitudinal product on, and starting features now would mean building against assumptions this
document has not yet tested.

### C.1 Answer history and audit

The largest gap, and the one that constrains the most. The field store holds **current values**;
there is no history table. So a correction overwrites what it corrects — which is the right
call for current-value storage, and the wrong one for a health record. There is no record of
what was said before, when it changed, or who changed it.

This is the same decision documented at `canonicalIdentityForWrite`: the store is not an audit
log, and pretending otherwise was rejected for good reasons. Answer history needs a *separate*
append-only store, not a change to what the field store is for. It must also make
`consideredStructures`-style "what was considered" queries answerable, and it must not become a
second writable copy of the record.

### C.2 Additional anatomy regions

V1 covers shoulder, neck, lower back, knee. The pipeline is general — a region is data plus a
mapping file — so this is mostly sourcing and auditing. The audit is the real work: every mesh
verified against the source archive before the mapping is trusted, which is what took the time
in V1.

Also honest: dataset gaps. The source models some structures per side only, which is why
shoulder and knee have no midline. That is a property of the data, and the product refuses
rather than mirrors.

### C.3 Longitudinal health integrations

Needs §C.1 first. Without a change history there is no trajectory to integrate.

### C.4 External health / EHR / wearable integration

The furthest out, and the one with the hardest constraint: ASI holds data nobody else has, so
sending it anywhere is a consent and governance problem before it is an engineering one.

Provider-neutral by construction — business logic depends only on the `Orchestrator` interface,
and the only vendor coupling is behind that seam (recorded in `AGENTS.md`). Worth noting the
shape of the problem early: a wearable's "steps" and a person's "worse after walking" are
different claims about the same day, and merging them into one field would be exactly the
two-truths problem the canonical id work removed.

---

## Sequencing

```text
                    ┌─────────────────────────────────────────┐
   A · RELEASE      │ A.1 clinical review   ← external human  │
   READINESS        │ A.2 2D anatomy asset ← external licence │
   (gates real      │ A.3 FMA verification  ← external licence │
    patient data)   │ A.4 usability sessions ← five people      │
                    └───────────────┬─────────────────────────┘
                                    │ gates DEPLOYMENT, not work
                                    ▼
                        ASI may carry real patient data
                                    ▲
                    ┌───────────────┴─────────────────────────┐
   B · PRODUCT      │ B.1 viewer UX      B.2 health map UX   │
   REFINEMENT       │ B.3 mobile comfort B.4 interview/summary│
   (gates usability)│ B.5 capability requests → domain        │
                    └───────────────┬─────────────────────────┘
                                    │
                    ┌───────────────┴─────────────────────────┐
   C · PHASE 2      │ C.1 answer history ← needs C.1 first ──→ │
   (not started)    │ C.2 regions  C.3 longitudinal  C.4 external│
                    └─────────────────────────────────────────┘
```

**A and B run at the same time and neither waits for the other.** A is gated by people and
licences this repository does not control; B is gated by nobody. C starts when it starts.

Only one arrow crosses between them, and it points the right way: A gates whether real patient
data may be stored. It does not gate whether the interface may be improved.

The gate runner refuses to lie about this, and so should every document and conversation that
follows.

---

## Deployment status

| Path | Status |
|---|---|
| Local dev (`pnpm dev`) | **Verified.** Every gate runs against it. |
| Single-origin preview (`preview/`) | **Verified.** Built web app + API on one origin, seeded with synthetic data rebuilt on every start, declaring itself non-clinical in `/api/health`. `node preview/verify-preview.mjs <origin>` is 12/12, including that a **write** round-trips through the proxy — a version of that proxy once passed every GET and failed every POST, and nothing about looking at the preview would have caught it. |
| Docker (`preview/Dockerfile`, `preview/docker-compose.yml`) | **Explicitly unverified.** The files are committed but no image has been built and nothing has been run from them. Docker is **not** the chosen deployment path; the preview is. Do not read the presence of a Dockerfile as evidence that a container works. |