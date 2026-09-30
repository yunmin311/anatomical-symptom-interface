# Safety and regulatory posture

**Read this before showing the product to anyone who is actually in pain.**

## The current honest state

**All 10 red-flag rules are `status: 'unreviewed'`, and 7 of them are urgent or
emergency.** The server prints this at startup, `/api/health` reports
`releaseReady: false` with the blocking rule ids named, and
`ASI_RELEASE_PROFILE=release` **refuses to start** while any time-critical rule is
unreviewed. This is a **development build**. It is not a medical device, it has not
been clinically reviewed, and it must not be pointed at real users.

That friction is deliberate. The default in this codebase is "assume you are wrong" —
it is much easier to loosen a gate later than to explain a missed red flag.

## The two profiles

| | `development` (default) | `release` |
|---|---|---|
| Unreviewed rule that fires | **Shown**, labelled unreviewed in the UI, with a prototype notice | **Withheld**, and the record is **BLOCKED** |
| Startup | Warns, naming the blocking rules | **Refuses to start** if any urgent/emergency rule is unreviewed |
| Intent | Make the gap visible while building | Make it impossible to serve a product that cannot show a safety signal it matched |

The important part is that `release` does not simply return a shorter flag list.
Silently dropping a matched rule would tell the user "we checked and you are fine". So
a withheld urgent or emergency rule sets `blocked: true`, the banner says the record
has **not** been safely assessed, and the plain-text export prints
`*** SAFETY GATE BLOCKED ***`.

CI enforces the metadata rather than trusting it:
`scripts/check-safety-metadata.mjs` parses `/api/health`, requires every field to be
present and correctly typed, requires `totalSafetyRules` to be a positive integer (a
zero-rule engine reports "safe" for everything), and fails if the development profile
claims `releaseReady: true` while rules are unreviewed. A renamed field or a server
that never started now fails CI instead of passing.

## The rules and their basis

| Rule | Severity | Reads signal | Basis |
|---|---|---|---|
| `msk.cauda_equina` | emergency | bladder change, saddle numbness, leg weakness | Cauda equina red flags in standard MSK primary care assessment |
| `msk.neck_trauma_neuro` | emergency | neck trauma + neuro, trauma + numbness | Trauma + neurological deficit pathway |
| `msk.trauma_deformity_no_lift` | urgent | trauma with loss of movement, weight bearing lost | Acute joint injury with functional loss |
| `msk.hot_joint_fever` | urgent | hot red swollen joint, fever/systemic unwell | Suspected septic arthritis — time-critical |
| `msk.cold_pale_hand` | urgent | cold/pale/numb hand | Upper-limb vascular compromise |
| `msk.systemic_symptoms` | urgent | fever/systemic unwell (yes **or** unknown) | Systemic features with MSK pain |
| `msk.unable_to_bear_weight` | urgent | weight bearing lost | Complete loss of weight bearing |
| `msk.joint_locking` | caution | joint locking or giving way | Mechanical locking or instability |
| `msk.numbness_with_dysfunction` | caution | cold/pale/numb hand (exclusion) | Neurological deficit with MSK presentation |
| `msk.chronic_persistent` | info | — (record only) | Six-week persistent symptom review threshold |

**These bases are placeholders, not citations.** Every `review.basis` string says it
must be verified against current national guidance. Before this ships to anyone, each
rule needs: a named source, a named reviewer, a date, and a decision about what
happens on a false negative and a false positive. That is a clinical safety case, not
a code review.

Every urgent and emergency rule is required by a test to read at least one interview
signal, and every declared signal is required to be read by at least one rule. A
time-critical rule that depends only on a record field cannot be tested end to end
through the interview, and the test refuses to let one exist.

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
3. **Non-MSK complaints are routed away, but not triaged.** A chest-pain or
   breathlessness description now exits the workflow instead of being fed into a
   musculoskeletal questionnaire, and the user is told to contact a clinician or the
   emergency service. That is a routing decision based on which body part was
   mentioned — **it is not a medical assessment and must never grow into one.** The
   router deliberately contains no condition vocabulary, and tests assert it names no
   diagnosis and implies no severity. It cannot tell a chest complaint from a pulled
   muscle any better than a region match can.
4. **English and Chinese only.** Red-flag copy is not translated. A non-English speaker
   gets a safety message in the wrong language, or none. Worse, the *router* is also
   EN/ZH, so a non-English description of a chest complaint is simply "ungrounded" and
   the user is offered the four regions rather than being sent to a clinician.
5. **No clinician in the loop.** Everything is self-report with no human check.
6. **No accessibility review.** The safety banner must be legible and perceivable
   without colour discrimination, and must be announced correctly to a screen reader.
7. **No false-negative analysis on the *questions* themselves.** Every rule depends on
   the user answering a question, and users skip, guess, or misread. The safety
   property is only as good as question comprehension, which is unmeasured.
8. **Uncertainty is not escalated consistently.** `msk.systemic_symptoms` treats an
   "I don't know" as worth acting on; most other rules treat it as neutral. That is a
   judgement call, not a derived conclusion, and it should be reviewed with the rules.
9. **The schema rebuild discards data.** A schema version change drops the local
   database rather than migrating it. Acceptable for a development build, and
   explicitly *not* acceptable once a real user has records.
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
