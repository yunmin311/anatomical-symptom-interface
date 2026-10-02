# AGENTS.md — working agreements for this repo

Single source of truth for how to work here. Read this before changing anything.

## What this project is

Anatomical Symptom Interface. Local-first tool that turns "it hurts here" into a
structured, anatomical, longitudinal health record. **It does not diagnose.**

Source product plan: `E:\1obsidian\Obsidian Vault\project\Anatomical_Symptom_Interface_Product_Plan_B_Format.md`

## Non-negotiables

These are architecture, not style. Do not weaken them to make a task easier.

1. **The model may propose. Nothing else.**
   Model output is `ai_inference` with a mandatory confidence, and it can only become
   part of the record by the user acting on it. There is no write path from the model
   to the store, and any field marked `requiresUserSource` in the field registry
   rejects an `ai_inference` write outright.

2. **One write path, and it is atomic.**
   Everything goes through `applyMutations`. It validates the value against the field
   registry, validates provenance, merges by claim class, writes the field row
   (value + provenance together), preserves losers, rebuilds the record projection and
   re-evaluates safety — in one transaction. A validation failure throws and rolls the
   whole batch back. Never add a second write path, and never reintroduce an endpoint
   that accepts a whole client-supplied record.

3. **Safety messaging is a rule engine, never generation.**
   `packages/shared/src/rules/redflags.ts` holds pure predicates over **typed signals**
   (`SafetySignals`), not over text. No rule may contain a regex over user input. A rule
   says "get this assessed", never "you have X".

4. **Yes, no, unknown and not-asked are four different things.**
   `normaliseYesNo` must never return `no` for an unrecognised answer. `record.gaps`
   means MISSING INFORMATION ONLY and must never hold an answer marker — a test
   asserts every gap is a registry field path.

5. **The pre-visit summary never calls a model**, and never states a negative it does
   not have. Render against the coverage map; an unasked field is "not asked".

6. **There is no default region.** Localisation returns grounded or
   `unsupported`. A chest complaint must exit, not enter a musculoskeletal interview.

7. **A visual selection is not a finding.** Use "pointed at", "indicated",
   "visual selection". Never "confirmed". The word must not appear in a summary.
   Deselecting a structure clears the user's selection and **keeps the candidate**:
   the suggestion is evidence of what was considered, and deleting it is lossy.
   `location.userSelectedStructureIds` is the ONLY source of truth for user
   selection; `consideredStructures[].selectedByUser` is a derived projection of
   it. Never write that flag by hand — change the id set and let
   `projectUserSelection` recompute it. Two writable copies of one fact
   produced records where a candidate read as both selected and unselected, and
   the summary then listed it under both headings. The id set is also stored
   **ordered-unique, first occurrence wins** — never sort it, the order is the
   order the user pointed. A repeat is a reporting bug: the summary would tell a
   clinician the user pointed at the same structure twice.

8. **Safety signals are region-scoped.** `signalsFromAnswers(answers, region)` combines
   only the questions that region's interview actually asks, so a stale answer from
   another episode cannot fire a rule here. A signal may have several drivers; do not
   reintroduce a single-question lookup.

9. **Carry provenance you were given.** The localisation response names which
   orchestrator read the text; that value must reach the UI and the stored episode.
   Do not infer it from the outcome status — a grounded result can come from either.

10. **Coding stays `unverified` until a human checks it**, and the
   `unreviewedSafetyRules` count must stay honest. Do not flip either to make
   something look finished.

11. **No disease vocabulary in the core product.** If you want to add a condition name
    to a type, that is the signal to stop — it belongs in the future Medical Layer.

## Model and provider boundary

**The product is provider-agnostic. Do not design it as a Claude integration.**

- **Business logic depends only on the `Orchestrator` / analysis-provider
  interface** — today `{ kind: 'deterministic' | 'model', localise(...) }`. Never on a
  vendor client, a vendor SDK, or a vendor URL.
- **No vendor naming in the layers above.** `callClaude()`, `claudeAnalysis`,
  `/api/claude/*` and similar are all wrong even when they happen to work, because
  they make the next provider a rename rather than an implementation.
- **The public API names ASI's capability**, not the model behind it: localise a
  symptom, analyse a description, generate a structured candidate. That is already
  true — `/api/localise`, `/api/episodes/:id/summary`, `/api/ground` — so keep it
  that way.
- **A provider may be swapped without touching anything above the seam**: Anthropic,
  OpenAI, DeepSeek, any OpenAI-compatible or Anthropic-compatible endpoint, or a
  local model.
- **Structured validation, provenance, safety and domain semantics stay ours.** A
  provider returns a proposal; the schemas, the claim classes and the rule engine
  decide what is allowed into the record. Never delegate that to a prompt.

**Live model calls are optional and never a gate.** CI and `pnpm test` run
deterministic, fake or fixture providers only. A test that needs a real provider
must be opt-in and skipped by default, and must not be a hard dependency for anyone
else's checkout.

**Keys come from the local environment or an uncommitted secret file only.** Never
into the repo, a test snapshot, a fixture, or a log. `.env.example` documents names
and stays empty.

**Do not refactor for this proactively.** Apply the boundary the next time the
model or API interface is genuinely touched. The current Anthropic pinning is
recorded below and is a known, accepted state — not a reason to go and rewrite it on
a quiet afternoon.

## Known provider coupling (accepted for now)

These are Anthropic-specific today. They are the list to work through *when the
model interface is next touched*, not a task in its own right.

- `packages/server/src/orchestrator/index.ts` — the model call hardcodes
  `https://api.anthropic.com/v1/messages` and an `anthropic-version` header. This
  is the real lock-in: an Anthropic-compatible endpoint cannot be used without
  editing this line, which matters because this machine already talks to DeepSeek
  through exactly that shape.
- `packages/server/src/env.ts` — `ANTHROPIC_API_KEY` and an `ASI_MODEL` default of
  `claude-sonnet-5`. `hasModel()` keys off the vendor-specific variable name.
- `docs/03-tech-stack.md`, `docs/01-architecture.md`, `README.md` — name Anthropic
  Claude as the implementation.

The `Orchestrator` interface, the business-named routes and the domain's
`'deterministic' | 'model'` identity are already provider-neutral. The seam is in
the right place; only the implementation behind it is pinned.

## Layout

```text
packages/shared/src/
  provenance.ts     source types, evidence status, claim classes, merge  ← read first
  field-policy.ts   the ONLY place a field may be named; value + provenance strategy
  answers.ts        four-state QuestionAnswer / AnswerMap
  safety-signals.ts typed signals derived from answers
  anatomy.ts        region/sub-region/structure ontology
  symptom.ts        SymptomRecord, Episode
  grounding.ts      offline NL → region, or an explicit refusal
  interview/engine.ts questions AND their applyTo mapping, colocated
  rules/redflags.ts rule engine, release profile
  summary.ts        pre-visit summary builder

packages/server/src/
  orchestrator/     Orchestrator interface + deterministic and model impls
  db/               node:sqlite client, store (only writer), seed
  app.ts            HTTP routes — validate, delegate, serialise
  env.ts            release gate; refuses to start in release while unreviewed

apps/web/src/
  anatomy/types.ts  AnatomyAdapter contract  ← the 3D seam
  anatomy/svg2d.ts  schematic 2D implementation
  state/logic.ts    PURE session logic — all of it tested
  state/session.ts  thin shell: fetch, store, viewer commands
```

## Conventions

- TypeScript strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess` on.
- Type-only imports use `import type`. Relative imports carry the `.ts` extension.
- **No TypeScript parameter properties** (`constructor(readonly x: T)`). This project
  runs under node's strip-only type stripping, which cannot compile them. Declare
  fields explicitly.
- No `any`. No non-null assertions without a comment saying why it is safe.
- No comments explaining *what* code does. Comment *why* a non-obvious decision was made
  and what it would break.
- Questions are data. Add a region or change a question — and its `applyTo` mapping —
  without touching the orchestrator.
- New safety rule: pure predicate over a declared signal, `signalsUsed` filled in,
  review metadata, and a test.
- New persisted field: a `FieldPolicy` entry with a claim class, strategy, validator,
  allowed sources and a note. A field with no provenance belongs in
  `DERIVED_FIELD_PATHS` with a reason.

## Git and PR workflow

**The default is no PR.** A PR is something you ask for explicitly. If a prompt
does not say "create a PR", do not create one — not even to make the process look
complete. The failure mode this replaces is one PR per two-line fix, which makes
the real changes invisible in review.

**No PR — work on the current task branch, commit, push, report:**

- Bug fixes, including follow-ups to the same problem.
- Test additions and doc/count sync.
- Anything whose whole diff is a small number of files in one area.

Keep the commits on that one branch logically separate. A bug fix, its
regression tests and its doc sync are three commits on one branch, not three
branches and three PRs.

**A PR is warranted when:**

- A milestone or a coherent group of changes is finished.
- Work from several agents has to be integrated into `main` together.
- The change touches a write path, a persisted field, a safety rule or safety
  message, provenance semantics, the DB schema, or the architecture — anything
  that deserves review on its own.

**Aim for one integration PR per phase.** Main agent holds integration until a
group of work is done, then: review → integration branch → full validation → one
PR → merge. Do not open a PR mid-phase and then add more to it.

**Design agents do not open PRs.** A design agent's job ends at
branch → implementation → tests → commits → push → handoff. Main agent does the
final integration, and only after the group is finished.

### Git commit attribution

**Never add an AI/model/vendor co-author trailer automatically.** This applies to
every agent, human or otherwise, on every branch, forever.

Do not add:

- `Co-Authored-By: Claude ...`
- `Co-Authored-By: ChatGPT ...`
- `Co-Authored-By: Codex ...`
- `Co-Authored-By: OpenAI ...`
- or any other AI/model/tool attribution

…unless the user explicitly asks for it in that commit.

Why this is a rule and not a preference: some tools insert a trailer silently. The
user did not use those models for this project, and an automatic trailer puts a vendor
account into the contributor graph and into every `git shortlog` output as though a
person had done the work. That is a claim about authorship, and it should never be
made by a tool on the user's behalf.

Two obligations that follow:

- **Commits use the repository's configured human Git author only.** Do not pass
  `--author`, and do not set `GIT_AUTHOR_*` to anything but the configured user.
- **Before every commit, read the final message and remove any automatically
  injected AI co-author trailer.** Read `git diff --cached` and the message text, not
  the intent you had when you wrote it — the injection happens after writing.

Already-merged history keeps whatever trailers it has. Do not rewrite published
history solely to strip old trailers: that rewrites hashes for everyone and the
trailers are inert. The rule governs forward from the commit that records it.

**Branches.** Do not create a throwaway branch per small fix; stay on the current
task branch. Sweep merged branches at the end of a phase, not after every task:
confirm with `git branch --merged main` and check the remote is contained in
`main` before deleting. `main` should be the only branch left between phases.

## Commands

```bash
pnpm install
pnpm dev                      # server :8787 + web :5173
pnpm typecheck                # all packages — must pass before commit
pnpm test                     # unit tests across all three packages
pnpm seed                     # reset to demo history (DESTRUCTIVE, rebuilds the DB)
node scripts/smoke.mjs        # 38 API checks, needs a running server
node scripts/check-safety-metadata.mjs <health.json>
pnpm --filter @asi/web build
```

`allowBuilds: esbuild: true` is declared in `pnpm-workspace.yaml`, so install never
prompts. If pnpm ever asks you to approve a build script, do not run
`pnpm approve-builds` interactively — add the package to `allowBuilds` and commit it,
so a clean checkout and CI behave the same way.

## Before you call something done

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] New logic has a test, especially anything touching provenance, safety, answers
      or the field registry
- [ ] `scripts/smoke.mjs` still 38/38 if you touched the server
- [ ] `scripts/check-safety-metadata.mjs` passes against a running server
- [ ] The unreviewed-rules count is still reported honestly — if it went to zero
      without clinical review, something bypassed the review metadata, which is a bug
- [ ] No vendor naming crept in above the provider seam (`callClaude`, `/api/claude/*`,
      a vendor SDK in business logic), and any new model test is opt-in rather than a
      gate on someone else's checkout

## Health data

`data/` and `*.sqlite` are gitignored. Never commit a real patient or personal record.
Seed data is fictional. Do not put anything from a real person in a test fixture.
