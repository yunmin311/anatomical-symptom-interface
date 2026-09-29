# 0003 — Separate the clinical layer from the anatomical layer

**Status:** accepted · **Date:** 2026-09-29

## Context

The plan (§8) states the single most dangerous direction for this product: sliding from
"help people describe symptoms" into "the AI diagnoses and treats". It also notes (§11)
that medical knowledge and symptom checkers are crowded and commoditised, so the
differentiator must be grounding, memory and provenance — not diagnostic intelligence.

## Decision

**A hard architectural boundary, enforced in code, not in a prompt.**

```text
Anatomical / Symptom Understanding → Core Product (this repo)
Clinical Diagnosis / Treatment / High-risk Triage → Separate, later, validated
```

The core product produces no diagnosis, no disease probability, no treatment, and no
triage decision.

## The five enforcement mechanisms

1. **No disease vocabulary exists.** `Quality`, `Trigger` and `Structure` describe
   sensations and anatomy, not pathology. There is no field a diagnosis could be written
   into.

2. **Safety messaging is a deterministic rule engine.** `when: (record) => boolean` —
   a pure predicate. A rule says "get this assessed"; it can never say "you have X".
   A test asserts banned diagnostic phrasings never appear in any user message.

3. **The pre-visit summary never calls a model.** The text a doctor reads is generated
   deterministically. A hallucinated chat reply is annoying; a hallucinated sentence in
   a medical summary is a different class of harm.

4. **The orchestrator's tool schema has no diagnosis field.** Absence of a field is a
   stronger guarantee than a prompt instruction.

5. **Every rule carries review metadata, defaulting to `unreviewed`.** The server warns
   at startup while any rule is unreviewed. Shipping an unreviewed safety rule to real
   users is a clinical safety event, and the code should be annoying about it.

## Why a prompt instruction is not enough

"We do not diagnose" in a system prompt is a soft constraint that degrades under
distribution shift, adversarial phrasing, or a model update. The rules above are
structural: the model cannot emit a diagnosis because there is nowhere to emit it, and
the safety path does not involve a model at all.

## The lineage of an AI inference

```text
model output  →  consideredStructures[]  (candidate, ai_inference, unverified)
              →  user clicks on the model
              →  userConfirmedStructureIds[]  (fact, user_selection, user_confirmed)
```

`assertProvenance` throws if anything tries to mark an `ai_inference` as
`user_confirmed`. The loser's provenance is preserved so the UI can show what changed.

## Consequences

- **We give up the most requested feature.** Users will ask "what is it?" We answer
  with anatomy, red flags and a summary. This is the product, not a limitation of it.
- **Red-flag accuracy becomes a clinical task.** Rules must be written and reviewed by
  someone qualified, with documented false-positive and false-negative reasoning. The
  current 8 rules are a starting scaffold, not a validated set.
- **The Medical Knowledge Layer is a separate future component** (§6 of the plan). The
  core product must not become the source of anatomical or clinical knowledge. Anatomy
  facts come from FMA/terminology sources; safety messaging comes from the rule engine.
- **Regulatory exposure stays low as long as the boundary holds.** Crossing it requires
  a separate workstream with clinical validation and its own regulatory path — not a
  feature flag.

## Review trigger

Reopen this ADR if any of the following becomes true:
- a request to show a disease name in the core product
- a request for the model to decide whether someone should seek emergency care
- a plan to add treatment or medication advice
- integration with a diagnosis API

Each of those is a decision to move work into the Medical Layer, not to relax this ADR.
