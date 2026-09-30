# V2 design verification

Environment: WSL Ubuntu, Linux Node/pnpm/Chromium. Deterministic server uses isolated synthetic
`data/design-v2-final.sqlite` on 8799; Vite on 5189 proxies to it. No existing project database was seeded/reset.

## Design evidence

Local gallery: `data/design-v2-evidence/index.html` (ignored, not published).
Screenshots at 1440, 768 and 375 widths: entry, locate, details, review, summary, health-map,
unsupported, service-unavailable, save-failure and empty-history; also print and full-review.
External reference evidence remains separate in `data/v2-references/` and is never used as an app asset.

## Verification method

`apps/web/test/browser.mjs` operates through real DOM controls and the deterministic service.
It tests candidate selection → removal → re-selection, side/depth, optional pin, question answers,
incomplete review, real saving, copy text, print layout, history selection and episode disclosure.
Only transport/empty states are mocked, explicitly in the test. It checks horizontal overflow
at every screenshot, then follows a keyboard-only entry → body location → question path and
completes an interview with uncertain answers.

`apps/web/test/accessibility.mjs` uses axe WCAG 2 A/AA + 2.1 AA, supplementing—not replacing—the
keyboard run. Existing question text/rationale and safety wording stay unchanged.

Required-command results and final browser totals are recorded below after the final run.

## Remaining visible limitations

- The original schematic has exaggerated head/short legs. Composition is ready for a better viewer,
  but this pass deliberately does not change persisted coordinate meaning.
- The mobile Locate uses an anatomy-first view, three staged inspector choices and sticky action;
  a user still scrolls to reach fine-positioning. It does not require drag/swipe gestures.
- Some interviews do not collect timeline or intensity. Summary has honest blank/not-asked rows.
- Long historical episode detail can be tall; the collapsed timeline stays compact.
- UI is English with bilingual free-text input; translations of medical content were not invented.
- A reference screenshot is not proof of native focus/responsive behavior. See reference-pack limits.
