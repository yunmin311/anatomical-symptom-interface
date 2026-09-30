# Design / frontend handoff

Scope: UI only; `session.ts`, shared/server source, schema and contracts are unchanged.
This is a development prototype, not a clinically reviewed product.

## Interfaces needed from the main agent

| Need | Current limitation / evidence | Smallest useful interface | Blocks design? |
|---|---|---|---|
| Distinguish proposed vs user-selected region/side/depth/sub-region after navigation and persistence | `describe` writes inferred values directly to `record.location`; no frontend-readable confirmation flags. `save` confirms all non-null location values. | Readable field-level source/verification state plus explicit location confirmation action. | Blocks truthful persisted confirmation labels. UI must say “recorded location”, not medically confirmed. |
| Preserve multiple interview answers accurately | `shoulder.weakness` is a multi question, while `answer` tests `String(value) === 'true'`; several other mappings do not match question meanings. | Correct mapping of existing `answer(id, value, optionValues)` arguments, ideally stored answers keyed by question ID. | UI can collect multiple values, but cannot guarantee all values survive into the domain record. |
| Edit/revisit answers without duplicate or stale semantics | `asked` is only an ID list; prior answer values are unavailable, and mutations are additive. | Readable answer map and replace-answer action. | Blocks accurate “Back/edit answer”; no fake back button implemented. |
| Undo candidate selection safely | `rejectStructure` removes the candidate and clears viewer pin, but does not consistently clear viewer selection. | Deselect action that preserves candidate provenance and pin. | Blocks safe undo. Do not expose a misleading toggle. |
| Correct/relocalise an existing saved episode | `describe` rebuilds record/asked but retains episodeId/summary; reset leaves some viewer/orchestrator state. | New-session and relocalisation semantics with stale-summary invalidation. | UI can require explicit new-episode reset; cannot silently repair store. |
| Supported/unsupported/network/model states | `api()` discards error response bodies; `describe` drops score/matchedTerms. Baseline deterministic localise returns HTTP 200 and shoulder with score 0 for ungrounded text. | Retain score/matchedTerms or a typed no-match state in session; typed error reason and safe message; distinguish transport failure, model fallback and unsupported input. | UI reuses groundFromText only to suppress the deterministic fallback shoulder, including after returning to edit. Remove that presentation guard once the session exposes no-match. Model no-match/routing remains blocked. |
| Region correction preserving the user's words | No setRegion action; calling describe resets record. | Region correction action with proper provenance and reset rules. | UI offers edit description instead of inventing a record mutation. |
| Pin orientation and selected side | Point is just x/y; no view/side coordinate metadata. Existing hit shapes are schematic and side placement differs by region. | Define pin coordinate/view semantics before mirrored/lateral geometry or 3D. | Blocks faithful side-specific geometry. Current viewer labels schematic and controls side separately. |
| Summary grouping independent of English labels | `summary.history` is label/value pairs without stable section IDs. | Optional stable field/section IDs, preserving current labels/values. | Non-blocking: presentation adapter groups known labels; unknown labels remain visible in Other details. |
| Safety copy and rationale | Current rationale includes strong clinical claims. All rules unreviewed. | Clinically reviewed text and translations in shared registry, existing shape sufficient. | Blocks real-user release, not design. UI preserves exact wording. |

## Merge notes

The front end continues to call existing session actions and shared question/summary helpers.
No new medical content or record fields are introduced. Please coordinate any changes to action
signatures; do not merge UI around a new contract without typecheck and browser verification.

The visual selection pending in the location component is component-local; only explicit Continue
calls the existing confirmSubRegion action. Side and depth use existing actions immediately.

## Additional UI limits to carry into integration

- A multi-question submission passes the complete array as value and optionValues. The UI tests
  prove multiple selection/submission, not correctness of medical record mapping.
- Review can show an incomplete record and retains the existing ability to save early. Required
  questions remaining are explicitly counted. Any mandatory safety gate belongs to the main agent.
- View changes and left/right correction do not remap existing pins. Geometry remains the original
  schematic to avoid silently changing the meaning of persisted normalised coordinates.
- Localisation draft selection is component-local and must be selected again after leaving that view.
- Timeline/onset fields not collected by the current interview stay absent/unknown. No new questions.
- Safety rationale, default values and deterministic summary wording are displayed verbatim; design
  does not validate them. In particular, default 'no' must not be mistaken for an actual answer.
