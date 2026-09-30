# Design / frontend handoff — V2

2026-09-30. UI branch incorporates hardened main through `a0d64fe`. Shared/server,
schema, safety rules, provenance policy, session.ts and state/logic.ts are unchanged
relative to that main commit. The merges import the main agent's changes; they are
not design-authored domain changes. No push or merge into main.

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

## Deliberate scope limits

- No anatomy asset replacement or 3D; original schematic geometry remains. This is the largest remaining visual weakness.
- No new body region or medical question; missing timeline/intensity data is not invented.
- “Tissue filter” filters suggestions only. It does not pretend the 2D silhouette renders layers.
- History counts are records, not severity or risk. No scores, trends or diagnostic claims.
- Empty/loading/error are separate. Offline deterministic mode still needs its local API service.
- Incomplete records can be reviewed/saved as main permits. No new safety gate or safety clearance.

## Integration guidance

Main is the source of domain truth. Resolve later integration around current session signatures,
then rerun typecheck, all tests, smoke and browser checks. The design branch owns component-local
inspector stage, draft pin/subregion selection, history region filtering and copy feedback only.
