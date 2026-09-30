# ASI V2 — Personal anatomical workspace

Design decision frozen before application edits, 2026-09-30. References and observation limits: [reference pack](reference-pack.md).

## Identity and visual logic

Body → Location → Experience → Episode → History. A body location is the index, a description is the person's account, a structure selection is an indication, never a finding.

One continuous workspace, with a compact header and task context. Typography, alignment, space and tonal differences carry grouping. Borders are reserved for editable fields, precise selection/focus and a small number of major separators. No white-card grid, no progress stepper, no dashboard KPIs.

Palette: paper `#f7f6f2`, anatomical field `#e7e6e0`, graphite `#282a29`, secondary `#60635f`, deliberate muted aubergine `#69485f` for action/selection. Suggestion uses dashed ochre-gray lines and explicit words. Pin uses a crosshair. Safety amber/red remains reserved for supplied safety messages; errors have an explicit failure heading. No gradient or glass.

System sans (`Segoe UI`, system-ui) with practical record typography. Task title 28px/1.2, section 22px, question 22–26px, anatomical label 18px, body/input16px/1.5, metadata14px, annotations12px. 4/8/12/16/24/32/48px spacing; 44px minimum action target; content width 1320px, reading column 680–760px. Radius 4px controls, no rounded page containers. Shadows only for dialogs if necessary. Focus: 3px visible outline offset 3px; reduced-motion respected. Native radio/checkbox/select/summary retained.

## Spatial composition

Desktop Locate: 60% anatomical field + 40% contextual inspector (bounded ~420px), body scaled to the available height. Title/region is part of the workspace context; viewport tools sit at its edge. Approximate location choices are direct map companions. Side/depth are compact context controls. Structure candidates are optional, collapsed, and never replace the user's location. Mobile: anatomy first, then a three-part local inspector (Area / Side & depth / Structures); only current panel visible. Pin fine positioning is disclosure; primary continue stays sticky. No gesture dependency. Tablet preserves canvas/inspector when legible, otherwise uses staged mobile controls.

The current silhouette stays schematic; no claim of 3D, side mirroring or tissue-depth rendering. The viewer adapter remains the seam for future assets. Explicit legend explains what each mark means.

## Wire compositions

| Screen | Primary object / action | Secondary information | Persistent | Visually removed |
|---|---|---|---|---|
| Entry | Own-words field / Locate | Four supported areas, short workflow sentence | Product + health map, non-diagnostic boundary | Hero marketing, repeated explanatory cards, stepper |
| Locate | Large body field / Use location | Contextual inspector, optional candidates | User words, suggested source, area/selection distinction | Equal-width form, full candidate grid, tall question-like stack |
| Details | Current question / Continue | Rationale disclosure, answered count | Slim current-area context, review shortcut, safety | Survey progress bar, multiple questions, promotional rail |
| Review | Own account grouped by meaning / Save | Unanswered or uncertain data stated literally | Location and user words, safety | Giant enclosing card, fabricated negatives |
| Saved summary | Document hierarchy / Copy or print | Provenance, unused suggestions, earlier episodes | Safety boundary, generated date | App dashboard styling, candidates promoted to findings |
| Health map | Body-region index / Select area | Episodes in date order; open one to read | Region label, episode dates/counts | KPI widgets, generic filter sidebar as the primary object |
| Unsupported | Original words + refusal / Edit description | Supported scope | Product, no-region/no-record statement | Default body highlight, MSK questions, success styling |
| Error | Failed action + retained input / Retry | Technical detail disclosure | Existing record, original workflow context | Blank replacement screen, silent fallback result |
| Mobile Locate | Body then local inspector / sticky Continue | Only selected control stage, fine pin disclosure | Selection receipt + body-view limitations | Desktop panels stacked in full |

## Current design patterns to remove

Reviewed V1 `data/design-evidence/location-desktop.png` and recorded V1 screens as anti-reference.

| Pattern | Replacement |
|---|---|
| Numbered SaaS stepper | Compact task context, no numbered milestones |
| White cards everywhere | Open page/tonal anatomical field, document sections |
| Borders around every region | Space and baseline alignment; selection borders have meaning |
| Enterprise navy | Graphite and one muted aubergine interaction accent |
| Nested containers | One canvas/inspector relationship, flat record sections |
| 40px generic task headlines | 28px task title, stronger anatomical context |
| Dashboard history | Body region index connected to dated episodes |
| Secondary anatomy thumbnail | Dominant workspace field with larger schematic |
| Empty outer gutters | Broad workspace and narrower intentional reading columns |
| Badges/pills for routine metadata | Plain small labels; explicit selection text only |
| Repeated heading/subtitle/card templates | Entry editor, spatial Locate, focused question, document, body index |
| Form-heavy Locate | Context controls and staged mobile inspector |
| Long mobile candidate stack | Optional structures panel; disclosure before detail |
| Candidate appears validated after click | “Visual selection / location, not finding”; reversible selection |
| Large progress bar | Quiet answered count, incomplete states stated clearly |

## Integration and semantic guardrails

Bring current hardened main into this branch only. Preserve shared/server, schema, state/session.ts and state/logic.ts exactly from main. Presentation uses `answers`, `safety`, `refusal`, `clarification`, `select/deselect`, `userSelectedStructureIds`, `visualSelections`, `unselectedSuggestions` and localisation `by` as supplied. No rendering of negative schema defaults as patient answers. Reuse domain summary/coverage output where available; raw answer display must retain unknown/not-asked distinction. No changed prompts or safety guidance.

## QA gates

First inspect actual desktop/mobile Locate before extending the language. Then all ten requested states at 375/768/1440, keyboard-only path, focus, no overflow, selection/deselection, unknown answers, unsupported exit, retained errors, print/copy. Required commands: typecheck, tests, smoke, web build. Evidence stays under ignored `data/design-v2-evidence/`; final report links it. No push or merge into main.
