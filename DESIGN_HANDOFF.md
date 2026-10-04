# Design / frontend handoff

> **The V1 product-design refinement pass lives on `design/v1-product-refinement`,
> not here.** Its audit is
> [`docs/design/v1-product-audit.md`](docs/design/v1-product-audit.md) — what the
> product actually did when driven end to end against real BodyParts3D scenes at
> 375, 768 and 1440, before any of it was redesigned. Read that first: it is the
> evidence, and several of the findings below are now closed and are marked as
> such. The harness that produced it is `scripts/audit-*.{mjs,sh}`, and
> `scripts/final-gates.sh` is still the single entry point.

> **Superseded in the anatomy-viewer sections by Phase 1A, which is now
> INTEGRATED on `phase1/integration`.** The V2 notes below are kept for history;
> where they disagree with the current code, the code is right and the note
> is marked. Phase 1A added:
> [`docs/design/phase1a-anatomy-workspace.md`](docs/design/phase1a-anatomy-workspace.md)
> — a 3D adapter behind the unchanged `AnatomyAdapter` contract, a real
> `RendererSceneManifest` fed by an adapter from the canonical asset manifest, a
> rebuilt 2D map, depth wired to the viewer, a fallback that cannot white-screen,
> server-authoritative spatial history, and working episode reopen.
>
> **What integration changed, for anyone who remembers the branch state:**
>
> - The near→ear lexical bug is **resolved** — boundary matching no longer treats
>   a substring inside a word as a token.
> - The viewer is no longer "not implemented": it loads real GLB bytes through
>   the real `GLTFLoader`, resolves descendant meshes to canonical `asiIds` and
>   selects structures.
> - **Depth projection is resolved** — the record's depth reaches the viewer on
>   every write.
> - **Spatial history is server-authoritative.** It used to be derived in the
>   browser, which silently merged two places the server had deliberately kept
>   apart. The client now maps places for display and may not regroup them.
> - `apps/web/src/anatomy/manifest.ts` is now
>   `apps/web/src/anatomy/scene-manifest.ts`, and its types are named
>   `RendererSceneManifest` / `RendererSceneEntry`. Two files called "the
>   manifest" was a correctness hazard, not a style choice.

## What the design pass changed, and what it deliberately did not

The design pass reorganised presentation only. It introduced no field, no rule,
no id, no mapping and no second implementation of anything the domain owns.

| Area | Now | Owner boundary respected |
|---|---|---|
| Locate / anatomy workspace | The region is the largest text on the screen and the four facts — area, side, depth, view — are stated in one orientation bar rather than scattered across a tab and a 12px footer caption | `location.*` values are read from the record, never derived |
| Depth | A rail beside the map, in words a person uses, with the consequence stated as a slice rather than as a list of tissue names | The four-value `Depth` enum is unchanged. A `depthQualifier` is a capability request, not an invention |
| Selection continuity | The draft starts from the record, so returning to Locate shows the area chosen, marked as recorded, with the primary action enabled | `location.userSelectedStructureIds` remains the only source of truth for a visual selection |
| Interview | Position, both counts, a determinate bar, and one sentence saying "I am not sure" is recorded as an answer | The ordinal is the index in the region's own list and is deliberately **not** counted against `questionProgress.total`, which is applicability-filtered |
| Review | Answered rows first; never-asked questions in one labelled disclosure per section; edit controls are buttons | Row values are unchanged. `readable()` is unchanged |
| History | Episodes lead with the patient's own words; side and status in words; the place list shows when it was last used | Place identity, counts and membership still come from the server's `regionRowId`. Nothing is regrouped in the browser |
| Summary | The patient's own words lead; `chiefComplaint` is unchanged word for word under "One-line summary"; the export action sits above the provenance list | `chiefComplaint` and `renderPlainText` are domain output and were not re-implemented |
| Mobile | No horizontal scroll at 375; the canvas instruction is visible below 1000px; the area list precedes side/depth | Layout and copy only |
| Accessibility | The canvas instruction is visible on every surface at every width; every progress figure is in text as well as in the bar; side and depth wording is defined once | No ARIA role, name or landmark was removed |

Two things the audit found that are **still** open, and why:

- **Depth cannot express "not the skin".** A capability, not a design. Request 1
  in the audit.
- **Episode titles are `"<region> — <date>"`.** The views now lead with the
  patient's own words instead of pretending the title distinguishes anything; a
  derived title is a Main Agent capability request.

## Resolved since V1
The old fallback-region presentation workaround is removed. UI uses authoritative
`unsupported`, `refusal`, `clarification`, `answers`, `safety` and localisation `by`.
Yes/no/unknown remain distinct. Candidate deselection calls main's `deselect` and
retains the suggestion. The canonical selected-ID set determines visual selection.
The review renders raw answers, never schema defaults as answers. Saved history
uses the shared summary renderer with a complete coverage map from saved provenance.
No private write endpoint, new field, medical question or altered rule was added.

## Remaining interfaces / defects for the main agent

| UI need | Current limitation / evidence | Minimal support | Blocking? |
|---|---|---|---|
| Natural English descriptions should reach supported regions | ~~`detectOutOfScope` matches compact text substrings; `ear` matches `near`.~~ **RESOLVED** — the router now matches on token boundaries, so `near` no longer triggers `ear`. Covered by a regression test in `packages/shared/test/grounding.test.ts`. Unsupported safety routing stays authoritative. | — none outstanding — | Closed. |
| Truthful per-field “suggested” versus “chosen” labels after navigation | Session location contains proposed side/depth/subregion alongside user edits; no readable origin/interaction status per field in the frontend session. | Expose existing provenance/interaction status as read-only presentation metadata; do not invent another persisted authority. | Blocks precise per-field origin badges, not the workspace. UI says starting suggestion / current description, never medically confirmed. |
| ~~Restore approximate selection when returning to Locate~~ **RESOLVED on `design/v1-product-refinement`.** | No reliable user-selected subregion marker separate from suggested subregion; the pending choice was reset on remount, so a returning user saw the recorded area on the map with every button unpressed and a **disabled** primary action. | **None outstanding.** The draft is seeded from `location.subRegionId` and the chosen area is marked `recorded`, with the suggestion/selection distinction stated as a state on each candidate rather than as a text prefix. Measured before: `continueEnabled: false`, no pressed button. After: `continueEnabled: true`, `Front of shoulder ✓ recorded`. Provenance is unchanged — the record is still the only authority. |
| Episode titles | Titles are `"<region> — <date>"`, so three episodes in one region are indistinguishable and "most recent" / "open episode" cannot be read off the list. | Either a title derived from what the user said, or a stable way to show the distinguishing facts. | Non-blocking. **The views no longer lean on the title**: the patient's own words lead each episode, and each place shows when it was last used. A derived title is still a Main Agent decision. |
| Faithful side/view/pin geometry | Point is x/y without a view or side coordinate frame. Existing 2D hit targets have schematic proportions and fixed side placement. | Specify coordinate/view semantics before geometry replacement, side mirroring, or 3D. | Blocks faithful mirrored/view-specific pins. UI explicitly says schematic; side/depth separate. |
| Consistent question count meaning | `questionProgress.outstanding` uses triState for all question types; some answered non-boolean values normalise to unknown. An answered count can coexist with a high outstanding count. | Domain-provided per-question unresolved/missing status appropriate to each question type. | Non-blocking; UI displays returned counts and exact raw answers without redefining resolution. |
| Stable summary grouping | `summary.history` has English labels only. | Optional stable field/section identifiers alongside unchanged labels/values. | Non-blocking; unknown labels remain in Other details. |
| Editing a previously answered question | ~~UI can read answers, but replacing an answer may require domain reconciliation of additive record fields.~~ **RESOLVED in the domain** — re-answering REPLACES, marked `user_edited` by the store from the row, and the answer-derived fields are recomputed from the whole answer set. | — none outstanding — | Closed. The per-answer edit controls are buttons that return to the question, and the correction banner states that the previous answer is replaced rather than kept. |
| Clinically reviewed copy and rules | Rationale and rules remain unreviewed. Current service reports 10/10 rules unreviewed. | Clinical review through existing policy, not frontend changes. | Blocks real-user release, not prototype design. Exact supplied safety wording retained. |
| Depth cannot express "not the skin" | `Depth` is `superficial \| intermediate \| deep \| unknown`. Four values cannot carry "not the skin", "around the muscle", or a relative "deeper than I said". | A separate `depthQualifier` claim beside the enum — the smallest change that lets the interface say what the user said, and it does not overload `Depth`'s meaning. | Non-blocking for V1, blocking for the roadmap's §12.3 interaction. **The UI did not invent a fifth value**; it states the consequence of each of the four as a slice. Request 1 in the audit. |
| Summary label casing | `summary.history` renders `Depth (patient report)` → `Deep`, while the review table says `Deep inside` for the same field. | The label/value pair to come from one place. | Cosmetic, and deliberately **not** patched in the frontend: rewriting a domain-produced value would be a second implementation of the summary. |
| ~~Safety action steps in the copied plain-text summary~~ **RESOLVED in `renderPlainText` (domain).** | Raised here because deferring the copy to the domain dropped `safetyNotes[].steps` from the clipboard/fallback payload, making the pasted artefact less complete than the screen. The domain renderer now emits every step, indented under its own note so steps cannot be read as the next note's message. Blocked-gate output is unchanged and still withholds rather than prints. Covered by `packages/shared/test/plain-text-safety.test.ts`. | — none outstanding — | Closed. The domain renderer stays authoritative and the frontend still carries no second implementation. |

## Deliberate scope limits

- **No real anatomy asset yet.** The viewer renders procedurally generated
  real sourced geometry for every region, with the 2D map as the floor for
  every failure path. This was the single largest visual weakness and it is
  closed: see the status table below.
- The 2D schematic was reproportioned (head, shoulders, waist, arm roots) but is
  still a silhouette, not an atlas.
- Front and back share one silhouette and it does not mirror. The UI states this
  where a user could otherwise assume otherwise.
- Patient-side mirroring in 3D is **undecided on purpose** — the adapter will not
  guess which side of the figure a patient's left is.
- No new body region or medical question; missing timeline/intensity data is not invented.
- "Tissue filter" filters suggestions only. It does not pretend the silhouette renders layers.
- History counts are records, not severity or risk. No scores, trends or diagnostic claims.
- Empty/loading/error are separate. Offline deterministic mode still needs its local API service.
- Incomplete records can be reviewed/saved as main permits. No new safety gate or safety clearance.

## Notes added by the 2026-10-04 design pass

- **The gate and audit runners must not use `npx`.** On a `/mnt/<drive>` checkout
  `npx` resolves to the *Windows* node first on PATH. It cannot resolve pnpm's
  store layout, so the seed fails outright, and a Windows child keeps the runner's
  pipe open, so anything reading that output waits forever for an EOF that only
  arrives when the server dies. Both runners now use `./node_modules/.bin`, which
  is what the lockfile pins.
- **A background server must close every inherited descriptor above 2.** Starting
  the API and the dev server with `&` and `>log 2>&1` is not enough: the children
  still hold the caller's stdout, so `audit-serve.sh | tee` hangs with the script's
  own output already printed. `spawn_detached` in `scripts/audit-serve.sh` closes
  fds 3+ before exec.
- **Never wait on `networkidle` against the Vite dev server.** It holds an HMR
  websocket open, so the network is never idle and each `goto` stalls. The browser
  probes use `domcontentloaded` plus the element wait they already had; the fold
  probe went from over fifteen minutes to seconds.
- `vite.config.ts` sets `strictPort`. Vite's default is to take the next free port
  when the one it was asked for is busy, so a second checkout silently serves the
  old build on the port you are reading.
- `scripts/audit-freshness.mjs` compares string literals rather than bytes, because
  Vite serves esbuild output. Comments and import specifiers are stripped first —
  esbuild removes comments and Vite rewrites paths, so without that step the check
  reports ~18 false "missing" literals on a perfectly fresh server.
- `final-gates.sh` has a `hooks` gate (`scripts/audit-testhooks.mjs`) that names a
  `data-testid` a gate depends on if a redesign removes it, instead of leaving the
  gate to fail somewhere unrelated.
- The screenshots in `docs/design/v1-product-audit.md` were taken with real
  production scenes at 375 / 768 / 1440. No screenshot in this repository is of a
  fixture, and `scripts/audit-serve.sh --check-fresh` proves the module the browser
  received is the module on disk before a capture is believed.

## Notes added by the 2026-09-30 continuation pass

- `apps/web/test/presentation.test.ts` had been written against the pre-hardening
  `PreVisitSummary` shape and made `pnpm test` fail on arrival. It now uses the
  authoritative domain type. This was a stale *test*, not a domain defect: the
  implementation was already correct, and no `packages/` file was changed.
- Front-end hit geometry changed in one respect: the three lower-back zones were
  fully nested, so `lower_back.central` could never be selected from the map. They
  are now adjacent bands. This is `apps/web/src/anatomy/svg2d.ts` presentation
  geometry only — sub-region ids, labels, ordering and meaning are untouched, and
  the canonical `location.userSelectedStructureIds` write path is unchanged.
- A geometry probe now clicks the centre of all 13 sub-region hit shapes and
  asserts the matching selection, so a future silhouette change cannot silently
  move a hit target off the body.
- The desktop Locate workbench is now bounded at 1120px and the body scales with
  its stage, instead of the body being fixed at 440px inside a stretched field.
- The `Skip to content` link visible in the earlier V2 screenshots was a stale
  stylesheet artefact, not a defect; the current CSS keeps it hidden until focus.
  Do not "fix" it.
- Tooling note: `/mnt/e` does not emit inotify events, so a Vite dev server keeps
  serving a stale transform cache after an edit. Clear
  `apps/web/node_modules/.vite` and restart Vite, or CSS changes appear to do
  nothing.
- Helper scripts no longer live in the ignored `data/run/` — anything meant to be
  reproducible belongs in `scripts/`. `scripts/final-gates.sh` is the entry point.
- Browser gates need `playwright-core` and a chromium build that are deliberately
  NOT repo dependencies. Install them into `~/.cache/asi-gate-tools`; when they
  are absent the runner reports those gates as **SKIP** and exits non-zero, rather
  than pretending they passed.

## Phase 1A — interface points for the domain and asset owners

| UI need | Where it lives now | What the owner has to do | Blocking? |
|---|---|---|---|
| Real anatomy meshes | `packages/shared/src/anatomy-manifest.ts` is the **only** asset authority. `apps/web/src/anatomy/scene-manifest.ts` is a renderer contract, converted by `asset-scene-adapter.ts` | Put the real manifest through `parseManifest` and `toRendererScene`. Do **not** hand-build a scene, and do not write `externalAssetNotice` by hand — it is derived and `assertSceneAttribution` rejects one that disagrees | **Done for all four regions.** BodyParts3D 4.0 (CC BY 4.0), audited mesh by mesh against the archive before mapping. **95** production GLBs — 82 bilateral plus 13 dedicated midline — including real MIDLINE builds for the neck and the lower back. The renderer, picking, layers, camera and fallback were already done and tested. |
| One mesh per GLB | The adapter deliberately does not set `nodeName`, because the Core pipeline emits one mesh per file and requiring a name would refuse every real asset | None. A future multi-part file sets `nodeName` on the scene entry explicitly | Not blocking. Both shapes are tested. |
| Sub-region ambiguity | A structure reachable from several sub-regions carries the whole canonical `subRegionIds`; `soleSubRegionId` exists only when there is exactly one. `resolveSubRegionForStructure` keeps / adopts / asks | None. **Do not** collapse the list to its first element — that is the bug this shape exists to prevent | Resolved, and enforced by a test that fails if a singular field appears for a multi-sub-region structure. |
| Patient-side mirroring | `CAMERA_PRESETS` in `three3d.ts` places the camera on the figure's left flank | Decide the figure-to-patient mapping and say so in the manifest or a domain constant; the adapter deliberately does not guess | **Done.** Presets are four distinct, tested stations, and laterality now comes from the source concept rather than from camera position. The 2D map expresses side by mirroring the drawing. |
| Spatial history | `apps/web/src/ui/spatial-history.ts` is a **presentation mapper** over `SpatialHistoryNode` from `/api/healthmap/:personId/spatial`. The contract is in `@asi/shared` | Nothing. It may sort, label and group by region; it may not merge, dedupe or recount | Resolved. |
| Asset attribution | `apps/web/src/ui/AnatomyAttribution.tsx`, derived through `sceneLicenceEvidence` | Nothing. A production scene must carry derived attribution or the panel says so as a packaging error | Resolved. A synthetic asset cannot print a licence, by construction. |
| Rejected suggestions | `ViewerCommand.reject` / `clearReject`, presentation-only; the candidate is kept | Nothing. Deliberately **not** persisted: a dismissal is a view decision, and deleting the candidate would be lossy in the same way deleting a deselected candidate is | Not blocking. |
| Depth from the user's own words | `syncViewer` projects `record.location.depth` into the viewer | Nothing | Resolved. |
| Episode reopen | `reopenEpisode(id)` in `session.ts`, over `GET /api/episodes/:id/reopen` and the shared `EpisodeReopen` contract | Nothing. It hydrates the same episode id, so a continue updates in place | Resolved, and proven through a restart. |
| Per-episode clinical severity | Nowhere | Not modelled anywhere, deliberately. History counts are counts of records | Not a UI gap. A test asserts the spatial model carries no severity, score, risk or trend. |

## Integration guidance

Main is the source of domain truth. Run `bash scripts/final-gates.sh` before
believing anything: it typechecks, unit-tests across all three packages, builds,
smokes, checks the release gate and safety metadata, runs the migration,
place-identity, reopen, adapter and URL-GLB suites, and finishes with the
browser, accessibility, hit-zone, 3D, fallback, URL-GLB and evidence gates. It
reports each gate separately and fails the run on a skip.

The web app is not the final product; see the product-shape section of
[`docs/04-roadmap.md`](docs/04-roadmap.md). Anything the workspace needs that is
not in `@asi/shared` is a candidate to be an API capability instead, because the
plugin and MCP layers will need the same thing without a browser.