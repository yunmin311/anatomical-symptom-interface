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
│    └── ModelOrchestrator        ← Claude, propose-only      │
│                                                              │
│  Symptom Record Store   │   Safety Rule Engine              │
│  episodes + provenance   │   deterministic red flags        │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│  packages/shared — pure, no I/O, no network                  │
│  anatomy ontology · interview registry · red-flag rules      │
│  provenance invariants · pre-visit summary builder           │
└──────────────────────────────────────────────────────────────┘
```

## The rules the architecture enforces

These are not style preferences. Each one exists because breaking it produces a
specific, named failure.

**1. The model may propose. Nothing else.**
`ModelOrchestrator` is only allowed to return candidates. It has no write path to
the store. Its output is tagged `ai_inference` with a mandatory confidence, and
`assertProvenance` throws if anyone tries to mark such a value `user_confirmed`.
→ `packages/shared/src/provenance.ts`

**2. Safety messaging is a rule engine, not generation.**
A red flag means "get this assessed". A model deciding whether someone needs an
emergency department is not a feature, it is a liability. Every rule is a pure
predicate over the record, and every rule ships with review metadata that starts
`unreviewed`. The server prints a startup warning while any rule is unreviewed, and
`evaluateRedFlags(r, { requireReviewed: true })` can suppress them for release gating.
→ `packages/shared/src/rules/redflags.ts`

**3. The anatomy model layer is an interface, not a component.**
Viewer control, layer visibility, selection and marking are outside what a prompt
can do. The orchestrator sends `ViewerCommand`s and receives `ViewerState`. Swapping
SVG for Three.js touches one file.
→ `apps/web/src/anatomy/types.ts`

**4. The pre-visit summary is generated deterministically.**
The text a doctor reads never passes through a model. A hallucinated chat reply is
annoying; a hallucinated sentence in a medical summary is a different class of harm.
→ `packages/shared/src/summary.ts`

**5. Provenance is relational, not a blob.**
`field_provenance` is a table keyed by `(episode_id, field_path)`. That means
"show me everything the model inferred" is a `WHERE` clause, not a JSON scan — which
is what makes the guarantee auditable rather than aspirational.
→ `packages/server/src/db/client.ts`

**6. The service runs with zero configuration.**
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
  │         ├─ groundFromText()      region=shoulder side=right depth=deep
  │         └─ returns consideredStructures[] as CANDIDATES
  │
  ├─ client: anatomy.apply(focusRegion / focusSubRegion / highlight)
  │    └─ SVG map opens at the right shoulder, candidates highlighted
  │
  ├─ user clicks "long head of biceps tendon"
  │    └─ anatomy.apply(highlight as:'confirmed')  → becomes a FACT
  │
  ├─ POST /api/interview/shoulder/next
  │    └─ nextQuestion({record, asked})  → "does it wake you from sleep?"
  │    └─ user answers
  │    └─ record mutated; evaluateRedFlags() re-runs on EVERY answer
  │
  └─ POST /api/episodes  →  PATCH /record  →  /confirm
       └─ store writes record_json + field_provenance rows
       └─ GET /api/episodes/:id/summary
            └─ buildPreVisitSummary(episode, {flags, priorEpisodes})
            └─ deterministic text, "not a diagnosis" footer
```

## Where the interesting failures live

| Failure | Where it is caught |
|---|---|
| Model output stored as a confirmed fact | `assertProvenance` throws on write |
| A red flag silently disappears | append-only `safety_flags`, `RAISE IF NOT EXISTS` dedup, startup warning |
| Summary claims a diagnosis | test asserts banned phrasings never appear |
| Region guessed from nothing | `groundFromText` returns `null`; test covers it |
| 3D swap breaks the UI | `AnatomyAdapter` contract; adapter is the only importer of geometry |
| A rule predicate throws | `evaluateRedFlags` wraps every predicate in try/catch |

## Deliberate non-goals in V1

- No diagnosis, no disease ranking, no probability of a condition.
- No LLM in the safety path.
- No third-party anatomy asset dependency (see `docs/research/anatomy-assets.md`).
- No multi-user, auth, or cloud sync. Single local person, by design.
