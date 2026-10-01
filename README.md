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

  3D anatomy viewer  →  real GLB geometry, descendant meshes resolved to
                        canonical asiIds, structure picking, 2D map as the
                        floor for every failure path
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
pnpm test         # 455 unit tests across three packages
node scripts/smoke.mjs   # 38 API checks (server must be running)

# every gate, in one reproducible run: unit, build, smoke, safety metadata,
# release gate, migrations, place identity, reopen, adapter, URL GLB, then the
# browser / a11y / hit-zone / 3D / fallback / evidence gates. It starts and seeds
# its own servers, and reports PASS / FAIL / SKIP per gate.
bash scripts/final-gates.sh