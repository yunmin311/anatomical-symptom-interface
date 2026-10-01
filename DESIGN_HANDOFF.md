# Design / frontend handoff — V2

2026-09-30. UI branch incorporates hardened main through `a0d64fe`. Shared/server,
schema, safety rules, provenance policy, session.ts and state/logic.ts are unchanged
relative to that main commit. The merges import the main agent's changes; they are
not design-authored domain changes. No push or merge into main.

> **Phase 1A (this branch, `phase1/anatomy-workspace`) supersedes the V2 notes
> below where they touch the anatomy viewer.** V2 is merged into `main` at
> `1f2f26e`. Phase 1A is built on that and adds
> [`docs/design/phase1a-anatomy-workspace.md`](docs/design/phase1a-anatomy-workspace.md):
> a 3D adapter behind the same contract, a manifest seam for real assets, a rebuilt
> 2D map, depth wired to the viewer, a fallback that cannot white-screen, and a
> spatial history read model. `session.ts` and `state/logic.ts` were already
> domain-facing and remain free of domain changes; Phase 1A adds no persisted
> field. The V2 sections are kept for history.

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
| Natural English descriptions should reach supported regions | `My right shoulder hurts deep inside near the rotator cuff` returns unsupported. `detectOutOfScope` matches compact text substrings; `ear` matches `near`. Reproduced against the real deterministic service. | Fix lexical boundary matching in the router, keeping unsupported safety routing authoritative. Regression test for near/ear and other embedded tokens. | Blocks those descriptions; no frontend bypass. |
| Truthful per-field “suggested” versus “chosen” labels after navigation | Session location contains proposed side/depth/subregion alongside user edits; no readable origin/interaction status per field in the frontend session. | Expose existing provenance/interaction status as read-only presentation metadata; do not invent another persisted authority. | Blocks precise per-field origin badges, not the workspace. UI says starting suggestion / current description, never medically confirmed. |
| Restore approximate selection when returning to Locate | No reliable user-selected subregion marker separate from suggested subregion. Local pending choice is intentionally reset on remount. | Read-only marker distinguishing explicit user area choice from proposed subregion. | User must reselect area when returning; avoids silently accepting proposal. |
| Faithful side/view/pin geometry | Point is x/y without a view or side coordinate frame. Existing 2D hit targets have schematic proportions and fixed side placement. | Specify coordinate/view semantics before geometry replacement, side mirroring, or 3D. | Blocks faithful mirrored/view-specific pins. UI explicitly says schematic; side/depth separate. |
| Consistent question count meaning | `questionProgress.outstanding` uses triState for all question types; some answered non-boolean values normalise to unknown. An answered count can coexist with a high outstanding count. | Domain-provided per-question unresolved/missing status appropriate to each question type. | Non-blocking; UI displays returned counts and exact raw answers without redefining resolution. |
| Stable summary grouping | `summary.history` has English labels only. | Optional stable field/section identifiers alongside unchanged labels/values. | Non-blocking; unknown labels remain in Other details. |
| Editing a previously answered question | UI can read answers, but replacing an answer may require domain reconciliation of additive record fields. | Explicit replacement/recompute semantics for an existing answer. | Blocks truthful per-answer edit/back flow; no misleading edit action added. |
| Clinically reviewed copy and rules | Rationale and rules remain unreviewed. Current service reports 10/10 rules unreviewed. | Clinical review through existing policy, not frontend changes. | Blocks real-user release, not prototype design. Exact supplied safety wording retained. |
| ~~Safety action steps in the copied plain-text summary~~ **RESOLVED in `renderPlainText` (domain).** | Raised here because deferring the copy to the domain dropped `safetyNotes[].steps` from the clipboard/fallback payload, making the pasted artefact less complete than the screen. The domain renderer now emits every step, indented under its own note so steps cannot be read as the next note's message. Blocked-gate output is unchanged and still withholds rather than prints. Covered by `packages/shared/test/plain-text-safety.test.ts`. | — none outstanding — | Closed. The domain renderer stays authoritative and the frontend still carries no second implementation. |

## Deliberate scope limits

- No anatomy asset replacement or 3D; the schematic geometry was reproportioned
  (head, shoulders, waist, arm roots) but is still a silhouette, not an atlas.
  Replacing it with a real asset remains the largest visual weakness.
- Front and back share one silhouette and it does not mirror. The UI states this
  where a user could otherwise assume otherwise.
- No new body region or medical question; missing timeline/intensity data is not invented.
- "Tissue filter" filters suggestions only. It does not pretend the 2D silhouette renders layers.
- History counts are records, not severity or risk. No scores, trends or diagnostic claims.
- Empty/loading/error are separate. Offline deterministic mode still needs its local API service.
- Incomplete records can be reviewed/saved as main permits. No new safety gate or safety clearance.

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
- Tooling note for whoever runs this next: `/mnt/e` does not emit inotify events,
  so a Vite dev server keeps serving a stale transform cache after an edit. Clear
  `apps/web/node_modules/.vite` and restart Vite, or CSS changes appear to do
  nothing. Helper scripts live in the ignored `data/run/`.

## Phase 1A — interface points for the domain and asset owners

| UI need | Where it lives now | What the owner has to do | Blocking? |
|---|---|---|---|
| Real anatomy meshes | `apps/web/src/anatomy/manifest.ts` — a **renderer scene contract**: which mesh, which views, which layer, where to aim the camera | Do **not** extend the web manifest into an asset manifest. Asset identity, provenance and licence belong to the canonical `packages/shared/src/anatomy-manifest.ts` from `phase1/core-foundation`; add an adapter that converts it into the scene shape. No renderer code changes. | Blocks a viewer that looks like a body. The renderer, picking, layers, camera and fallback are done and tested. |
| Patient-side mirroring | `CAMERA_PRESETS` in `three3d.ts` places the camera on the figure's left flank | Decide the figure-to-patient mapping and say so in the manifest or a domain constant; the adapter deliberately does not guess | Non-blocking. Presets are four distinct, tested stations. The 2D map already expresses side by mirroring the drawing. |
| Spatial history read model | `apps/web/src/ui/spatial-history.ts` derives region → location marks → count → most recent from the episodes the API already returns | Serve that shape (or the episodes plus a location index) so the file becomes a fetch instead of a derivation | Non-blocking. The boundary exists and is tested; a fixture source is labelled as such. |
| Rejected suggestions | `ViewerCommand.reject` / `clearReject`, presentation-only; the candidate is kept | Nothing. Deliberately **not** persisted: a dismissal is a view decision, and deleting the candidate would be lossy in the same way deleting a deselected candidate is | Not blocking. |
| Depth from the user's own words | `syncViewer` projects `record.location.depth` into the viewer | Nothing. Fixed in this phase after localisation set depth without telling the viewer | Resolved. |
| Per-episode clinical severity | Nowhere | Not modelled anywhere, deliberately. History counts are counts of records | Not a UI gap. A test asserts the spatial model carries no severity, score, risk or trend. |

## Integration guidance

Main is the source of domain truth. Resolve later integration around current session signatures,
then rerun typecheck, all tests, smoke and browser checks. The design branch owns component-local
inspector stage, draft pin/subregion selection, history region filtering and copy feedback only.
