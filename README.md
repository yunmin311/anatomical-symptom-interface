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
    personal health map  →  every episode, indexed by body region
                                a PLACE is region + side + sub-region + cell,
                                decided on the server and never re-derived
                                in the browser

  3D anatomy viewer  - real GLB geometry from BodyParts3D 4.0 (CC BY 4.0),
                        descendant meshes resolved to canonical asiIds,
                        structure picking, 2D map as the floor for every
                        failure path
                        FOUR regions: shoulder, neck, lower back, knee
                        real MIDLINE builds for neck and lower back; the source
                        has none for shoulder or knee, and the product says so
                        instead of showing a side
  answer correction  - re-answering a question REPLACES it, marked
                        user_edited; derived fields are recomputed from the
                        whole answer set, so a correction actually withdraws
                        what the original recorded
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
pnpm test         # unit tests across all four packages
node scripts/smoke.mjs   # 38 API checks (server must be running)

# every gate, in one reproducible run: typecheck, unit, build, smoke, safety
# metadata, release gate, migrations, place identity, reopen, anatomy adapter,
# real geometry (per region AND all regions), laterality, the full V1 user flow
# at 3 widths, the degraded paths, accessibility, MCP, and the evidence gate.
# It starts and seeds its own servers, reports PASS / FAIL / SKIP per gate, and
# exits non-zero if any gate failed OR any gate was skipped.
bash scripts/final-gates.sh
```

---

## What this does not do

Read `docs/known-limitations.md`. The short version:

- **The safety rules are not clinically reviewed.** `releaseReady` is false and the release
  profile refuses to start. This is an external dependency, not an engineering task.
- **The 2D map is a placeholder.** Hand-made schematic geometry, marked as such everywhere.
  Real 2D medical artwork has to come from a licensed external source.
- **Only the current answer is kept.** Correcting an answer replaces it and marks it
  `user_edited`; there is no history of what was first said.
- **FMA bindings are unverified.** Every one is a claim read from the source's concept list,
  never checked against FMA Explorer by a human.
- **Some anatomy does not exist in the source dataset.** BodyParts3D has no knee ligaments,
  no menisci and no bursae. Those concepts are reported unavailable, never substituted.

## More

- `docs/api-v1.md` — the HTTP contract, and what a second client must not bypass
- `docs/mcp.md` — the MCP surface, and why it is a client of the domain
- `docs/known-limitations.md` — everything above, in detail, with the reasoning
- `docs/04-roadmap.md` — phase status, and what is genuinely still open
