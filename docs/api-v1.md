# The V1 API

Everything an external client needs, and the rules a second surface must not break.

The schemas live in `packages/shared/src/api-contract.ts`. Import them; do not restate
them. The tests in `packages/server/test/api-contract.test.ts` hold both surfaces to them.

---

## The rules that are not negotiable

**1. There is one write path, and it is `POST /api/episodes/:id/mutations`.**
Validation, provenance, the claim-class merge, the field row, the preserved assertions, the
record projection and the safety re-evaluation all happen inside one transaction. A
rejected mutation rolls the whole batch back.

No client may write a record. There is no endpoint that accepts a client-supplied
`SymptomRecord`, and there is no endpoint that marks a field user-confirmed without a value
that exists and matches.

**2. Provenance is supplied, never inferred by the server.**
The client states `sourceType`, `verificationStatus` and `createdBy`. The server checks that
provenance is well-formed and that the *field policy* permits that source type for that
field. It never upgrades a claim to `user_confirmed` on the client's behalf.

**3. Safety is a rule engine.**
Pure predicates over typed signals, never over text, never a model call. A rule says "get
this assessed", never "you have X".

**4. There is no default region.**
Localisation returns grounded or `unsupported`. An episode whose grounding did not succeed
cannot enter a region interview, and the refusal is explicit.

**5. A visual selection is not a finding.**
Wording matters: "pointed at", "indicated", "visual selection". Never "confirmed".

**6. Retired ids are ACCEPTED and STORED CANONICAL.**
`asi:neck.upper-trapezius` is accepted and stored as `asi:shoulder.trapezius-upper`.
Region membership comes from the ontology, not the id prefix.

This is one rule, enforced in the store, so HTTP and MCP cannot disagree about it — and it
applies to `location.userSelectedStructureIds` and to `consideredStructures[].structureId`.
An id that is neither current nor retired is still refused, with `unknown_structure`.

Because a retired id is accepted rather than refused, there is no `retired_structure` error
code. A client must not branch on one.

The field store holds current values, not an append-only log, so keeping the id the caller
sent would preserve no evidence — it would only leave a row holding an id that resolves to no
structure. The projection still canonicalises on read as well, which is what makes this
idempotent for records written before a retirement.

---

## Errors

Every failure carries a stable code from `ApiErrorCodeSchema`, plus a human message and,
where it exists, the detail needed to act.

```json
{ "error": "field_policy_violation", "message": "...", "field": "location.region" }
```

| code | status | meaning |
| --- | --- | --- |
| `validation_failed` | 400 | body/query did not match the schema; `detail` carries the issues |
| `episode_not_found` | 404 | no episode with that id |
| `episode_not_localised` | 409 | grounding did not succeed; the interview is refused |
| `field_policy_violation` | 422 | the registry or the provenance rules refused this write; `field` says which |
| `mutation_rejected` | 404 | the store refused the batch |
| `unknown_region` | 404 | no such region in this build; `region` echoes the input |
| `unknown_question` | 422 | the region's interview has no such question |
| `unknown_structure` | 422 | no such canonical id |
| `not_found` | 404 | something else is absent |
| `internal_error` | 500 | unclassified. Never used to hide a known failure |

Branch on `error`. `message` is for a person and will change.

Every refusal above is `4xx` and arrives in this envelope, including a broken provenance
rule. A provenance violation — `ai_inference` without a confidence, a `user_statement`
marked `clinician_confirmed` — is the client sending something the product will not
accept, so it is `field_policy_violation` and not a server fault. It used to reach Hono's
default handler and answer `500` with the body `Internal Server Error`, which told clients
the server had broken and gave them a body they could not parse. MCP returns the same
codes for the same refusals, so one error handler covers both surfaces.

---

## Capabilities

### `GET /api/health`

Release-safety metadata. `releaseReady` is false while safety rules are unreviewed, and
`unreviewedSafetyRules` is the honest count. CI asserts on these field names.

### `GET /api/anatomy/capability`

What can actually be **rendered**, per region and side — as opposed to
`GET /api/regions`, which only says what exists in the ontology.

The mesh and triangle counts are read from the same generated manifests the renderer
mounts, so a missing build is reported missing rather than reported as intended.

```jsonc
{
  "schemaVersion": 1,
  "dataset": { "name": "BodyParts3D", "release": "4.0", "licence": "CC-BY-4.0", "url": "..." },
  "regions": [{
    "region": "neck",
    "hasThreeD": true,
    "sides": [
      { "side": "left",    "available": true,  "threeD": { "available": true, "meshes": 18, "triangles": 20216 } },
      { "side": "right",   "available": true,  "threeD": { "available": true, "meshes": 16, "triangles": 18204 } },
      { "side": "midline", "available": true,  "threeD": { "available": true, "meshes": 7,  "triangles": 2232 } },
      { "side": "bilateral", "available": false,
        "threeD": { "available": false, "reason": "Bilateral is not a build: it is the left and right scenes shown together, and neither is mirrored." } }
    ],
    "structures": [{ "asiId": "...", "threeDAvailable": true, "twoDPlaceholder": true }],
    "unavailable": [{ "asiId": "asi:knee.mcl", "label": "...", "reason": "..." }]
  }]
}
```

Three things a client must not get wrong:

- **`bilateral` is never a build.** It is the two side scenes shown together. Never one
  mirrored.
- **`twoDPlaceholder: true` means the 2D map is hand-drawn schematic geometry.** It is
  honest to render and wrong to ship as medical artwork.
- **`unavailable[].reason` is a fact about the DATASET**, not about this build. "The source
  has no knee ligaments" is not a task that a future release completes.

### `POST /api/localise`

`{ "utterance": string, "pinnedRegion"?: BodyRegion }` → a grounded result or an explicit
refusal. There is no default region.

### `GET /api/interview/:region`

The region's questions, with their `applyTo` mapping. Questions are data; adding one does
not touch the orchestrator.

---

## Episodes

### `POST /api/episodes`

Creates an episode. `grounding` is **required** and must be a real outcome — including
`{ "status": "unsupported", "reason": "ungrounded" }`, which is refused with 409. An
episode cannot be created without stating what localisation concluded.

### `POST /api/episodes/:id/mutations`

The write path. One batch, so a safety answer exists before the rules run.

```jsonc
{
  "mutations": [{
    "fieldPath": "location.userSelectedStructureIds",
    "value": ["asi:neck.upper-trapezius"],
    "provenance": { "sourceType": "user_selection", "verificationStatus": "unverified", "createdBy": "user" }
  }],
  "answers": [{ "questionId": "shoulder.night_pain", "raw": "no", "createdBy": "user" }]
}
```

The response reports what happened to each field, which is not always "written":

```jsonc
{
  "applied": [{ "fieldPath": "...", "action": "written" }],
  "rejected": [],
  "answers": [{ "questionId": "shoulder.night_pain", "triState": "no", "replaced": true }],
  "coverage": { "location.side": true },
  "preserved": 0,
  "safety": { "flags": [], "gateBlocked": false }
}
```

`action` is one of `written`, `kept_incumbent`, `recorded_in_parallel`. A merge by claim
class that loses does not disappear — it is preserved, and `preserved` counts it.

### Answer correction is this endpoint

Posting an answer for a question that already has one **replaces** it, and says so:
`answers[].replaced`.

The store marks the replacement `user_edited` **from the row**, not from anything the
client claims. A client therefore cannot assert a correction that did not happen, and
cannot downgrade a real correction either — the server does not believe the client about
this.

The original value is **not** retained. See `docs/known-limitations.md`.

### `GET /api/episodes/:id`

The episode with `grounding`, `answers` and `safety` attached.

### `GET /api/episodes/:id/reopen`

Everything a resuming session needs in one payload: record, answers, next question,
progress, outstanding set. A client that re-derives the next question in the browser will
eventually disagree with the server about it.

Reopening does not create a second record. The next save updates the same episode.

### `GET /api/episodes/:id/summary` and `.txt`

The clinician-facing summary. It never calls a model, and it renders against a coverage map:
an unasked field is "not asked", never a negative it does not have.

### `GET /api/episodes/:id/prior`, `POST /api/episodes/:id/note`

Prior episodes in the same place, and a transcript append.

---

## Spatial history

### `GET /api/healthmap/:personId/spatial`

Every place, its normalised point, and the episodes behind the count, so a client never
scans episodes to draw a body.

This is a **location history, not a risk map**. Episode count is how often a place was
described. Nothing in the payload weighs it against anything, and a client must not.

Place identity and counts are computed **server-side**. A client that recomputes them will
disagree with the server, and the disagreement shows up as a wrong number to the user.

---

## Adding a surface

If you are writing a client, an integration or an MCP server:

- Import the schemas from `@asi/shared`. Do not restate them.
- Call `POST /api/episodes/:id/mutations`. There is no other write.
- Let the server decide provenance, canonicalisation, safety and merging.
- Branch on `error` codes, never on `message`.
- Read `GET /api/anatomy/capability` before offering any 3D.

A second surface that re-implements any of those has two answers to one question, and the
permissive one is the one that ships.