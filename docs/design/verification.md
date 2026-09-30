# Design pass verification — 2026-09-30

## Result and scope

Implemented on `codex/design-pass` in `/mnt/e/1project/anatomical-symptom-interface-design`.
The requested worktree was absent at the beginning; it was created from `4cb659e`.
No merge or push performed. The main working directory was not edited.

- `pnpm typecheck`: PASS, all workspaces.
- `pnpm test`: PASS, 28 existing domain tests + 2 new presentation tests; server currently has 0 tests.
- `pnpm --filter @asi/web build`: PASS (60 modules; JS 365.44 kB / gzip 107.45 kB).
- Browser: PASS 12/12 scenarios, Linux Chromium + actual deterministic API.
- Axe: 7 states, zero violations for WCAG 2 A/AA + WCAG 2.1 AA tags. Not a complete human accessibility certification.
- Boundary diff: zero changes in `packages/shared/src`, `packages/server/src`, database schema,
  `apps/web/src/state/session.ts`, API contracts or provenance/rule/question definitions.

## Runtime and original-flow baseline

WSL Ubuntu-24.04, Linux Node v24.21.0, pnpm 12.6.0. Web :5187, isolated server :8797.
The server reports deterministic/offline mode and the expected 8-unreviewed-rules warning.
No API key used; no main-project database used or seeded.

The original production build was preserved before UI implementation and exercised separately
at :5188 once Chromium finished downloading. The full describe → locate → interview → save →
summary → history path was executed. Observations: vague input "I feel unwell" rendered
"Shoulder body map"; no continue button on locate; multi answer advances on the first click;
18 history requests during the brief baseline flow. Baseline screenshots lived in /tmp and
were lost when the execution environment restarted; the observation logs remain in this chat.
The requested up-front browser review was delayed by that browser download; source audit and
baseline build preceded implementation, and actual original-flow review preceded final QA.

Current evidence is persisted in the gitignored `data/design-evidence/` directory (synthetic QA
records only). Current isolated DB: `data/design-qa.sqlite`. Neither is committed as health data.

## Browser scenarios

1. Entry has no inferred default shoulder; named textarea, disabled empty submission and skip link work.
2. Vague input shows no location, preserves words, and does not reveal the fallback shoulder on return.
3. Real offline candidates remain unconfirmed until explicitly selected; sub-region/pin selection stays on locate.
4. 1440/768/375 layouts tested; location and summary have no horizontal overflow.
5. Shoulder: single, boolean, text and genuine multiple selection, explicit Continue, 8 questions completed.
6. Review before save; real persisted summary, full clipboard export, health-map episode detail.
7. Clipboard permission failure exposes manual copy text; native new-episode dialog cancels with Escape.
8. Simulated failed save leaves review and retry available.
9. Neck, lower back and Chinese knee description: all current questions completed, real save and summary.
10. Simulated unavailable localisation leaves input intact with service recovery guidance.
11. Simulated history loading, empty list and transport failure have distinct states.
12. Zero uncaught browser exceptions across these interactions.

Axe states: entry, location desktop/mobile, interview, review, summary, history.
Keyboard: native radio/checkbox selection, labelled inputs, sub-region buttons, arrow-key pin slider,
skip link, focus indication, per-question focus, Escape dialog cancellation.

## Reproduce

Start web and server using separate ports and a dedicated `ASI_DB_PATH`; the browser suite saves
synthetic episodes. Do not point it at a real personal record database.

```bash
pnpm typecheck
pnpm test
pnpm --filter @asi/web build
# With Playwright/Chromium available in your QA environment:
ASI_WEB_URL=http://127.0.0.1:5187 node apps/web/test/browser.mjs
# With @axe-core/playwright also available:
ASI_WEB_URL=http://127.0.0.1:5187 node apps/web/test/accessibility.mjs
```

Both browser scripts accept `PLAYWRIGHT_MODULE` (installed module entrypoint) and `CHROMIUM_PATH`.
Accessibility also accepts `AXE_MODULE`; browser capture accepts `ASI_SCREENSHOTS`.
No Playwright/Axe/Prettier production dependency or lockfile change was added.

## UI decisions

- Natural language remains the first action. No chat transcript or dashboard widgets.
- Calm neutral canvas, one restrained action colour, 44px targets, explicit visual hierarchy.
- Dashed and labelled candidates; solid and labelled user selections; independent pin marker.
- Front/back schematic reused unchanged. Side/depth are explicit controls; tissue filters only
  filter candidate suggestions, and do not pretend to reveal anatomy layers.
- Location selection is staged locally, then passed through the existing confirmation action.
- Native radio/checkbox answers share one interaction language. All medical strings stay verbatim.
- Draft review and saved summary are visibly different. Summary groups preserve exact API values
  and put unrecognised fields in Other details; copy includes rule action steps and source counts.
- Health map is region → dated episode → details; record counts are explicitly not severity.

## Remaining UX limitations

See `DESIGN_HANDOFF.md` for interface proposals and blocking status.

- Original schematic proportions and non-mirrored side are visibly limited. No 3D or medical asset added.
- Mobile location is a long page, especially when pin controls/candidates are expanded.
- No safe undo-structure or edit-previous-answer controls until the store supports them correctly.
- Local pending location selection is lost on leaving/re-entering locate and must be selected again.
- Some collected multi answers do not survive the existing session mapping. Browser success is not
  evidence that the medical meaning or provenance is correct.
- Missing onset/timeline values and domain default negatives remain. Review does not invent answers.
- Required-question counts are shown, but existing early-save semantics are retained.
- No real-user usability study, manual screen-reader session or live model-mode test was performed.
- Safety rules/rationale are still unreviewed; this remains a development prototype.

## Changed files

- `DESIGN_HANDOFF.md`
- `apps/web/index.html`
- `apps/web/package.json`
- `apps/web/src/App.tsx`
- `apps/web/src/anatomy/BodyMap.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/tokens.css`
- `apps/web/src/ui/HistoryPanel.tsx`
- `apps/web/src/ui/InterviewPanel.tsx`
- `apps/web/src/ui/RecordDetails.tsx`
- `apps/web/src/ui/SafetyBanner.tsx`
- `apps/web/src/ui/SummaryPanel.tsx`
- `apps/web/src/ui/presentation.ts`
- `apps/web/src/ui/primitives.tsx`
- `apps/web/test/accessibility.mjs`
- `apps/web/test/browser.mjs`
- `apps/web/test/presentation.test.ts`
- `docs/design/diagnosis.md`
- `docs/design/verification.md`
