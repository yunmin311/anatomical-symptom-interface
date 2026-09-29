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
  ground (offline, EN + ZH) ──────►  right shoulder · deep · anterior
        │
        ▼
  2D anatomy map  ────────────────►  user confirms "long head of biceps tendon"
        │                                       (candidate → fact)
        ▼
  region-specific interview ─────►  night pain? which movements? weakness or pain?
        │                           "does it wake you from sleep?" is asked
        ▼                                       because this is a shoulder
  red-flag rules  ───────────────►  deterministic, reviewed, never the model
        │
        ▼
  pre-visit summary ─────────────►  scannable in 15s, deterministic text
        │                           ends with "it is not a diagnosis"
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
pnpm test          # 28 domain unit tests
node scripts/smoke.mjs   # 17 API checks (server must be running)
```

## Layout

```text
packages/shared     pure domain core — anatomy, interview, red flags, provenance
packages/server     Hono + node:sqlite — orchestrator, record store, API
apps/web            React + Vite — session UI and the anatomy model layer
docs/               architecture, data model, tech stack, roadmap, ADRs
docs/research/      anatomy assets, reusable products, safety & regulatory
```

## The four ideas worth knowing

**1. Provenance is not metadata. It is the product.**
Every field records who said it, when, how sure they were, and whether anyone verified
it. `ai_inference` can never be marked confirmed — `assertProvenance` throws.
A clinician's assertion outranks a self-report, which outranks a model guess.

**2. Candidates and facts are different types.**
`consideredStructures` are what the model suggested. `userConfirmedStructureIds` are what
the user clicked. They are separate fields so the type system makes it impossible to
render a suggestion as a finding.

**3. Safety is code, not generation.**
Red flags are pure predicates over the record. Every rule ships with review metadata
that starts `unreviewed`, and the server warns at startup while that is true. The
orchestrator's tool schema has no field for a diagnosis, because a field that does not
exist is a stronger guarantee than a prompt instruction.

**4. The anatomy layer is an interface, not a component.**
`AnatomyAdapter` takes `ViewerCommand`s and returns `ViewerState`. A schematic 2D SVG
map implements it today. Three.js over BodyParts3D will implement the same contract, and
nothing above the adapter changes. The decision to defer 3D is therefore reversible at the
cost of one file.

## Current status

**Development build. Not for real users.** All 8 red-flag rules are unreviewed, and the
server says so on startup. See `docs/research/safety-regulatory.md` — including the
known gaps, the most serious of which is that non-musculoskeletal complaints are not yet
routed away.

## Documentation

| | |
|---|---|
| [`docs/01-architecture.md`](docs/01-architecture.md) | Layers, request flow, where failures are caught |
| [`docs/02-data-model.md`](docs/02-data-model.md) | Provenance, authority ranking, tables, SymptomRecord |
| [`docs/03-tech-stack.md`](docs/03-tech-stack.md) | What is in place, what is not, and what to use next |
| [`docs/04-roadmap.md`](docs/04-roadmap.md) | Phases, what is blocking, standing backlog |
| [`docs/research/anatomy-assets.md`](docs/research/anatomy-assets.md) | 3D model sources, licensing, the conversion pipeline |
| [`docs/research/products-to-reuse.md`](docs/research/products-to-reuse.md) | BioDigital, BodyParts3D, Infermedica, NHS 111, Kenhub, FHIR, Obsidian |
| [`docs/research/safety-regulatory.md`](docs/research/safety-regulatory.md) | Rules, review status, honest gaps, regulatory horizon |
| [`docs/adr/`](docs/adr/) | Why local-first, why local IDs, why the clinical layer is separate |

Source product plan lives in the Obsidian vault at
`E:\1obsidian\Obsidian Vault\project\Anatomical_Symptom_Interface_Product_Plan_B_Format.md`.

## Licence

MIT for the code. Anatomy assets, if adopted, carry their own licences — see
`docs/research/anatomy-assets.md`.
