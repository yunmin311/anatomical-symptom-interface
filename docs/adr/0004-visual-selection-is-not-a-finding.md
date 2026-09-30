# 0004 — A visual selection is not a finding

**Status:** accepted · **Date:** 2026-09-30

## Context

The first implementation of the anatomy model layer called the field
`userConfirmedStructureIds` and flagged candidates with `confirmedByUser`. The
summary rendered them as "Structures confirmed by patient".

That vocabulary was wrong in a way that mattered, even though nothing about the
code was broken. When a patient taps the nearest anatomical landmark to their
pain, they have told us **where it is**. They have not told us **what is wrong
there**, and a clinician reading "confirmed: long head of biceps tendon" would
reasonably read it as a finding.

The product plan (§3.1) says the system must distinguish "user-confirmed
location" from "system-considered structures". The intent was right. The words
were not, and words are what a summary conveys.

## Decision

Rename the concept throughout, and separate two axes that were conflated:

**Axis 1 — provenance: who supplied it.** Unchanged. `sourceType` stays
`user_selection` when the value came from clicking the body map.

**Axis 2 — evidence status: what kind of claim it is.** New. `evidenceStatus` is
one of:

| Evidence status | Means |
|---|---|
| `user_report` | the patient described it in words |
| `visual_selection` | the patient pointed at it on the anatomy model |
| `ai_candidate` | the model proposed it; nobody asserted it |
| `clinician_finding` | a clinician asserted it |
| `system_derived` | computed by our own deterministic code |

`assertProvenance` enforces that a source type and an evidence status are
compatible. A model can only ever produce an `ai_candidate`; only a clinician or
an external record can produce a `clinician_finding`.

## The renames

| Was | Now |
|---|---|
| `location.userConfirmedStructureIds` | `location.userSelectedStructureIds` |
| `ConsideredStructure.confirmedByUser` | `ConsideredStructure.selectedByUser` |
| `ViewerCommand.highlight as: 'confirmed'` | `as: 'selected'` |
| "Structures confirmed by patient" | "Areas pointed to on the body map" |
| "Did you mean any of these?" | "Does that look like the place?" |
| "CONSIDERED BUT NOT CONFIRMED BY PATIENT" | "SUGGESTED BY THE TOOL AND NOT ACTED ON (not findings)" |

## Why this is an architecture point, not a copy edit

The reason to change the field name, not just the label, is that the compiler
should carry the meaning. `userSelectedStructureIds` cannot be misread as a
finding by the next person who writes a query, a summary line, or a bug report.
`userConfirmedStructureIds` would be, repeatedly, forever.

A test now asserts the string "confirmed" does not appear in a rendered summary
at all.

## What a selection IS

It is a high-value, high-quality piece of information that we were under-valuing.
"It is in this exact place, and the patient recognised that place" is more
useful to a clinician than free text, and it is the thing the whole
Anatomical Grounding proposition rests on. The point is not to discount it. The
point is to name it accurately so it is not over-credited.

## The candidate → selection path, precisely

```text
model output            → consideredStructures[]
                           evidenceStatus: 'ai_candidate'
                           selectedByUser: false
        │
        │  user clicks a structure on the anatomy map
        ▼
                        → location.userSelectedStructureIds[]
                           evidenceStatus: 'visual_selection'
                           selectedByUser: true
        │
        ▼
                        → summary: "Areas pointed to on the body map"
                           summary: "Suggested, not acted on (not findings)"
```

There is no path from either state to a diagnosis, and none is planned in V1.
That boundary is ADR 0003; this ADR fixes the vocabulary that was quietly
blurring it.

## Consequences

- Every place that displayed a selection is a place that could have implied a
  finding. All of them were reviewed.
- The `consider` / `confirm` vocabulary in the UI is gone. If a future feature
  genuinely does confirm something, it must say what is confirmed — a
  `clinician_finding`, which V1 does not have.
- Terminology used elsewhere: "the user pointed at", "the user indicated",
  "visual selection". Never "confirmed", "confirmed diagnosis site", "the
  affected structure".

## One source of truth for the selection

`location.userSelectedStructureIds` is **canonical** for "the user pointed at
this". `consideredStructures[].selectedByUser` is a **derived projection** of it.

They used to be two independently writable copies of the same fact, which meant a
client could persist a record where a candidate read as simultaneously selected
and unselected. The summary then listed the structure under both "areas you
pointed to" and "suggested, not acted on" — two different claims about the same
structure, in a document a clinician reads.

So the flag is ignored on write:

```text
persisted  location.userSelectedStructureIds  ─┐
                                                ├─→  projectUserSelection()  ──→  consideredStructures[].selectedByUser
persisted  consideredStructures[].selectedByUser ─┘
```

`projectUserSelection` runs in the server's `rebuildRecord` (so a contradiction
can never be *read*) and again in the client's `selectStructure` /
`deselectStructure` (so the local view matches). `buildPreVisitSummary` projects
once more, because the guarantee that matters is the one at the last point before
a clinician reads the text.

It also reduces the id set to **ordered-unique, first occurrence wins**. That
array is rendered as "areas you pointed to", so a repeat would tell a clinician
the user pointed at the same structure twice — a reporting bug, not a cosmetic
one. It is deliberately not sorted: the order is the order the user acted in.
First-occurrence-wins also makes the projection idempotent, which is what allows
it to run on every read. Like the flag, the raw value stays in the field store;
only the projection canonicalises, because the field store is a log of what
arrived, not a render target.

`rationale`, `confidence` and `structureId` are never touched by the projection —
the candidate is the model's evidence about what the user described, and rewriting
it would be a different kind of data loss.
