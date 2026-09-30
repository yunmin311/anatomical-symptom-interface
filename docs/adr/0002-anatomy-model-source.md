# 0002 — Anatomy model source: local IDs, deferred asset decision

**Status:** accepted · **Date:** 2026-09-29

## Context

The product needs to name and locate anatomical structures. Third-party
terminologies (SNOMED CT, FMA) and model sources (BodyParts3D, BioDigital, Z-Anatomy)
all exist. The plan (§7) suggests starting with a third-party viewer and deciding about
ownership later.

## Decision

Two decisions, deliberately separated.

**1. Local stable IDs as primary keys.** Structures are `asi:shoulder.supraspinatus-tendon`.
Terminology bindings are carried in a nullable `coding` field whose `status` defaults to
`unverified`. Nothing ships as verified until a human checks it.

**2. The 3D asset decision is deferred.** V1 uses a schematic 2D SVG map authored in-repo.
BodyParts3D is the recommended Phase 1 source, **under CC BY 4.0 International
(licence page last updated 2025-02-27)** — note that the project previously
published its data under CC-BY-SA 2.1 JP and that older licence string is still
quoted on its own editor site and in most third-party mirrors. BioDigital is a
reference, not a dependency. See `docs/research/anatomy-assets.md` for the pinned
source URL, release numbers, and the attribution string to ship.

## Rationale for local IDs

- Third-party terminologies get re-numbered and are not available offline. A primary key
  that can change under you is not a primary key.
- We can always *add* a verified FMA or SNOMED binding later. We can never retroactively
  invent one we shipped as fact.
- A test asserts the published regions contain **zero** verified codes, so nobody can
  quietly promote a guess.
- BodyParts3D is FMA-derived, so the mapping largely already exists in someone else's
  dataset. We extract it rather than invent it.

## Rationale for deferring 3D

- The core validation question — *do users describe location better with a visual aid?* —
  does not require 3D. It requires a visual aid.
- A 2D front/back map matches how people actually self-report ("the front of my shoulder").
- 3D's real value is layer control, which is an enhancement to a flow that must work
  without it.
- Licensing, model ownership and long-term cost are real questions that deserve a
  deliberate answer rather than a default.

## The seam that makes this reversible

`apps/web/src/anatomy/types.ts` defines `AnatomyAdapter` with a `ViewerCommand` union
covering `focusRegion`, `focusSubRegion`, `showLayers`, `highlight`, `dropPin` and more.
`Svg2dAnatomyAdapter` implements it today. `Three3dAnatomyAdapter` would implement the
same contract against BodyParts3D. **No caller above the adapter changes.**

This is the actual mitigation for the deferred decision: the decision is deferred, not
avoided. The cost of being wrong is one file.

## The real deliverable

Whichever asset we adopt, the output is a **manifest**, not a mesh:

```jsonc
{ "asiId": "asi:shoulder.supraspinatus-tendon", "meshName": "...",
  "layer": "tendon", "fma": "...", "layTerm": "...", "bounds": {...} }
```

Everything keys off `asiId`. The mesh format is a swappable detail.

## Consequences

- Before any real use, `layTerm` must be written for every structure using a plain-language
  standard. A structure with only an anatomical name is not usable by a patient.
- `coding.status` stays `unverified` until someone does the verification work. This is a
  real cost, accepted deliberately.
- BodyParts3D's CC BY 4.0 terms require attribution but carry **no ShareAlike
  obligation**, unlike the CC-BY-SA 2.1 JP terms that applied before 2025-02-27.
  Re-check the archive licence page before any release and never take a licence
  string from a third-party redistribution.
