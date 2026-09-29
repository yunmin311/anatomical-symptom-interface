# AGENTS.md — working agreements for this repo

Single source of truth for how to work here. Read this before changing anything.

## What this project is

Anatomical Symptom Interface. Local-first tool that turns "it hurts here" into a
structured, anatomical, longitudinal health record. **It does not diagnose.**

Source product plan: `E:\1obsidian\Obsidian Vault\project\Anatomical_Symptom_Interface_Product_Plan_B_Format.md`

## Non-negotiables

These are architecture, not style. Do not weaken them to make a task easier.

1. **The model may propose. Nothing else.**
   Model output is `ai_inference` with a mandatory confidence, and it can only become a
   fact by the user clicking it. There is no write path from the model to the store.

2. **Safety messaging is a rule engine, never generation.**
   `packages/shared/src/rules/redflags.ts` holds pure predicates. A rule says "get this
   assessed", never "you have X". A test enforces the wording.

3. **The pre-visit summary never calls a model.**
   It is deterministic text. The thing a doctor reads is not model-generated.

4. **Provenance is checked on every write.**
   `assertProvenance` is called from `putProvenance`, the single write path. If you add
   a write path, call it too.

5. **No disease vocabulary in the core product.**
   If you find yourself wanting to add a condition name to a type, that is the signal to
   stop — it belongs in the future Medical Layer.

6. **Coding stays `unverified` until a human checks it.**
   `coding.status` in `anatomy.ts` is `unverified` for every structure, and a test
   asserts the published regions contain zero verified codes. Do not flip it to make
   something look finished.

## Layout

```text
packages/shared/src/
  provenance.ts     source types, authority ranking, invariants  ← read first
  anatomy.ts        region/sub-region/structure ontology
  symptom.ts        SymptomRecord, Episode
  grounding.ts      deterministic NL → region/side/depth/candidates
  interview/        region-specific question registry
  rules/redflags.ts rule engine
  summary.ts        pre-visit summary builder

packages/server/src/
  orchestrator/     Orchestrator interface + deterministic and model impls
  db/               node:sqlite client, store (only writer), seed
  app.ts            HTTP routes — validate, delegate, serialise
  env.ts            fail fast on unsafe, degrade gracefully on optional

apps/web/src/
  anatomy/types.ts  AnatomyAdapter contract  ← the 3D seam
  anatomy/svg2d.ts  schematic 2D implementation
  state/session.ts  session state   ← largest untested surface, be careful here
```

## Conventions

- TypeScript strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess` on.
- Type-only imports use `import type`. Relative imports carry the `.ts` extension.
- No `any`. No non-null assertions without a comment saying why it is safe.
- No comments explaining *what* code does. Comment *why* a non-obvious decision was made
  and what it would break.
- Questions are data, not code. Add a region or change a question in `interview/engine.ts`
  without touching the orchestrator.
- New safety rule: pure predicate, review metadata, and a test.

## Commands

```bash
pnpm install
pnpm dev                      # server :8787 + web :5173
pnpm typecheck                # all packages — must pass before commit
pnpm test                     # domain unit tests
pnpm seed                     # reset to demo history (DESTRUCTIVE)
node scripts/smoke.mjs        # 17 API checks, needs a running server
pnpm --filter @asi/web build
```

`allowBuilds: esbuild: true` is declared in `pnpm-workspace.yaml`, so install never
prompts. If pnpm ever asks you to approve a build script, do not run
`pnpm approve-builds` interactively — add the package to `allowBuilds` and commit it,
so a clean checkout and CI behave the same way.

## Before you call something done

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] New logic has a test, especially anything touching provenance or safety
- [ ] `scripts/smoke.mjs` still 17/17 if you touched the server
- [ ] The unreviewed-rules startup warning still appears — if it stopped, something
      bypassed the review metadata, which is a bug

## Health data

`data/` and `*.sqlite` are gitignored. Never commit a real patient or personal record.
Seed data is fictional. Do not put anything from a real person in a test fixture.
