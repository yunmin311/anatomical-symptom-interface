# Design pass — 2026-09-29

Scope: `apps/web` presentation only. Baseline: `4cb659e`.
The requested worktree/branch did not exist; created at the requested path from main.
No shared/server source, database schema, API contract, or session logic changes.

## Diagnosis from the complete source audit

1. The entry sidebar presents the empty record's default shoulder as if it were known.
2. Every render starts a history request; its response rerenders the app and starts another.
3. The location map has no explicit continue action. Clicking a sub-region unexpectedly opens the interview; selecting a candidate does not.
4. Candidate and selected geometry share one colour, and every zone highlights when any candidate exists. Suggested sub-regions look selected before a user acts.
5. Side and camera are ambiguous; the lower-back map starts on the front even though the adapter defaults to the back. Lateral controls reuse front/back silhouettes.
6. Depth/layer commands exist but the UI offers no depth control. Tiny hit targets have no keyboard equivalent.
7. Multi questions submit on the first option click. Text inputs lack labels, question transitions lose focus, and answer selection/advancement are conflated.
8. Review is a save prompt or a flat summary; copying drops safety, provenance and prior episodes. Save errors are invisible outside entry.
9. Health history is a flat region/side list without an episode inspection/timeline hierarchy. Empty and failed requests are indistinguishable.
10. Small targets, subtle state differences, unrestricted stage navigation and repeated cards weaken hierarchy and accessibility.

## Direction

A calm body-location workbench, not chat or an atlas. Natural language first;
body map and equivalent text controls second; explicit confirmation before questions;
a readable review before generating the existing deterministic summary.

- Palette: paper `#ffffff`, canvas `#f4f5f7`, ink `#252c36`, secondary `#566171`,
  action/selection `#384d7c`, candidate `#705c3d`. Severity retains its own semantic colours.
- Local system sans (Segoe UI / system-ui), no remote fonts/assets. Type: 14/16/20/28/40px.
- 4px spacing base; 44px minimum interactive targets; 6px controls, 10px surfaces.
- Flat section hierarchy with generous main content; no gradients, glass or dashboard widgets.
- Map: dominant quiet canvas + visible location controls. Dashed candidate, solid selected,
  crosshair pin; textual legends and status labels repeat these distinctions.
- Interview: native radio/checkbox controls, explicit Continue, one question, optional rationale.
- Review: own words / location / characteristics / timeline / function / candidates / safety.
- History: body region filter → episodes → dated details; no invented health metrics.
- Responsive: full location workbench on desktop, stacked at tablet/mobile; no horizontal page scroll.

## References consumed

- Existing AnatomyAdapter and in-repo SVG geometry: reuse the seam and hit-shape data;
  do not add 3D or unverified medical geometry.
- Infermedica body-avatar article: map plus text alternatives; no diagnostic features adopted.
  https://infermedica.com/blog/articles/the-role-of-body-avatars-in-symptom-checkers-and-how-to-work-with-them
- NHS design-system radios: native labelled choices and explicit progression; existing question
  wording/options/rationale stay verbatim. No third-party source code/assets copied.
  https://service-manual.nhs.uk/design-system/components/radios

## Verification plan

Run original and redesigned real flows against a separate offline server/database.
Desktop 1440, tablet 768, mobile 375; keyboard flow; vague description; transport failure;
empty/history; multi/text/boolean/single; saved summary; no domain path diff.
All repository-required checks before commits, plus final typecheck/test/web build.
