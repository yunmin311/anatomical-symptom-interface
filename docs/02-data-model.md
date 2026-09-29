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

### Authority ranking

Conflicts resolve by authority, not recency. A doctor's diagnosis beats a user
self-report, which beats an AI guess.

| Source | Rank | Rationale |
|---|---:|---|
| `ai_inference` | 10 | A guess. Useful for search, worthless as fact. |
| `system_rule` | 20 | Deterministic, but only about *our* rules, not about you. |
| `user_selection` | 30 | Pointing at a body map is weaker than describing it. |
| `user_statement` | 40 | The primary source for symptoms. |
| `user_edited` | 50 | A correction beats the original. |
| `device_import` | 60 | Measured, but measures something narrow. |
| `external_record` | 70 | A report, about a test rather than a symptom. |
| `clinician_confirmed` | 90 | The only source that can be a diagnosis. |

### Enforced invariants

`assertProvenance` throws on any of these, and it is called on **every write**:

1. `ai_inference` can only be `unverified` or `refuted`. Never `user_confirmed`.
2. `ai_inference` must carry an explicit `confidence`. No silent assertions.
3. `clinician_confirmed` cannot be `unverified` — if a clinician said it, it's confirmed.
4. `user_edited` is always `user_confirmed`.
5. An unknown `sourceType` is a hard error, not a warning.

A field already owned by a higher-authority source is **not overwritten** by a lower one.
The losing write returns `{applied: false, reason}` and the original is preserved.

```ts
// The user says "dull", the model is confident it's "sharp". User wins.
mergeAttributed(aiGuess, userStatement).value === 'dull'
```

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
`SELECT * FROM field_provenance WHERE source_type = 'ai_inference'` a real capability
rather than a wish.

### `safety_flags` — append-only

Warnings we gave are part of the record. We must be able to show what the system said
and when, even after the rules change. Never updated, never deleted on rule change.

### `clinical_assertions` — Phase 2 reserved

A separate table for `diagnosis | test | treatment | outcome | imaging | lab`, with
`asserted_by`, `institution`, `source_document`. Kept separate from
`field_provenance` on purpose: a clinician's diagnosis is not a field value competing
with an AI guess — it is a different kind of object with its own authority.

## SymptomRecord

```ts
interface SymptomRecord {
  location: {
    region, side, depth, subRegionId, userPhrase,
    point: {x, y} | null,
    userConfirmedStructureIds: string[]   // FACTS
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

**`userConfirmedStructureIds` and `consideredStructures` are separate fields, not one
list with a flag.** It is tempting to have `structures: [{id, confirmed: boolean}]`.
Splitting them means the type system makes it impossible to render a candidate as a
finding, and impossible for a bug in one code path to promote a candidate. The summary
generator reads them as two separate sections for exactly this reason.

**`gaps` is a first-class field.** Recording "the user answered yes to the bladder
question" is what lets the rule engine fire on a signal that is not a clinical value.
Without it, safety rules would have to smuggle state through `radiation` as free text.

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
