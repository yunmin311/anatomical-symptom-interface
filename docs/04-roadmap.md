# Roadmap

Status of each phase, and what is honestly blocking the next one.

---

## Phase 0 — Interaction prototype · **substantially built**

**Goal:** can a user, in 2–3 minutes, turn "right shoulder inside hurts" into a
located, structured, saveable record?

**Built:**
- Natural-language grounding, offline, EN + ZH (region / side / depth / sub-region)
- Schematic 2D anatomy map with sub-region hit targets and droppable pin
- Structure candidates proposed from the user's words, confirmable but never auto-confirmed
- Region-specific dynamic interview (shoulder 8, neck 6, lower back 7, knee 6 questions)
- Structured SymptomRecord with per-field provenance
- Deterministic pre-visit summary, JSON and plain text
- Personal health map keyed by body region
- Rule-based red flags, all honestly marked unreviewed
- 28 unit tests, 17 API smoke tests

**The milestone test from the plan (§12):** partially demonstrated. A user can go from
free text to a located record to a doctor-readable summary. **Not yet demonstrated:**
that it is *better than typing*, and that a clinician finds the summary useful. Those
need real humans.

**Blocking:**
1. **No usability testing.** Everything above is an engineering claim, not a product
   claim. Put five people in front of it and measure the plan's success criteria (§5).
2. **The schematic SVG body is rough.** It is a hit-target system, not a body. Usable,
   but it is the first thing a user will judge the product on.
3. **`session.ts` interview mapping is untested.** Highest-risk untested code.
4. **No non-MSK routing.** A chest-pain user is a user this app does not serve, and
   currently does not turn away. See `research/safety-regulatory.md` gap 3.

---

## Phase 1 — Musculoskeletal V1

**Goal:** four regions working properly, with 3D.

- [ ] **Usability validation.** Does visual localisation beat typing? Measure it.
- [ ] **3D anatomy layer.** `Three3dAnatomyAdapter` over BodyParts3D, decimated, with a
      generated `asi:*` manifest. The `AnatomyAdapter` contract already exists.
- [ ] **Depth interaction.** The weakest part of the current UX. Users should be able to
      say "not the skin, not the muscle, deeper" and have the model respond. This is
      question §12.3 and it is unsolved.
- [ ] **Write `layTerm` for every V1 structure.** Kenhub standard. Unglamorous,
      non-negotiable.
- [ ] **Terminology binding.** SNOMED CT + FMA, verified, one region at a time.
- [ ] **Clinical review of the red-flag rules.** Named reviewer, named source, both
      false-positive and false-negative reasoning written down.
- [ ] **Non-MSK intake path.** Detect "this isn't a musculoskeletal problem" and route
      appropriately. Safety, not scope creep.
- [ ] **Obsidian exporter.** Half a day, and the cheapest retention strategy available.
- [ ] **Voice input.** People describe pain out loud. `faster-whisper` locally.
- [ ] **Playwright tests** for the UI and `session.ts`.

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
