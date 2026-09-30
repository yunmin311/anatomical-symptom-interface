# Anatomical Symptom Interface

> Turn "it hurts here" into a structured, anatomical, longitudinal health record that
> both the user and their doctor can understand.

A local-first tool that helps a person describe *where* something hurts, *what kind of
thing* is involved, and *when it happens* — and turns that into a structured record a
clinician can scan in fifteen seconds.

**This is not a diagnosis tool.** It does not tell you what you have. It helps you
describe what you feel, and it does not lose the difference between what you said, what
the model guessed, what a device measured, and what a doctor concluded.

---

## What exists right now

```text
"右肩里面这里疼，抬手就明显"
        │
        ▼
  ground or REFUSE (offline, EN + ZH)
    grounded → region / side / depth / candidates
    ungrounded or non-MSK → stops, says why, points at a clinician
        │
        ▼
  2D anatomy map  ────────────────►  user points at a structure
        │                            (a visual selection, NOT a finding)
        ▼
  region-specific interview ─────►  yes / no / "I'm not sure" / not asked
        │                           four states, kept distinct everywhere
        ▼
  red-flag rules  ───────────────►  typed signals, never scraped text
        │                           deterministic, reviewed metadata
        ▼
  pre-visit summary ─────────────►  scannable in 15s, deterministic text
        │                           unasked fields say "not asked",
        │                           never "none reported"
        ▼
  personal health map ───────────►  every episode, indexed by body region
```

## Quick start

```bash
pnpm install
pnpm seed          # optional: a 3-episode demo history
pnpm dev           # server :8787 + web :5173
```

Open http://localhost:5173.

**No API key needed.** Without one, the orchestrator runs fully offline on deterministic
rules. Set `ANTHROPIC_API_KEY` in `packages/server/.env` to enable the model-backed
localiser, which can only *propose* locations — never confirm them.

```bash
pnpm typecheck     # all packages
pnpm test          # 213 unit tests across three packages
node scripts/smoke.mjs   # 38 API checks (server must be running)
```

## Layout

```text
packages/shared     pure domain core — provenance, field policy, answers,
                    safety signals, red flags, summary. No I/O, no network.
packages/server     Hono + node:sqlite — orchestrator, record store, API
apps/web            React + Vite — session UI and the anatomy model layer
docs/               architecture, data model, tech stack, roadmap, ADRs
docs/research/      anatomy assets, reusable products, safety & regulatory
```

## The ideas worth knowing

**1. Provenance is not metadata. It is the product.**
Every field records who said it, when, how sure, and whether anyone verified it — in
the *same database row* as the value, written in the same transaction, so they cannot
diverge. A clinician's assertion outranks a self-report, which outranks a model guess.

**2. Authority is per claim class, not one ladder.**
A single global ranking is wrong for health data: it would let a wearable step count
overwrite "my knee hurts". So a field also declares a *claim class*, and a source type
that has no standing in a class can never become the winner there — its value is
preserved in parallel instead.

**3. Provenance and evidence status are different axes.**
`sourceType` answers "who supplied this". `evidenceStatus` answers "what kind of claim
is it" — user report, visual selection, AI candidate, clinician finding, system
derived. Only a clinician can produce a finding; only a model can produce a candidate.

**4. Pointing at a structure is not a finding.**
It records where the patient indicated. Renamed from `userConfirmedStructureIds` to
`userSelectedStructureIds` because the old name read as a clinical result. A test
asserts the word "confirmed" never appears in a summary. See ADR 0004.

**5. Yes, no, "I'm not sure", and not-asked are four different things.**
Answers are stored as a four-state value, and safety rules read typed *signals* derived
from them. No rule contains a regex over user text. Collapsing "I don't know" into "no"
is how a safety rule learns to treat uncertainty as reassurance, so the UI offers a
third button and the normaliser never defaults to "no".

**6. Missingness is never a negative claim.**
The record schema is full of negative defaults. The summary renders against a coverage
map, so a field nobody asked about says "not asked" rather than "none reported", and
the machine-readable block nulls it rather than serialising `"no"`.

**7. There is no default region.**
Localisation returns a grounded result or an explicit refusal. A chest complaint
exits the workflow instead of entering the shoulder questionnaire, and the region
interview refuses to run for an ungrounded episode.

**8. Safety is code, and the release gate cannot be talked past.**
Red flags are pure predicates. Every rule carries review metadata that starts
`unreviewed`; in the `release` profile a fired-but-unreviewed rule is withheld **and the
record is blocked** rather than silently dropped, and the server refuses to start in
that profile at all while a time-critical rule is unreviewed. CI fails on malformed
safety metadata.

**9. There is exactly one write path.**
`applyMutations` validates the value against the field registry, validates provenance,
merges, writes, and re-evaluates safety in one transaction. A rejected mutation rolls
the whole batch back. `PATCH /record` and `POST /confirm` were removed because they let
a value and its provenance diverge.

## Current status

**Development build. Not for real users.** All 10 red-flag rules are unreviewed, 7 of
them urgent or emergency, and the server says so on startup. See
`docs/research/safety-regulatory.md` — including the known gaps, the most serious being
that the non-MSK router is a body-part matcher, not a medical assessment.

## Documentation

| | |
|---|---|
| [`docs/01-architecture.md`](docs/01-architecture.md) | The 10 enforced rules, request flow, where failures are caught |
| [`docs/02-data-model.md`](docs/02-data-model.md) | Two provenance axes, claim classes, the field registry, tables, missingness |
| [`docs/03-tech-stack.md`](docs/03-tech-stack.md) | What is in place, what is not, and what to use next |
| [`docs/04-roadmap.md`](docs/04-roadmap.md) | Phases, what is blocking, standing backlog |
| [`docs/research/anatomy-assets.md`](docs/research/anatomy-assets.md) | 3D model sources, the BodyParts3D licence correction, conversion pipeline |
| [`docs/research/products-to-reuse.md`](docs/research/products-to-reuse.md) | BioDigital, BodyParts3D, Infermedica, NHS 111, Kenhub, FHIR, Obsidian |
| [`docs/research/safety-regulatory.md`](docs/research/safety-regulatory.md) | Rules, review status, the release gate, honest gaps, regulatory horizon |
| [`docs/adr/`](docs/adr/) | Why local-first · why local IDs · why the clinical layer is separate · why a visual selection is not a finding |

Source product plan lives in the Obsidian vault at
`E:\1obsidian\Obsidian Vault\project\Anatomical_Symptom_Interface_Product_Plan_B_Format.md`.

## Licence

MIT for the code. Anatomy assets, if adopted, carry their own licences — see
`docs/research/anatomy-assets.md`.
