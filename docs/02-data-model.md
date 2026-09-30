# Data model

## The central idea

A symptom record is not a list of answers. It is a set of **attributed values**, where
each value remembers who said it, when, how sure they were, and whether anyone verified it.

```ts
interface Attributed<T> {
  value: T;
  provenance: Provenance;
}
```

Flattening this into `Record<string, any>` is the single change that would destroy the
product. Everything below follows from refusing to do that.

## Provenance

```ts
type SourceType =
  | 'user_statement'    // typed or spoken
  | 'user_selection'    // clicked on the anatomy model
  | 'user_edited'       // corrected an existing value
  | 'ai_inference'      // model reasoning — candidate only
  | 'device_import'     // wearable / health platform
  | 'external_record'   // lab or imaging report
  | 'clinician_confirmed'// a human clinician
  | 'system_rule';      // deterministic rule engine

type VerificationStatus =
  | 'unverified' | 'user_confirmed' | 'clinician_confirmed' | 'refuted';
```

### Axis 2 — evidence status: what KIND of claim it is

```ts
type EvidenceStatus =
  | 'user_report'       // the patient described it in words
  | 'visual_selection'  // the patient pointed at it on the body map
  | 'ai_candidate'      // the model proposed it; nobody asserted it
  | 'clinician_finding' // a clinician asserted it
  | 'system_derived';   // computed by our own deterministic code
```

These two axes are independent, and conflating them was a real defect. A user
clicking a tendon has `sourceType: 'user_selection'` AND
`evidenceStatus: 'visual_selection'`: that means "the user indicated this place",
and emphatically **not** "this tendon is the problem". See
`docs/adr/0004-visual-selection-is-not-a-finding.md`.

`assertProvenance` enforces compatibility: a model can only produce an
`ai_candidate`; only a clinician or an external record can produce a
`clinician_finding`.

### Authority is per claim class, not a global ladder

A single global rank was wrong for health data. With one ladder,
`device_import` outranked `user_statement`, so a wearable step count would
silently overwrite "my knee hurts" — indefensible, because a device measures
something narrow and objective, while the patient's subjective report is the
*primary* source for symptoms and is not replaceable by a measurement of a
different thing.

So a field also declares a **claim class**, and each class has its own ranking:

| Claim class | Fields | Ranking highlights |
|---|---|---|
| `symptom_subjective` | quality, triggers, radiation, tenderness, temporal, function | `user_edited` 70 › `user_statement` 60 › `user_selection` 20 › `ai_inference` 10. **`device_import` and `external_record` are absent.** |
| `location_anatomical` | region, side, depth, subRegion, point, structure selections | `clinician` 80 › `user_edited` 70 › `user_selection` 60 › `user_statement` 40 › `ai_inference` 10 |
| `measurement` | future: temperature, range of motion | `clinician` 90 › `external_record` 85 › `device_import` 80 › `user_edited` 40 |
| `clinical_conclusion` | future: diagnosis, treatment | `clinician` 95 › `external_record` 50 |
| `derived` | candidates, computed values | `system_rule` 50 › `ai_inference` 40 |

**Absence is the mechanism, not an oversight.** A source type missing from a
class may never become the winner for that class; its value is *preserved in
parallel* instead. That is how a lab report ends up recorded **alongside** "my
knee hurts" rather than replacing it.

```ts
// A device reading cannot overwrite what the patient said they feel.
mergeField(userSays, deviceImport, 'symptom_subjective')
// → { winner: userSays, applied: false,
//     preserved: [{ value: deviceValue, reason: 'not authoritative for class' }] }

// On a measurement field the same two sources rank the other way.
mergeField(userSays, deviceImport, 'measurement').winner.value === deviceValue
```

### Enforced invariants

`assertProvenance` throws on any of these, and it is called on **every write**:

1. `ai_inference` can only be `unverified` or `refuted`. Never `user_confirmed`.
2. `ai_inference` must carry an explicit `confidence`. No silent assertions.
3. `clinician_confirmed` cannot be `unverified` — if a clinician said it, it's confirmed.
4. `user_edited` is always `user_confirmed`.
5. An unknown `sourceType` is a hard error, not a warning.
6. A `sourceType` / `evidenceStatus` pair must be compatible.

A field already owned by a higher-authority source for its claim class is **not
overwritten** by a lower one. The losing value is written to `episode_assertions`
with a reason, so the conflict stays visible instead of one side silently winning.

```ts
// The user says "dull", the model is confident it's "sharp". User wins.
mergeField(aiGuess, userStatement, 'symptom_subjective').winner.value === 'dull'
```

## The field registry

Every field a client may write is declared in `packages/shared/src/field-policy.ts`
with a validator, a claim class, a strategy, an allow-list of source types, and a
note. A field is **either** in the registry **or** in `DERIVED_FIELD_PATHS` with a
reason for having no provenance. There is no third option, and a test enforces
completeness.

```ts
{
  path: 'location.userSelectedStructureIds',
  claimClass: 'location_anatomical',
  strategy: 'user_grounded',
  requiresUserSource: true,
  allowedSources: ['user_selection', 'user_edited'],
  note: 'VISUAL SELECTION ONLY ... AI may never write this field.',
}
```

`requiresUserSource: true` is the switch that stops a client manufacturing a
user-confirmed fact: an `ai_inference` write to that field is rejected outright.

## Tables

```text
persons ──┬── body_regions ──┬── episodes ──┬── field_provenance
          │                  │              ├── safety_flags        (append-only)
          │                  │              ├── clinical_assertions
          │                  │              └── transcripts
```

### `body_regions` — the spatial index

The Personal Anatomical Health Map. A row is "this person's right knee, anterior
sub-region", and it accumulates every episode that happened there. This is what makes
`GET /api/healthmap/:personId` possible, and what a heatmap will be built on.

```sql
id, person_id, region, side, sub_region_id,
point_x, point_y,          -- normalised 0..1, resolution independent
created_at, updated_at
```

### `episodes` — one occurrence, not one session

The distinction matters. A user may have three episodes in one knee over a year, opened
across three conversations. Modelling an episode as a chat session would make the
longitudinal product impossible.

```sql
id, person_id, region_id, region, side, status,   -- open|resolved|ongoing|archived
title, record_json, started_at, ended_at, created_at, updated_at
```

### `field_provenance` — the audit trail

Relational on purpose. `field_path` is a dotted path into the record
(`location.side`, `quality[0]`, `temporal.trend`).

```sql
id, episode_id, field_path,        -- UNIQUE(episode_id, field_path)
source_type, source_reference,     -- transcript turn id, report name, rule id
captured_at, confidence,
verification_status, created_by, raw_text
```

`raw_text` keeps the user's original phrasing. If they later correct an interpretation,
the original sentence is still there.

This table being relational rather than a JSON blob is what makes
`SELECT * FROM episode_fields WHERE source_type = 'ai_inference'` a real capability
rather than a wish.

### `safety_flags` — append-only

Warnings we gave are part of the record. We must be able to show what the system said
and when, even after the rules change. Never updated, never deleted on rule change.

### `clinical_assertions` — Phase 2 reserved

A separate table for `diagnosis | test | treatment | outcome | imaging | lab`, with
`asserted_by`, `institution`, `source_document`. Kept separate from
`clinical_assertions` on purpose: a clinician's diagnosis is not a field value competing
with an AI guess — it is a different kind of object with its own authority.

## SymptomRecord

```ts
interface SymptomRecord {
  location: {
    region, side, depth, subRegionId, userPhrase,
    point: {x, y} | null,
    userSelectedStructureIds: string[]  // VISUAL SELECTIONS, not findings
  };
  consideredStructures: ConsideredStructure[]  // CANDIDATES, never facts
  quality: Quality[];                 // dull | sharp | burning | pulling | ...
  triggers: Trigger[];                // movement | lifting | night | stairs | ...
  triggerDetail: string | null;       // "arm up past ~90 degrees"
  radiation: string[];
  tendernessOnPalpation: 'no'|'mild'|'moderate'|'severe'|'not_tested'|'unknown';
  temporal:  { onset, onsetAt, durationValue, durationUnit,
               frequency, pattern, trend, isRecurrence };
  function:  { activitiesAffected, sleepAffected, intensity, takesPainkiller,
               unableWeighBearing };
  context:   { recentInjury, recentActivity, systemicSymptoms, medications,
               priorConditions, relatedEpisodeIds };
  gaps: string[];                     // "asked:lower_back.bladder"
}
```

### Two structural decisions worth arguing for

**`userSelectedStructureIds` and `consideredStructures` are separate fields, not one
list with a flag.** It is tempting to have `structures: [{id, selected: boolean}]`.
Splitting them means the type system makes it impossible to render a candidate as a
finding, and impossible for a bug in one code path to promote a candidate. The summary
generator reads them as two separate sections for exactly this reason.

**`userSelectedStructureIds` is the only source of truth for user selection.**
`consideredStructures[].selectedByUser` is a *derived projection* of that id set,
recomputed by `projectUserSelection` in the store's `rebuildRecord`, in the
client's select/deselect, and once more in `buildPreVisitSummary`. Two
independently writable copies of one fact could disagree, and a disagreeing
record listed a structure as both "an area you pointed to" and "suggested, not
acted on" — two different claims about the same structure, in a document a
clinician reads. The flag is therefore ignored on write, and `rationale`,
`confidence` and `structureId` are preserved exactly.
`userSelectionIsConsistent` exposes the invariant for tests.

**The id set is stored ORDERED-UNIQUE, first occurrence wins.** A client that
appends on every click produces `['patella', 'meniscus', 'patella']`, and the
array is rendered to a clinician as "areas you pointed to" — so a repeat is a
reporting bug, not a cosmetic one: the tool would tell a clinician the user
pointed at the same structure twice. Deduping happens in the same projection,
under the same "ignore on write, canonicalise on read" rule as the flag, and
deliberately does **not** sort or reorder: the order is the order the user acted
in, so first-occurrence-wins is the only correct choice. It also makes the
projection idempotent, which is what lets it run on every read without the record
drifting. The field store keeps whatever raw value it was given, because it is a
log of what arrived, not a render target.

**`gaps` is missing information, and only that.** A gap is a dotted path into the
record with no stored value, derived by the store from the field registry. It must
never contain an answer marker, and it never does: answer state lives in
`episode_answers`, which distinguishes `yes` / `no` / `unknown` / `not_asked` — a
distinction `gaps` cannot represent and which safety rules depend on.

**A value with no provenance cannot exist.** `episode_fields` holds the value and its
provenance in one row, written in one transaction. The previous design had two tables
written by two independent code paths, so a value could be stored with no provenance
and provenance could be asserted for a value nobody wrote. There is now no code path
that writes one without the other.

## Answers

`record.gaps` cannot hold answer state, so answers get their own table and their own
type. Four states, and the difference between the last two is the whole point:

| State | Meaning |
|---|---|
| `yes` | asked, patient said yes |
| `no` | asked, patient said **no** — a real negative |
| `unknown` | asked, patient did not know — genuinely indeterminate |
| `not_asked` | nobody has asked yet — missing |

Collapsing `unknown` into `no` is how a safety rule silently learns to treat "I don't
know" as reassurance, so the interview UI offers a third button and
`normaliseYesNo` returns `unknown` for anything it does not recognise. It **never**
defaults to `no`.

Safety rules do not read answer values directly, and they do not read record fields.
They read typed **signals** derived from the answer map:

```ts
signalsFromAnswers(answers, region).bladder_or_bowel_change
// 'yes' | 'no' | 'unknown' | 'not_asked'
```

A signal may be driven by more than one question — `fever_or_systemic_unwell` by both
`neck.systemic` and `lower_back.systemic` — so the combination is explicit rather than
last-write-wins: any `yes` wins; `unknown` beats `no`; `no` requires every **applicable**
driver to have been answered no.

**The combination is region-scoped, and that is a safety property rather than tidiness.**
An answer to `lower_back.systemic` left over from a different episode must not set
`fever_or_systemic_unwell` on a knee episode: the lower-back question was never asked for
that knee, and treating it as a `yes` would fire `msk.systemic_symptoms` for a region the
patient is not describing. Only the questions the current region's interview actually asks
participate. `signalDriversInRegion` replaces the earlier `questionForSignal`, which
returned the first match and so resolved every multi-driver signal to one question
regardless of region — which also made `signalIsAskedInRegion` report `false` for the
lower-back question it was supposed to find.

Two structural facts are deliberately separate: `record.gaps` is missing information and
never holds an answer, and the four answer states live in `episode_answers`.

## Missingness in the summary

The record schema is full of defaults: `sleepAffected: 'no'`,
`takesPainkiller: 'no'`, `systemicSymptoms: ['none']`, `side: 'unknown'`. Those are
placeholders, not answers. Rendering them told a clinician "Systemic symptoms: none
reported" for a patient who had never been asked.

Every field is now rendered against a **coverage map** derived from the field store,
and an unrecorded field says `not asked` — never `no`. The machine-readable
`structured` block applies the same rule by nulling anything uncovered, because
`"sleepAffected": "no"` in a JSON payload is a negative claim in the one part of the
output a downstream system would trust without reading the prose. The summary also
lists `outstandingFields` so a clinician can see what to ask about.

## Anatomy ontology

Structures use local stable IDs (`asi:shoulder.supraspinatus-tendon`) with terminology
bindings carried alongside:

```ts
coding: { snomedCt?: string, fma?: string, icd10?: string, status: 'unverified' | 'verified' }
```

`status` defaults to `unverified`. Nothing ships as `verified` until a human has checked
it against the issuing authority. There is a test asserting that the published regions
contain zero verified codes, so nobody can quietly promote a guess into a fact.
→ `packages/shared/src/anatomy.ts`, `docs/adr/0002-anatomy-model-source.md`

## Storage choices

| Decision | Why |
|---|---|
| SQLite via `node:sqlite` | No native compilation; portable single-file health record the user can copy or open. |
| No ORM yet | The schema is still moving. Drizzle is the right upgrade when it stops, not before. → `docs/adr/0001-local-first-storage.md` |
| JSON for the record, rows for provenance | The record is read as a whole; provenance is queried by field. |
| `PRAGMA secure_delete = ON` | Deleting a health record should actually remove the bytes. |
