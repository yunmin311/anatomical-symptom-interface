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

Verified at that commit: **95** production GLBs (82 bilateral + 13 real midline), **674** unit
tests, **38/38** smoke, **27/27** gates with zero skips.

This document is the rest of the work. Three sections, in the order they actually gate on.

---

## 1. Release readiness

Nothing below is a feature. Until all four are done, ASI must not carry real patient data, and
this is not a matter of the software being unfinished — the rules are *unvalidated*, which is a
different thing from untested.

### 1.1 Clinical review of the safety rules

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

### 1.2 Professional externally sourced 2D anatomy

Every region has a schematic SVG fallback. They are drawn by hand, they are not anatomical, and
someone reviewing this product will reasonably assume they are. Either replace them with
professionally sourced artwork under a redistributable licence, or label them unmistakably as
placeholders in the UI. Shipping hand-drawn anatomy beside real 3D anatomy and not marking the
difference is the kind of thing that erodes trust in the accurate parts.

### 1.3 FMA verification

Every structure carries an FMA concept id at `status: "unverified"`, taken from the dataset.
They have not been checked against a real FMA release, so a clinician looking one up may find a
different concept, a broader one, or nothing. Verification is a lookup-and-record exercise
against a licensed FMA release, with the licence and the verification date recorded per entry —
the provenance fields already exist for exactly this.

### 1.4 Usability validation

V1 has never been watched being used. The engineering gates assert the flow *works*: 33 flow
assertions across three widths, on scripted input. Nobody has yet observed whether a person can
do it — whether the localisation refusal is understood, whether "visual selection, not a finding"
lands, whether the correction flow feels safe to use. Watch at least five sessions with real
people before believing the design.

---

## 2. Product refinement

The V1 flow is verified correct. These make it usable, not merely working.

### 2.1 Real-anatomy viewer UX

- Picking a structure on real 3D anatomy is finicky. Occlusion, small targets, no hover
  affordance worth the name.
- View presets exist; switching between them is not discoverable.
- Camera and orientation are not retained between episodes, so comparing "before" is manual.
- No way to isolate or hide layers, which is what makes deep structures findable.

### 2.2 Spatial Health Map UX

- The map answers *where and how often*. It cannot answer *getting worse*, because V1 has no
  answer history (§3.1) — and the aggregate is easy to misread as severity. It is labelled;
  the label needs to be stronger.
- No time range control, no region filter.
- The 2D body map is placeholder artwork (§1.2), which caps how much this can be improved
  before that lands.

### 2.3 Mobile interaction

375 px passes the gates. Passing is not comfortable:

- 3D picking on a small screen with no hover is a precision problem.
- Multi-question review on a phone is a long scroll with no progress indicator.
- Point placement on a schematic needs a larger target than a fingertip.

### 2.4 Interview / review / summary UX

- The interview is one long form. No progress, no grouping, no resume.
- Correction works and withdraws properly, but nothing in the UI *invites* a correction, and
  nothing tells the user that correcting an answer will change what a clinician reads. The
  correctness is in the engine; the discoverability is missing.
- The summary is clinician-readable and not designed to be *patient*-read. Decide which it is
  and say so.
- Gap handling — the difference between "not asked" and "asked, no answer" — is correct in the
  data and invisible in the UI.

---

## 3. Phase 2

**Deliberately not started.** V1 has no answer history, so there is nothing yet to build a
longitudinal product on, and starting features now would mean building against assumptions this
document has not yet tested.

### 3.1 Answer history and audit

The largest gap, and the one that constrains the most. The field store holds **current values**;
there is no history table. So a correction overwrites what it corrects — which is the right
call for current-value storage, and the wrong one for a health record. There is no record of
what was said before, when it changed, or who changed it.

This is the same decision documented at `canonicalIdentityForWrite`: the store is not an audit
log, and pretending otherwise was rejected for good reasons. Answer history needs a *separate*
append-only store, not a change to what the field store is for. It must also make
`consideredStructures`-style "what was considered" queries answerable, and it must not become a
second writable copy of the record.

### 3.2 Additional anatomy regions

V1 covers shoulder, neck, lower back, knee. The pipeline is general — a region is data plus a
mapping file — so this is mostly sourcing and auditing. The audit is the real work: every mesh
verified against the source archive before the mapping is trusted, which is what took the time
in V1.

Also honest: dataset gaps. The source models some structures per side only, which is why
shoulder and knee have no midline. That is a property of the data, and the product refuses
rather than mirrors.

### 3.3 Longitudinal health integrations

Needs §3.1 first. Without a change history there is no trajectory to integrate.

### 3.4 External health / EHR / wearable integration

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
1. clinical review of safety rules   ─┐
2. FMA verification                  ├─→ releaseReady can become true
3. 2D anatomy sourced or labelled    │
4. usability validation              ─┘

5. answer history / audit            ──→ unblocks 6 and 7
6. longitudinal health
7. external / EHR / wearable
```

Items 1–4 are gates, not features: until they are done, ASI does not carry real patient data.
Items 5–7 are the product. The gate runner refuses to lie about this, and so should every
document and conversation that follows.