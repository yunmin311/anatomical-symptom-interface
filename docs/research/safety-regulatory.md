# Safety and regulatory posture

**Read this before showing the product to anyone who is actually in pain.**

## The current honest state

**All 8 red-flag rules are `status: 'unreviewed'`.** The server prints a warning at
startup while that is true, and `evaluateRedFlags(record, { requireReviewed: true })`
returns nothing. This is a **development build**. It is not a medical device, it has
not been clinically reviewed, and it must not be pointed at real users.

That friction is deliberate. The default in this codebase is "assume you are wrong" —
it is much easier to loosen a gate later than to explain a missed red flag.

## The one architectural rule that matters

```text
Anatomical / Symptom Understanding → Core Product
Clinical Diagnosis / Treatment / High-risk Triage → Separate Validated Medical Layer
```

Everything in `packages/shared` and `packages/server` belongs to the first line.
Nothing in the core product produces a diagnosis, a disease ranking, a probability, a
treatment, or a triage decision.

Concretely, this is enforced by:

- **No disease vocabulary in the codebase.** The `Quality`, `Trigger` and `Structure`
  enums describe sensations and anatomy, not pathology. There is nowhere to put a
  diagnosis even by accident.
- **Red flags are predicates, not generations.** `when: (record) => boolean`. The rule
  says "get this assessed", never "you have condition X". A test enforces the wording.
- **The pre-visit summary never calls a model.** Deterministic text generation for the
  thing a doctor reads.
- **The orchestrator tool schema has no diagnosis field.** Absence of a field beats a
  prompt instruction.

## What a rule match means

> "This presentation warrants prompt human assessment."

Not:
> "You have a 60% chance of X."

The copy is written to be unambiguous about this, because the most likely real-world
harm from a product like this is not a missed diagnosis — it is a user who reads an
`urgent` banner and concludes they have a disease they do not have, or reads `info`
and concludes they are fine.

## The rules and their basis

| Rule | Severity | Basis |
|---|---|---|
| `msk.cauda_equina` | emergency | Cauda equina features in standard MSK primary care assessment |
| `msk.neck_trauma_neuro` | emergency | Trauma + neurological deficit pathway |
| `msk.trauma_deformity_no_lift` | urgent | Acute joint injury with functional loss |
| `msk.hot_joint_fever` | urgent | Suspected septic arthritis — time-critical |
| `msk.cold_pale_hand` | urgent | Upper-limb vascular compromise |
| `msk.systemic_symptoms` | urgent | Systemic features with MSK pain |
| `msk.silent_tear` | caution | Neurological deficit with MSK presentation |
| `msk.chronic_persistent` | info | Six-week persistent symptom review threshold |

**These bases are placeholders, not citations.** Every `review.basis` string says it must
be verified against current national guidance. Before this ships to anyone, each rule
needs: a named source, a named reviewer, a date, and a decision about what happens on a
false negative and a false positive. That is a clinical safety case, not a code review.

## Known gaps in the current safety posture

Honest list, because pretending otherwise is worse:

1. **No false-negative analysis.** Rules are written from recalled presentations. A
   missed presentation is the failure that matters most.
2. **No paediatrics, pregnancy, or post-operative pathways.** Out of V1 scope, and
   therefore out of the safety envelope too.
3. **No non-MSK red flags.** Chest pain, breathlessness, sudden severe headache — a user
   describing those will be routed to a musculoskeletal app. The current rules do not
   catch that. **This is the most serious known gap** and needs a "not the right app"
   pathway.
4. **English and Chinese only.** Red-flag copy is not translated. A non-English speaker
   gets a safety message in the wrong language, or none.
5. **No clinician in the loop.** Everything is self-report with no human check.
6. **No accessibility review.** The safety banner must be legible and perceivable
   without colour discrimination, and must be announced correctly to a screen reader.
   Not yet done.

## Getting to `clinically_reviewed`

For each rule:

- [ ] Named source guideline, with version and date
- [ ] Named qualified reviewer (physiotherapist, sports physician, or GP)
- [ ] Reviewer signs off on both the predicate and the user-facing wording
- [ ] False-positive and false-negative scenarios written down
- [ ] `reviewedBy`, `reviewedAt` set in `review`
- [ ] Status flipped to `clinically_reviewed`
- [ ] `unreviewedRuleCount() === 0` before any non-development release

Until then, the startup warning is the product's own admission that it is not ready.

## Regulatory horizon

V1 is health **information** and communication support. That is the least regulated
end of the spectrum, and the architecture is deliberately shaped to stay there.

Regulatory exposure increases sharply as the product moves toward:
patient-specific diagnosis, treatment recommendation, or time-critical directives. That
is Phase 3 in the roadmap, and it must be a separate workstream with its own clinical
validation, safety monitoring, and regulatory path — not a feature toggle on the
symptom recorder.

- FDA CDS guidance: https://www.fda.gov/medical-devices/medical-devices-news-and-events/town-hall-clinical-decision-support-software-final-guidance-03112026
- WHO triage tools: https://www.who.int/tools/triage
- IMDRF SaMD: https://www.imdrf.org/

## Privacy

Handled as privacy-by-design, not as a compliance task bolted on later:

- **Local-first.** SQLite on the user's own disk. No account required to use V1.
- **Minimal egress.** With no API key set, the orchestrator is fully local and nothing
  leaves the machine. The only field sent to a model is the user's own words.
- **Export and delete.** The DB is a portable SQLite file. `secure_delete` is on.
- **No training on health data.** Not by policy — by architecture: there is no pipeline.
- **Provenance as an audit trail.** Every field records its source, so a user can always
  answer "who said this and when".

Before any real deployment, `docs/09-privacy.md` needs filling in with a concrete
threat model and a jurisdiction-specific analysis (HIPAA / GDPR / PDPA).
