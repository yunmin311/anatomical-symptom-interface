# Roadmap

Status of each phase, and what is honestly blocking the next one.

---

## Phase 0 — Interaction prototype · **built, correctness-hardened**

**Goal:** can a user, in 2–3 minutes, turn "right shoulder inside hurts" into a
located, structured, saveable record?

**Built:**
- Natural-language grounding with an explicit refusal path, offline, EN + ZH
- Schematic 2D anatomy map with sub-region hit targets and droppable pin
- Structure candidates proposed from the user's words, selectable but never auto-selected
- Region-specific dynamic interview (shoulder 8, neck 6, lower back 7, knee 6)
- Four-state answer model; yes / no / unknown / not-asked stay distinct everywhere
- Typed safety signals; no rule reads user text
- Structured SymptomRecord with per-field provenance in the same row as the value
- A single atomic write path; the value/provenance divergence hole is closed
- Claim-class merge, so a device or lab result cannot overwrite a subjective symptom
- Deterministic pre-visit summary with coverage-aware missingness
- Personal health map keyed by body region
- Rule-based red flags, all honestly marked unreviewed, with a release gate
- 225 unit tests, 38 API smoke checks, CI with a strict safety-metadata gate

**The milestone test from the plan (§12):** partially demonstrated. A user can go from
free text to a located record to a doctor-readable summary. **Not yet demonstrated:**
that it is *better than typing*, and that a clinician finds the summary useful. Those
need real humans.

**Blocking:**
1. **No usability testing.** Everything above is an engineering claim, not a product
   claim. Put five people in front of it and measure the plan's success criteria (§5).
2. **The schematic SVG body is rough.** It is a hit-target system, not a body. Usable,
   but it is the first thing a user will judge the product on.
3. **The router is a body-part matcher, not an assessment.** It sends a chest complaint
   to a clinician, correctly, but it cannot tell a chest complaint from a pulled muscle.
   Do not let it grow into a triage engine — see the gaps list.
4. **Clinical review of the 10 rules**, starting with the 7 urgent/emergency ones.
   Until then `releaseReady` is false and the release profile will not start.
5. **Accessibility review** of the safety banner, which is the one piece of UI that
   must never be missed.

---

## Phase 1 — Musculoskeletal V1

**Goal:** four regions working properly, with 3D.

### Phase 1A — Core foundation · **built**

The part that has to be true before any of the rest is worth doing: the record
store has to behave like something a person can rely on having tomorrow.

- [x] **Schema migrations** replacing the rebuild-on-version-change policy.
      Ordered, one transaction per step, applied on top of existing data. A file
      that cannot be recognised is refused at startup, never deleted. Applied
      migrations are checksummed. 20 tests.
- [x] **Restart persistence proven against the real service.** A test boots the
      server, writes through HTTP, `SIGKILL`s it, boots it again on the same file
      and reads everything back. Deliberately not seed-based: a seed-based
      persistence test passes even when persistence is broken.
- [x] **Anatomy asset manifest** as a real validated contract: `asiId`,
      provenance, licence, attribution, FMA status, bounds and geometry budget,
      with runtime validation. Strict schema, so a generated file cannot quietly
      carry a clinical claim.
- [x] **BodyParts3D conversion pipeline** running end to end for a **shoulder
      vertical slice**: select, bind to `asiId`, reduce geometry, emit GLB, emit
      manifest, enforce the budget. Byte-reproducible. *Blocked on one external
      file* — see `assets/anatomy/README.md` for exactly which.
- [x] **Spatial history read model.** Every place with its normalised point and
      the episodes behind it, so the client never scans episodes to draw a body.
      A location history, deliberately not a risk map.
- [x] **Episode reopen read model**, so a resuming session gets the next question
      and the outstanding set from the server rather than re-deriving them.

**Bugs this work exposed and fixed.** `body_regions.point_x` / `point_y` and
`sub_region_id` had been permanently NULL — `createEpisode` called `ensureRegion`
with nulls before the mutations ran and nothing called it again, so a pin dropped
on the body map never reached the table that exists to hold it. The Phase-0
"heatmap" was a column and a comment. Now synced from the record inside the one
transaction that writes it.

### Phase 1B — still open

- [ ] **Usability validation.** Does visual localisation beat typing? Measure it.
- [ ] **The other three regions through the asset pipeline.** `neck`,
      `lower_back` and `knee` have no source mapping yet; the build reports that
      rather than guessing.
- [ ] **Render the generated assets.** The pipeline produces GLB; nothing consumes
      them yet. The `AnatomyAdapter` contract already exists.
- [ ] **Depth interaction.** The weakest part of the current UX. Users should be able to
      say "not the skin, not the muscle, deeper" and have the model respond. This is
      plan question §12.3 and it is unsolved.
- [ ] **Write `layTerm` for every V1 structure.** Kenhub standard. Unglamorous,
      non-negotiable.
- [ ] **Terminology binding.** SNOMED CT + FMA, verified, one region at a time.
      Every generated FMA binding is `unverified` until a human checks it.
- [ ] **Clinical review of the red-flag rules.** Named reviewer, named source, both
      false-positive and false-negative reasoning written down.
- [ ] **Translate the red-flag copy**, and the router's region lexicon. A non-English
      safety message is arguably worse than none.
- [ ] **Voice input.** People describe pain out loud. `faster-whisper` locally.
- [ ] **Playwright tests** for the rendered UI (the logic layer is tested; the DOM is not).
- [ ] **Wire the health map to the spatial read model.** The read model exists and is
      tested; `apps/web` still renders the older count-only shape.

---

## Phase 2 — Personal health memory

**Goal:** one body region has a continuous history.

- [ ] `clinical_assertions` write path — diagnosis, test, treatment, outcome
- [ ] FHIR R4 mapping for those assertions (schema is already shaped for it)
- [ ] Document import: lab results, imaging reports, discharge summaries
- [ ] Wearable connectors: HealthKit / Health Connect, all as `device_import`
- [ ] Timeline view per body region, not just a list
- [ ] **Heatmap.** The `point_x/point_y` columns already exist for exactly this. The
      Personal Anatomical Health Map stops being a list and becomes a picture of
      where this person's body keeps breaking.
- [ ] Outcome tracking — did the intervention work? Closes the loop that makes a
      health *map* rather than a symptom *log*.
- [ ] Encryption at rest beyond OS-level disk encryption.

---

## Phase 3 — Validated clinical layer

**Goal:** only after Phase 1–2 prove the core product.

- [ ] Clinical validation study
- [ ] Safety monitoring process
- [ ] Regulatory path and classification analysis
- [ ] Only then: integration with a validated triage / decision-support provider,
      behind its own interface, never inside the core product

This is a separate workstream with its own team and its own standards. It is not a
feature toggle. See `adr/0003`.

---

## Phase 4 — General anatomical interface

Nervous system, viscera, skin, cardiovascular. Mobile, voice, AR, clinician mode.
None of this is blocked on anything except the phases above being genuinely good.

---

## Standing backlog

These are known and not yet scheduled:

- **i18n of safety copy.** Currently EN only. A red flag in the wrong language is worse
  than no red flag.
- **Accessibility audit.** The safety banner must work without colour and with a screen
  reader. Not yet verified.
- **Local-model path.** A genuinely offline orchestrator is a real differentiator for a
  privacy-first health product, not just a fallback.
- **MCP server.** Expose the record store to a desktop assistant.
- **Import from the vault.** Read past notes and extract episodes. Powerful and
  privacy-sensitive; needs its own consent flow.
