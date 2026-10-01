# Architecture

Source product plan: `E:\1obsidian\Obsidian Vault\project\Anatomical_Symptom_Interface_Product_Plan_B_Format.md`

## The one-line architecture

A conversational front end that drives a **deterministic anatomical model layer**,
producing a **structured symptom record** whose every field carries its own provenance,
rendered as a **pre-visit summary** — with **safety messaging produced by rules, never by a model**.

## Layers

```text
┌──────────────────────────────────────────────────────────────┐
│  apps/web — React 19 + Vite                                  │
│  describe → locate (anatomy) → detail (interview) → summary  │
│                                                              │
│  AnatomyAdapter (interface)                                  │
│    ├── Svg2dAnatomyAdapter   ← implemented now               │
│    └── Three3dAnatomyAdapter ← planned, same contract        │
└───────────────────────────┬──────────────────────────────────┘
                            │  commands in, state out
┌───────────────────────────▼──────────────────────────────────┐
│  packages/server — Hono + node:sqlite                        │
│                                                              │
│  Symptom Orchestrator (interface)                            │
│    ├── DeterministicOrchestrator ← default, offline, testable│
│    └── ModelOrchestrator        ← propose-only, any provider │
│                                                              │
│  Symptom Record Store   │   Safety Rule Engine              │
│  episodes + provenance   │   deterministic red flags        │
│  migrations + read models│                                   │
└───────────────────────────┬──────────────────────────────────┘
                             │
┌───────────────────────────▼──────────────────────────────────┐
│  packages/shared — pure, no I/O, no network                  │
│  anatomy ontology · interview registry · red-flag rules      │
│  provenance invariants · pre-visit summary builder           │
│  anatomy asset manifest + conversion pipeline (pure)         │
└──────────────────────────────────────────────────────────────┘
```

## What a "place" is

`body_regions` is a **derived spatial index**: one row per *place*, the unit the
personal health map groups by. Its identity is:

```
(person, region, side, subRegion, cell)
```

where `cell` is the normalised pin quantised onto a 0.05 grid.

Region, side and sub-region alone are **not** enough, and two bugs proved it. A
row created before its sub-region was known could not be found again by a later
episode that landed in the same sub-region, splitting one place into two rows of
one. Two episodes in the same region and side with no sub-region shared a row,
and the pin columns were overwritten by whichever wrote last, merging two
distinct places and silently moving one episode's location.

**Why the point is part of identity.** The same shoulder genuinely sore in two
clearly different places is two entries in a body history, and collapsing them
misrepresents it.

**Why it is quantised rather than exact.** A body map is schematic, and two pins a
few pixels apart are the same place to a person. Exact coordinates would make
every re-click a new place, and the map would fill with near-identical dots, which
is its own kind of lie. 0.05 of the normalised map is 20×20 cells per region,
roughly a fingertip on the current schematic. It is a product decision, so it is
written here to be argued with rather than buried in a constant.

**Membership is derived, never counted.** There is no increment and no decrement.
A place's aggregates are recomputed from the episodes that actually point at it,
which is what makes the index re-derivable: it cannot drift, cannot double-count,
and a restart changes nothing. The representative point is the **mean** of the
member pins, not the last one written, so adding an episode cannot move another
episode's location.

**Moving an episode re-homes it.** It leaves the place it was in and joins the one
it is now in, on both pin and sub-region. A place with no episodes is not a place,
so it is deleted.

An episode's **own** pin is returned next to the place aggregate, because they are
different facts: a client given only the aggregate would attribute every episode in
a place to the same spot.

## Storage: migrations, not rebuilds

The schema is versioned by an ordered migration list in
`packages/server/src/db/migrations/`, applied in version order, each step in its
own transaction, on every startup.

**This replaced a policy that dropped the database.** The old rule was: when
`PRAGMA user_version` did not match a hardcoded number, `DROP` every table and
rebuild. That was only defensible while the data was disposable, and it made one
thing permanently impossible — adding a column to a database that already held
records. The refusal state that v2 needed for unsupported episodes could not ship
without erasing the episodes it exists to describe.

What the policy is now:

- **Nothing is dropped to make a version match.** A file this build cannot
  recognise is refused at startup with an explanation and left exactly as it was.
  Refusing is correct: guessing at an unknown schema is how somebody loses a
  history they cannot get back.
- **No half-migrated state.** The version stamp is written inside the same
  transaction as the schema change, so a failure rolls both back together and a
  retry starts from a known version.
- **Legacy files are adopted by shape, not by number.** A file predating the
  migration table carries no history, and a version number alone cannot be
  trusted when a build could bump it without finishing the work.
- **Applied migrations are checksummed.** Editing a migration that databases have
  already run fails loudly rather than letting fresh and existing databases drift
  apart silently.

`body_regions` is a **derived spatial index**, not a second source of truth: it is
rebuilt from the record inside the same transaction that writes it, which is what
makes a pin and the map that shows it impossible to disagree.

## Read models

Two Phase 1A additions, both server-side on purpose. A client that re-derives
something the server already knows will eventually disagree with it — and did.

- **`/api/healthmap/:personId/spatial`** — every place with its normalised point
  and the episodes behind it, so the browser never scans episodes to draw a body.
  A **location history, not a risk map**: episode count is how *often* a place was
  described, and nothing weighs it against anything.
  The transport contract is `SpatialHistoryNode` in `@asi/shared`, not in the
  server. The browser used to group episodes itself on region + sub-region + side
  and therefore merged two places this endpoint had deliberately kept apart,
  because a place is five fields wide and the client knew three of them. Sharing
  the type is what makes that class of bug a compile error.
- **`/api/episodes/:id/reopen`** — record, answers, next question, progress and
  outstanding fields, so a resuming session does not re-derive the interview
  position in the browser. The summary is deliberately excluded: rebuilding it
  evaluates the safety rules, and a resume must not re-present a blocked gate as
  if it were new. Shared contract: `EpisodeReopen` in `@asi/shared`. Reopening
  sets the **same** episode id, so continuing updates one record rather than
  creating a second.

Both are wired to the UI. Neither is a client-side schema, and the presentation
layer above them may sort, label and filter but may not merge, dedupe or recount.


## Anatomy assets: one authority, one adapter

There is exactly one production description of an anatomy asset, and it is not in
the viewer's layer.

```text
AssetManifest (@asi/shared)      asiId, meshName, region, subRegionIds, layer,
   │   parseManifest /            anatomicalLabel, layTerm, laterality, FMA,
   │   validateManifest           source, licence, geometry, bounds, file
   │                              ← the production asset authority
   ▼
toRendererScene()                 ONE adapter, ONE direction. Converts file→URL
   │                              and bounds→framing; carries asiId, layer and the
   │                              whole subRegionIds list through untouched;
   │                              derives the attribution notice.
   ▼
RendererSceneManifest (apps/web)  which mesh, which views, which layer, where to
                                  aim the camera. Carries NO licence authority.
   ▼
renderer                         mounts, picks, falls back to 2D
```

Four decisions in that diagram are load-bearing:

- **`asiId` is the only identity.** The source mesh name is provenance: third-party
  terminologies get re-numbered and renamed, and an upstream rename must not
  repoint a user's saved visual selection at a different structure.
- **`subRegionIds` is a list and stays one.** One structure can legitimately be
  reachable from several sub-regions — the deltoid is selectable from both
  `shoulder.anterior` and `shoulder.lateral`, and one mesh serves both. The scene
  carries the whole list; a `soleSubRegionId` exists only when there is exactly one
  member; picking reports candidates rather than choosing. `subRegionIds[0]` is
  the silent truncation this shape exists to prevent.
- **Attribution is derived, not authored.** `externalAssetNotice` is computed from
  `licence.attribution`, `source.dataset` and `source.release`, and
  `assertSceneAttribution` recomputes it and refuses a scene whose string
  disagrees. That is what makes "no hand-written notice" enforceable rather than
  aspirational. A fixture may carry a licence — this project generated the
  geometry — but may not claim a non-synthetic one, and no UI is given licence
  evidence for one at all.
- **`nodeName` is optional.** The Core pipeline emits one mesh per GLB, so
  requiring a node name would make the adapter refuse every real asset it exists
  to consume.
- **One scene carries one attribution.** The panel can display one licence and one
  citation, and "these assets" is what a user is being asked to trust. So every
  entry must agree on the licence that governs it and on its dataset, release,
  archive and DOI; a mixed manifest is **refused** rather than reported under its
  first entry's provenance. Taking `entries[0]` is a licence misstatement, and
  unioning the fields would fabricate a citation naming sources and terms that were
  never issued together. The canonical schema still allows per-entry overrides, and
  the **effective licence of an entry is the licence ON that entry** — reading the
  manifest default is wrong exactly when it matters, which is the only case that
  matters. A mixed dataset becomes multiple scenes, not a looser contract.
- **Scene-level citation holds release-level facts only**: `dataset`, `release`,
  `archive`, `doi` and the licence. `conceptId` is deliberately **not** among them
  and is not on the scene at all — it identifies a concept *inside* a release, so a
  scene of two structures has two of them, and reporting the first entry's would
  present one structure's identity as a property of all of them. It lives on
  `RendererSceneEntry.provenance`, the only place that can hold it honestly.
- **`RendererSceneSource` names no supplier.** It is `fixture | external`, because
  the earlier `bodyparts3d` value labelled every non-synthetic manifest with one
  dataset's name — including a Z-Anatomy scene or our own. The real dataset name is
  `attribution.source.dataset`, and it comes from the canonical manifest.

## A 3D click, and what follows from it

Clicking real geometry resolves to an `asiId` and the whole `subRegionIds` list.
Two pure functions own what happens next, because the answer varies with what was
hit and a wrong answer is a wrong record: `intentFromPick` turns a `PickResult` into
an intent, and `reducePickToDraft` reduces that against the workbench draft.

- The **structure is selected immediately**, because that is unambiguous. The
  canonical authority is still `location.userSelectedStructureIds`; the session's own
  `select` writes it.
- The **area** is kept when the recorded area is one the structure is reachable from,
  adopted when there is exactly one candidate, and reconciled against the candidates
  when there are several.
- An **area proxy** selects an area and never invents a structure. A sub-region is a
  place on the body, not a structure.
- The **surface point** is a location indication — it becomes the user's pin, carries
  no tissue and no diagnostic meaning, and it carries nothing into the answer set.

Reconciling the draft is **not** "leave it alone". A pending area is not persisted
truth, but it *is* what "Use this location" will submit, and that button is gated
only on the draft having an area. So a draft area the structure cannot be in is
cleared rather than carried forward — otherwise the user submits "the back of the
shoulder, plus the deltoid", a record of something they did not indicate. A draft
area that *is* a candidate is kept, because it is the user's own pending intent for
a place the structure genuinely can be in.

A pin follows the same ownership rule: a pin from the current pick stays, and a pin
left over in an area that was just invalidated goes, because a point from the back
of the shoulder cannot describe a deltoid.

The renderer has no other route to the canonical manifest, which is the point:
a second authority for asset identity or licensing is how a scene ends up
describing geometry the pipeline never produced.


## The rules the architecture enforces

These are not style preferences. Each one exists because breaking it produces a
specific, named failure.

**1. The model may propose. Nothing else.**
`ModelOrchestrator` is only allowed to return candidates. It has no write path to
the store. Its output is `ai_inference` with a mandatory confidence, and
`assertProvenance` throws if anyone tries to mark such a value `user_confirmed`.
The field registry goes further: a field marked `requiresUserSource` rejects an
`ai_inference` write outright.
→ `packages/shared/src/provenance.ts`, `packages/shared/src/field-policy.ts`

**2. There is one write path, and it is atomic.**
`applyMutations` validates each value against the field registry, validates its
provenance, runs the claim-class merge, writes the field row **containing the value
and its provenance together**, records losing values as preserved parallel
assertions, rebuilds the materialised record, and re-evaluates safety — in one
transaction. A validation failure throws and rolls the whole batch back, so a client
is never told a forbidden write succeeded. `PATCH /record` and `POST /confirm` were
removed because they let value and provenance diverge.
→ `packages/server/src/db/store.ts`

**3. Safety messaging is a rule engine, not generation.**
Red flags are typed signals, not scraped text: every predicate takes a
`SafetySignals` object with four-state values, and no rule contains a regex over user
text. Rules read `yes`, never "a marker that exists whether the answer was yes or no".
→ `packages/shared/src/safety-signals.ts`, `packages/shared/src/rules/redflags.ts`

**4. There is no default region.**
Localisation returns either a grounded result or an explicit refusal. A previous
version defaulted to `shoulder`, so a chest complaint silently entered the shoulder
questionnaire. The region interview also refuses to run for an episode whose
grounding was not successful.
→ `packages/shared/src/grounding.ts`, `packages/server/src/app.ts`

**5. Missingness is never a negative claim.**
The record schema is full of negative defaults. The summary renders against a coverage
map from the field store, so an unasked field says "not asked" rather than "none
reported", and the machine-readable block nulls it rather than serialising `"no"`.
→ `packages/shared/src/summary.ts`

**6. The pre-visit summary is generated deterministically.**
The text a doctor reads never passes through a model. A hallucinated chat reply is
annoying; a hallucinated sentence in a medical summary is a different class of harm.
→ `packages/shared/src/summary.ts`

**7. Provenance is relational, not a blob.**
`episode_fields` is a table keyed by `(episode_id, field_path)`. "Show me everything
the model inferred" is a `WHERE` clause, not a JSON scan.
→ `packages/server/src/db/client.ts`

**8. A visual selection is not a finding.**
`userSelectedStructureIds` records where the patient pointed. It is never rendered as
a confirmed structure, a diagnosis site, or a finding. See ADR 0004.

**9. The release profile cannot hide a safety signal.**
In `release`, a rule that fires but is not clinically reviewed is **withheld and the
record is blocked** — not silently dropped. `ASI_RELEASE_PROFILE=release` refuses to
start at all while any urgent/emergency rule is unreviewed. CI fails on missing or
malformed safety metadata rather than treating an empty value as green.
→ `packages/shared/src/rules/redflags.ts`, `packages/server/src/env.ts`, `scripts/check-safety-metadata.mjs`

**10. The service runs with zero configuration.**
No API key ⇒ deterministic orchestrator. The full product path — grounding, interview,
red flags, summary, history — works fully offline. A health tool that stops working
without a network call is a health tool some people cannot use.
→ `packages/server/src/orchestrator/index.ts`

## Request flow, end to end

```text
user: "右肩里面这里疼，抬手就明显"
  │
  ├─ POST /api/localise
  │    └─ orchestrator.localise()
  │         └─ groundOrRefuse()   region=shoulder side=right depth=deep
  │                                 ...or status:'unsupported', and the client
  │                                    must stop before the region interview
  │         └─ returns consideredStructures[] as CANDIDATES
  │
  ├─ client: anatomy.apply(focusRegion / focusSubRegion / highlight)
  │    └─ SVG map opens at the right shoulder, candidates highlighted
  │
  ├─ user clicks "long head of biceps tendon"
  │    └─ visual selection — a location, NOT a finding (ADR 0004)
  │
  ├─ POST /api/episodes   (grounding + field mutations + answers)
  │    └─ ONE atomic path: registry validation → provenance validation →
  │       claim-class merge → field row (value+provenance) → record projection →
  │       safety re-evaluation. A rejection rolls the whole batch back.
  │
  ├─ POST /api/episodes/:id/mutations   (every subsequent answer)
  │    └─ answers go to episode_answers with a four-state value
  │    └─ evaluateSafety() re-runs on EVERY answer, from derived SIGNALS
  │       so yes / no / unknown / not_asked can never be confused
  │
  └─ GET /api/episodes/:id/summary
       └─ buildPreVisitSummary(episode, {flags, coverage, priorEpisodes, withheld})
       └─ deterministic text, "not a diagnosis" footer, "not asked" for gaps
```

## Where the interesting failures live

| Failure | Where it is caught |
|---|---|
| Model output stored as a confirmed fact | `requiresUserSource` in the field registry; `assertProvenance` |
| Value persisted without provenance | impossible: one row, one transaction |
| A red flag silently disappears | release profile withholds **and blocks**; append-only `safety_flags` |
| "No" answered where the rule needed "yes" | four-state answers + typed signals |
| Region guessed from nothing | `groundOrRefuse` returns `unsupported`; no default region exists |
| Interview run on an ungrounded episode | `/interview/next` returns 409 |
| Summary claims "none reported" for an unasked field | coverage map; `render()` returns "not asked" |
| Device reading overwrites a symptom | claim-class merge; out-of-class value preserved in parallel |
| A structure rendered as a finding | separate fields + a test that "confirmed" never appears in a summary |
| 3D swap breaks the UI | `AnatomyAdapter` contract; adapter is the only importer of geometry |
| A rule predicate throws | `evaluateSafety` records it as **not evaluated**, never "not fired" |
| CI reads an empty safety count as green | `scripts/check-safety-metadata.mjs` fails on missing or malformed metadata |

## Deliberate non-goals in V1

- No diagnosis, no disease ranking, no probability of a condition.
- No LLM in the safety path.
- No third-party anatomy asset dependency (see `docs/research/anatomy-assets.md`).
- No multi-user, auth, or cloud sync. Single local person, by design.
