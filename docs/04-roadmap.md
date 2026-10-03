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
- A reproducible gate runner via
  `scripts/final-gates.sh`, including a strict safety-metadata gate. It reports
  per-gate PASS / FAIL / SKIP and exits non-zero if anything failed **or** was skipped,
  so a filtered or tool-less run cannot be mistaken for a clean one. Read the counts from
  the run; they are deliberately not written down here.

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

**Reached.** Every region has audited, real, licensed 3D geometry on both sides, plus real
MIDLINE builds for the neck (seven cervical vertebrae) and the lower back (five lumbar
vertebrae plus the sacrum). The shoulder and knee have no midline geometry in the source and
the product says so rather than showing a side. The product flow, the spatial health map,
reopen, answer correction, the HTTP API and the MCP surface are implemented and gated at
three viewport widths.

**What is NOT reached, and is not an engineering task:**

1. **Clinical review of the safety rules.** `releaseReady` is false and the release profile
   refuses to start. This blocks a real release and nothing else.
2. **Usability testing.** Every claim above is an engineering claim, not a product claim.
3. **Professional 2D medical artwork.** The 2D map is hand-made schematic geometry, marked
   `placeholder = true` everywhere. Honest to render, wrong to ship as medical content. See
   `docs/known-limitations.md`.

### Phase 1A — Core foundation + anatomy workspace · **built, integrated**

Two branches were built in parallel and integrated on `phase1/integration`:

- `phase1/core-foundation` (9 commits) — the storage layer.
- `phase1/anatomy-workspace` (18 commits) — the renderer and workspace.

The integration was not a merge that happened to succeed. Four contracts had to be
reconciled, and in each case the two sides had agreed on different answers:

- [x] **Schema migrations** replacing the rebuild-on-version-change policy.
      Ordered, one transaction per step, applied on top of existing data. A file
      that cannot be recognised is refused at startup, never deleted. Applied
      migrations are checksummed, and a **legacy file with no migration table
      adopts by shape** — the schema is authoritative and `user_version` is only a
      claim. Recorded rows carry each migration's real name and checksum, so a
      legacy database can be opened twice without becoming unreadable.
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
- [x] **One asset authority.** The canonical `AssetManifest` in `@asi/shared` is
      the only production description of an asset. The renderer's own contract is
      named `RendererSceneManifest` and there is exactly one adapter
      (`apps/web/src/anatomy/asset-scene-adapter.ts`) between them, one-directional.
      Attribution is **derived** from `licence` and `source` and re-verified
      against them, so a hand-written notice cannot stand in for the manifest.
- [x] **The full render pipeline proven without the real asset.** canonical manifest
      → validate → adapter → scene → GLB URL → real `GLTFLoader` → three.js scene
      graph → descendant mesh → canonical `asiId` → structure selection, using
      clearly-labelled synthetic geometry. One mesh per GLB, which is what the Core
      pipeline actually emits.
- [x] **A multi-sub-region structure is not truncated to one.** A structure
      reachable from several sub-regions carries the whole canonical list, and the
      renderer reports candidates rather than picking one. Picking a mesh must
      never silently choose which part of the body the user meant.
- [x] **Timeout-then-late-resolve asset leak fixed.** A GLB that missed the mount
      deadline used to be deleted from the URL cache and then arrive unowned,
      holding GPU buffers for the life of the page. Ownership is now a set of loads
      that a retry cannot overwrite.
- [x] **Spatial history read model**, server-authoritative. A place is
      `(person, region, side, sub-region, quantised point cell)`; membership is
      derived from the episodes rather than counted. The transport contract lives
      in `@asi/shared` and **the browser no longer regroups it** — it maps places
      for display and may not merge, dedupe or recount them.
- [x] **Episode reopen wired up**, end to end through a restart:
      create → answer → save → `SIGKILL` → history → reopen → viewer restored →
      next question correct → continue → save → **the same episode id**.
- [x] **Reopenable gate runner.** `scripts/final-gates.sh` resolves its own repo
      root, starts and seeds its own servers, runs every named gate including
      `evidence`, and reports PASS / FAIL / SKIP per gate — exiting non-zero on a
      skip, so a gate that did not run never looks like one that passed.
- [x] **Renderer, fallbacks, picking and accessibility** at browser level, against
      real geometry, with the 2D map as the floor for every failure path.

**Bugs this work exposed and fixed.** `body_regions.point_x` / `point_y` and
`sub_region_id` had been permanently NULL — `createEpisode` called `ensureRegion`
with nulls before the mutations ran and nothing called it again, so a pin dropped
on the body map never reached the table that exists to hold it. Then place
identity turned out to have no usable key at all, which split one place into two
rows, or merged two places and overwrote a pin. And the client was re-deriving
places the server had already decided, so two places the server kept apart came
back as one mark. All three were semantic, not cosmetic, and all three are now
tested from both sides.

### Phase 1B — real anatomy in the viewer

**Goal:** the renderer shows a real body, and the four V1 regions all work.

Phase 1A is infrastructure. Nothing it built is anatomy yet — the viewer still
shows placeholder volumes, because the asset it needs has not been supplied. This
phase is that asset, and the semantics around it.

- [x] **1. The real BodyParts3D asset.** `isa_BP3D_4.0_obj_99.zip` obtained, verified by
      SHA-256, and run through the existing pipeline for all four regions. 82 production GLBs,
      committed as generated output; the multi-gigabyte archive stays out of the repo.
- [x] **2. Verify the source mappings against the actual archive.** Every `meshName` was
      checked against the archive before it was trusted, with `scripts/audit-region.mjs`
      making that reproducible. The audit changed the plan's central assumption: the `M`
      suffix is **not** a laterality convention — it holds for 1109 meshes and is violated by
      655, and in the neck `FJ1573` is LEFT with no suffix while `FJ1595` is RIGHT. Laterality
      is therefore read from the source concept, never from a filename. The audit also
      established that the archive contains **no knee ligaments and no bursae at all** —
      every one of BodyParts3D's 38 "ligament" concepts is an extraocular muscle — so those
      concepts are reported unavailable rather than substituted.
- [x] **3. Laterality.** Carried from the source concept through the manifest, the renderer
      entry and the pick, per side and per structure. Never inferred from a filename, an `M`
      suffix, an x coordinate or which half of the screen a mesh lands on — BodyParts3D's `M`
      suffix holds for 1109 meshes and is violated by 655. Asymmetry is reported per side:
      the neck suboccipital set is six concepts on the left and four on the right, and the
      right is reported absent rather than mirrored.
- [x] **4. Real shoulder anatomy in the viewer**, through the adapter that already existed.
- [x] **5. `neck` mapping.** 5 left / 4 right structures from 18 / 16 source meshes, plus a
      real MIDLINE build: the seven cervical vertebrae.
- [x] **6. `lower_back` mapping.** Lumbar spine (five vertebrae, composite) and sacrum
      midline; iliopsoas and gluteus maximus per side. Plus a real midline build.
- [x] **7. `knee` mapping.** Patella, popliteus, iliotibial tract, medial gastrocnemius
      head, popliteal artery. No midline geometry exists in the source, and the product says
      so rather than showing a side.
- [x] **8. Four regions with real anatomy.** Built from BodyParts3D 4.0 (CC BY 4.0), audited
      mesh by mesh against the archive before mapping. 95 production GLBs: 82 bilateral plus
13 dedicated midline.
- [x] **9. A real spatial health map.** The health map draws the body, marks every place
      from the server's read model, and opens a place by the server's `regionRowId` — the
      client never recomputes place identity, count or episode membership.
- [ ] **10. Episode reopen usability.** The flow works end to end, is exercised in a
      browser at three widths, and resumes the SAME episode rather than creating a second
      record. What is still unmeasured is whether people find it.
- [x] **11. Answer editing semantics.** Answering an already-answered question REPLACES it,
      marked `user_edited` by the store from the row rather than from anything the client
      claims. The answer-derived fields are RECOMPUTED from the whole answer set on every
      answer write, so a correction actually withdraws what the original recorded — and
      safety flags that no longer fire are withdrawn with a transcript entry. **What remains:
      answer HISTORY.** Only the current value is kept; see `docs/known-limitations.md`.
- [ ] **12. Usability testing.** Does visual localisation beat typing? Measure it.

Carried forward from Phase 1A and still genuinely open:

- [ ] **Depth interaction.** The weakest part of the current UX. Users should be
      able to say "not the skin, not the muscle, deeper" and have the model
      respond. Plan §12.3, unsolved.
- [ ] **Per-field suggested-vs-chosen provenance.** Today a field's provenance
      strategy is fixed by the registry rather than by what actually happened.
- [ ] **An explicit selection marker on return to Locate.** The user has to be able
      to see that their previous visual selection survived.
- [ ] **Question progress semantics.** "How far through am I" is currently derived
      from which questions were displayed; whether that is the right definition is
      a product question.
- [ ] **Write `layTerm` for every V1 structure.** Kenhub standard. Unglamorous,
      non-negotiable.
- [ ] **FMA verification.** Every generated FMA binding is `unverified` until a
      human checks it against the issuing authority.
- [ ] **Clinical review of the red-flag rules.** Named reviewer, named source, both
      false-positive and false-negative reasoning written down. Until then the
      release profile correctly refuses to start.

---

## Where this is going

The web app is **not** the product. It is one client, and the only one that
exists, which makes it easy to mistake for the destination.

```text
ASI Core                the domain: records, provenance, safety rules, interviews
  └─ ASI API            a stable, provider-agnostic HTTP surface
       └─ Standalone Web Anatomy Workspace   what ships first, local-first
            └─ MCP / Plugin                  the same capabilities as a tool
                 └─ ChatGPT and other AI clients
```

Each layer is defined by what it may depend on, not by what it happens to contain
today:

- **ASI Core** has no I/O and no network, so the safety-critical parts are
  verifiable without a model in the loop.
- **ASI API** names ASI's capabilities — localise a symptom, analyse a
  description, resume an episode — not the model behind them. Swapping Anthropic
  for anything OpenAI-compatible must not touch a route.
- **The web workspace** is a first-class client, not the host. Everything it does
  goes through the API, which is what makes the next two layers possible rather
  than hypothetical.
- **MCP / plugin** is the same read and write surface exposed to an agent that
  already has a user relationship. **Not implemented, and deliberately not
  implemented now** — the write path, the provenance rules and the safety gate
  have to be right before an autonomous caller can reach them.
- **ChatGPT and other AI clients** consume that. The reason the model may propose
  and nothing else may decide is that these clients will be proposing, and the
  boundary has to hold against a caller we do not control.

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
- ~~**MCP server.** Expose the record store to a desktop assistant.~~ **Done.** Ten tools
  over ASI Core, in `packages/mcp`. It is a CLIENT of the domain, not a second path into it:
  every write goes through the same `applyMutations` the HTTP route calls, in one
  transaction. No model is called and no vendor is named, so CI needs no external service.
  A crossing test proves an episode recorded over MCP is read identically over HTTP, and back.
  See `docs/mcp.md`.
- **Import from the vault.** Read past notes and extract episodes. Powerful and
  privacy-sensitive; needs its own consent flow.
