# Tech stack — what is in place, and what to use next

## In place now

| Layer | Choice | Version | Why this and not the obvious alternative |
|---|---|---|---|
| Runtime | Node | ≥22 (tested 24) | `node:sqlite` built in, native type stripping, one runtime for server + tooling. |
| Language | TypeScript | 5.9 | `verbatimModuleSyntax` + `noUncheckedIndexedAccess` catch provenance/lookup bugs at compile time. |
| Monorepo | pnpm workspaces | 12.x | Fast, strict by default, no hoisting surprises. |
| Domain core | `@asi/shared` | — | Pure, no I/O. Runs in the browser, the server and `node --test` identically. |
| Validation | Zod | 3.24 | Schemas double as the runtime contract for the record and every API boundary. |
| API | Hono + `@hono/node-server` | 4.6 | Small, Web-standard, runs on any runtime later (Deno/Bun/edge) without a rewrite. |
| Database | `node:sqlite` | built-in | No native build, no version drift. Plain portable SQLite file. |
| UI | React | 19 | Largest ecosystem; nothing here is exotic. |
| Build | Vite | 6 | Instant HMR, proxy to the API in dev, one alias for workspace source. |
| State | Zustand | 5 | One store, no provider tree, no boilerplate for a session this shape. |
| Tests | `node:test` | built-in | No runner dependency. 28 unit tests + 17 API smoke tests. |
| Model | Anthropic Claude via `fetch` | — | Tool-use to force schema-shaped output. Optional: product works without it. |

## Deliberately NOT used yet

| Not used | Why |
|---|---|
| ORM (Drizzle/Prisma) | The schema is still moving. Raw SQL keeps the provenance design legible. Revisit when the schema stabilises. |
| Three.js / R3F | The 2D SVG map validates the core hypothesis with zero asset cost. The `AnatomyAdapter` interface means adding 3D touches one file. |
| Tailwind | A 500-line hand-written stylesheet is smaller than the build toolchain, and this UI is a form plus a map, not a component zoo. Revisit if the surface grows. |
| Any diagnosis API | Would violate the product boundary in §8 of the plan. |
| Auth / multi-user | V1 is one person, local, by design. |

---

# The parts that are not decided yet

## 1. Anatomy model source — the biggest open question

**Need:** labelled, layered, licence-clean 3D anatomy with a stable structure ID system.
**Candidates:** see `docs/research/anatomy-assets.md` for the full comparison.
**Recommendation for V1:** stay with the 2D SVG map; take BodyParts3D (CC-BY-SA) as GLB
for Phase 1; keep BioDigital as a UX/API reference, not a dependency.
**Adapter seam:** `apps/web/src/anatomy/types.ts` — implement `Three3dAnatomyAdapter`,
nothing above it changes.

**Pipeline when you do adopt a model:**
```bash
# 1. Fetch (BodyParts3D is ~1.5k structures, CC BY 4.0 International)
# 2. Blender headless: merge per-layer meshes, drop to GLB, re-map node names
#    to our asi:* ids via a generated mapping table
blender -b -P scripts/build_anatomy.py
# 3. Decimate aggressively — target < 8MB for the 4 V1 regions
gltf-transform optimize dist/anatomy.glb
# 4. Emit a manifest: { asiId, meshName, layer, subRegionId, bounds }
```

The manifest is the important artefact. It is what lets the 3D viewer, the SVG map and
the interview engine all talk about the same structure IDs.

## 2. Model choice for the orchestrator

**Recommendation:** Claude with tool-use, as implemented. Non-negotiables if you swap:

- **Forced structured output.** Tool-use or strict JSON schema. Free prose must be
  parsed out of it, and that is where medical hallucinations enter.
- **A candidate-only contract.** The tool schema has no field for a diagnosis. Absence of
  a field is stronger than a prompt instruction.
- **Structure IDs constrained to a supplied list.** Pass the valid `asi:*` ids in the
  system prompt and filter the response against them server-side. Never trust the id.
- **No medical knowledge authority.** The model interprets language; it is not the source
  of anatomical or clinical facts. That is the Medical Knowledge Layer's job.

**Local model option (worth building):** the deterministic grounder already covers
region/side/depth in EN + ZH offline. A small local model (Qwen, via Ollama or
llama.cpp) could extend the alias lexicon to any language. For a privacy-first health
product, a genuinely offline path is a real differentiator, not a fallback.

## 3. Terminology binding

`coding.status` is `unverified` for every structure. Binding properly means:

- **SNOMED CT** for clinical concepts. The International Release is free in most
  jurisdictions; the US release is licensed from NLM.
- **FMA** for anatomy. BodyParts3D is derived from FMA, so the mapping largely exists —
  it needs extracting, not inventing.
- **ICD-10 / ICD-11** only for billing-adjacent output, and never as input.

Budget a week of careful verification per region. It is tedious, it is unglamorous, and
it is the difference between a demo and something interoperable.

## 4. Clinical review of the rule set

All 8 red-flag rules currently report `status: 'unreviewed'` and the server warns at
startup. Getting to `clinically_reviewed` means a qualified person signs each rule
against a named guideline. Until then this is a development build. `unreviewedRuleCount()`
is the gate.

## 5. Speech input

Not started, and a natural fit — describing pain out loud is how people actually talk.
`faster-whisper` locally, or a cloud STT behind an explicit opt-in with a stated privacy
cost. Transcripts must land in `transcripts` with a stable turn id so provenance can
point back at what was actually said.

---

# Reusable products and prior art

Full analysis in `docs/research/products-to-reuse.md`. The short version:

| Category | Use it for | Do NOT use it for |
|---|---|---|
| **BioDigital Human** | Copying the viewer API *contract* — camera, visibility, selection, highlight. It is the reference design for the Anatomical Model Layer. | Depending on it long-term. Hosted, proprietary, pricing unknown, and we would be building our whole product on someone else's roadmap. |
| **BodyParts3D / DBCLS** | The actual 3D asset source. CC-BY-SA, FMA-derived, ~1,500 named structures, region hierarchy included. | Shipping as-is — it is a research dataset with Blender-scale geometry. Needs a conversion pipeline. |
| **Z-Anatomy** | Alternative asset source, nicer topology, made in Blender. | Assuming the licence is as clear — verify before committing. |
| **Infermedica** | The reference for symptom-checker interview design and their body-avatar writing is genuinely good product thinking. | As a diagnosis backend. The plan says don't bind the product to one. |
| **Ada Health / Buoy / Symptoma** | UX benchmark: how few questions, how the confidence display works, how they avoid alarming copy. | Anything else. |
| **KHealth / Hinge Health / Physitrack** | MSK-first verticals — closest to the V1 scope, worth reading their triage copy. | — |
| **Ken Hub / Visible Body / Z-Anatomy** | Anatomy-education UX, especially "lay term ↔ anatomical term" pairing. | — |
| **FHIR R4** | The target format for Phase 2 clinical assertions. Designing `clinical_assertions` to map onto it now avoids a rewrite. | Phase 1. Nothing else needs it. |
| **Obsidian** | Export episodes as Markdown into your vault. The records are already structured; this is a 50-line exporter and it fits how you actually work. | — |

---

# Testing strategy

| Layer | Tool | Count | What it protects |
|---|---|---|---|
| Domain | `node:test` | 28 | Provenance invariants, grounding, red flags, summary output |
| API | `node:test` + `scripts/smoke.mjs` | 17 | End-to-end episode → confirm → summary → health map |

Tests that exist specifically because the failure is dangerous:

- `ai_inference can never be marked user_confirmed`
- `a rule match never asserts a diagnosis at the user` — banned-phrasing list
- `every red-flag rule is honestly marked unreviewed` — release gate
- `the cauda equina question is mandatory` — a safety gate cannot be made optional
- `structure terminology is not fabricated as verified codes`
- `nothing is grounded for a vague complaint` — refuses to guess

**Not yet tested, and should be:** the browser UI (needs Playwright), the interview
answer → record mapping in `session.ts` (currently untested logic, and it is the part
most likely to rot), and rule accuracy against real clinical vignettes.

# Commands

```bash
pnpm install
pnpm dev              # server :8787 + web :5173
pnpm typecheck        # all packages
pnpm test             # domain unit tests
pnpm seed             # reset to a 3-episode demo history
node scripts/smoke.mjs   # 17 API checks against a running server
```
