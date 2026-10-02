# V2 design verification

Environment: WSL Ubuntu 24.04, Linux Node v24.21.0 / pnpm 12.6.0, Playwright-core
1.63.0 driving the cached Chromium build. The deterministic server runs on an
isolated synthetic database `data/design-v3.sqlite`; Vite runs on 5189 and proxies
to it. No pre-existing project database was seeded or reset.

`/mnt/e` does not deliver inotify events, so a Vite dev server keeps serving a
stale transform cache after an edit. Every visual pass below cleared
`apps/web/node_modules/.vite` and restarted the server. Without that, CSS edits
silently appear to do nothing.

## Design evidence

Local gallery: `data/design-v2-evidence/index.html` (ignored, not published).
Screenshots at 1440, 768 and 375: entry, locate, details, review, summary,
health-map, unsupported, service-unavailable, save-failure, empty-history, plus
print and full-review. External reference evidence stays separate in
`data/v2-references/` and is never used as an app asset.

The previous capture set showed a visible `Skip to content` link over the anatomy
canvas. That was a stale artefact: the stylesheet already hides the link with
`clip-path: inset(50%)` and reveals it on focus. A computed-style probe confirmed
it paints nothing at rest and appears only when focused, so it was never a
defect and was deliberately left alone. The regenerated set is clean.

## Verification method

`apps/web/test/browser.mjs` drives real DOM controls against the deterministic
service: candidate selection → removal → re-selection, side/depth, optional pin,
question answers, incomplete review, real saving, copy text, print layout, history
selection and episode disclosure. Only transport and empty states are mocked, and
the mock is explicit in the test. It asserts no horizontal overflow at every
screenshot, then follows a keyboard-only entry → body location → question path and
completes an interview with uncertain answers.

`apps/web/test/accessibility.mjs` runs axe against WCAG 2 A/AA and 2.1 AA, which
supplements rather than replaces the keyboard run. Question text, rationale and
safety wording are unchanged from main.

An additional geometry probe clicks the rendered centre of all 13 sub-region hit
shapes across the four regions and both views, and asserts the inspector marks
that exact sub-region pressed. This is what makes the silhouette redraw safe: a
figure that drifted off its landmarks would produce a dead or mis-targeted zone.

## Results

Recorded 2026-09-30 against `359e474` plus this pass.

| Command | Result |
|---|---|
| `pnpm typecheck` | pass — 3 of 3 packages |
| `pnpm test` | pass — 195 tests, 0 fail (shared 135, server 26, web 34) |
| `pnpm --filter @asi/web build` | pass — 65 modules, CSS 20.18 kB (4.97 kB gzip) |
| `node scripts/smoke.mjs` | 38 passed, 0 failed |
| `node scripts/check-safety-metadata.mjs` | pass — `profile=development rules=10 unreviewed=10 releaseReady=false blocking=7` |
| `apps/web/test/browser.mjs` | 33 of 33 browser checks passed |
| `apps/web/test/accessibility.mjs` | pass — 6 screens × 3 widths, 18 scans, 0 violations |
| sub-region hit-zone probe | 13 of 13 zone clicks produced the matching selection |

The earlier recorded `smoke.txt` claimed 37 passed. `scripts/smoke.mjs` has
38 checks and is byte-identical to main, so that file was a partial run; the real
smoke suite passes and the stored log has been replaced. (The exact check count moves when checks are added, so it is read from the run rather than asserted here.)

Domain boundary re-checked at the end of the pass: `git diff main...HEAD --
packages/ scripts/` is empty. No shared semantics, server semantics, database
schema, safety rule, provenance policy or interview content was touched.

## Changes made in this pass

1. Repaired `apps/web/test/presentation.test.ts`. Its `summaryText` fixture was
   written against the pre-hardening summary shape (`unconfirmedConsiderations`),
   so it threw on the fields the current `PreVisitSummary` actually defines
   (`visualSelections`, `unselectedSuggestions`, `withheldNotes`,
   `safetyGateBlocked`, `outstandingFields`) and `pnpm test` failed on arrival.
   The fixture was corrected to the authoritative domain type and the assertions
   strengthened to cover the withheld-rule and blocked-gate copy path. No domain
   file and no main correctness test was changed.
2. Made the anatomy dominant on desktop Locate. The silhouette was hard-fixed at
   440×236px inside a ~758px field, so it occupied roughly 31% of the canvas
   width and the field was mostly empty grey. The body now scales with its stage
   and the workbench is bounded at 1120px instead of stretching to the page width.
3. Reproportioned the schematic silhouette — head from 22% to ~19% of height,
   sloping shoulders, a drawn-in waist, and arm roots tucked under the torso so
   the figure reads as one body rather than a stack of slabs. All paths still span
   the landmark bands the hit shapes occupy.
4. Fixed an unreachable control: `lower_back.central` spanned the full lumbar
   width and was completely covered by the two paravertebral shapes, so it could
   never be selected by clicking the map. The three lower-back zones are now
   adjacent bands. Front-end hit geometry only; sub-region ids, labels and
   meaning are unchanged.

## Remaining visible limitations

- The silhouette is still schematic. The legs read as two straight columns and the
  head is an oval. The composition and the viewer adapter are ready for a richer
  2D or 3D asset, but this pass deliberately does not add one.
- Front and back share one silhouette; the schematic does not mirror, and the UI
  says so where a user could otherwise assume it does.
- The mobile Locate uses an anatomy-first view, three staged inspector choices and
  a sticky action; a user still scrolls to reach fine positioning. It requires no
  drag or swipe gesture.
- Some interviews do not collect timeline or intensity, so the summary carries
  honest blank / not-asked rows.
- Long historical episode detail can be tall; the collapsed timeline stays compact.
- UI is English with bilingual free-text input. Medical content was not translated
  or invented.
- A reference screenshot is not proof of native focus or responsive behaviour. See
  the evidence limits in the reference pack.
