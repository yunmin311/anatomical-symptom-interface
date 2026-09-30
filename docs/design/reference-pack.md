# ASI V2 — reference observations

Studied 2026-09-30, before implementation. Public product imagery is evidence, not an asset library. Screenshots are local research only in ignored `data/v2-references/`; no external anatomy or branding is redistributed in the app. Values below are visual relationships, not claimed measurements of native app tokens. Unknown states are explicitly unknown.

## A. Apple Health

Source: https://support.apple.com/en-sg/104997 — actual embedded Health Highlights screen, inspected in `apple-detail.png`.

- Typography/scale: compact sans, small navigation title, stronger section name, medium narrative, larger key values. Spacing: tight within a fact, wider between topics.
- Composition/width: single narrow phone column. Surfaces/radius: white rounded topic groups on tinted ground; internal dividers are subtle; no conspicuous shadow.
- Color: black narrative, gray supporting labels, saturated category/plot marks. Controls/navigation: small chevrons, persistent bottom destinations. Information is larger than the chrome.
- Selection/feedback: selected Summary destination has icon, text and tint. No keyboard focus, loading or error observed. iPad adaptation described by source but not visually inspected. No anatomy surface here.
- Adopt: narrative before metadata, content hierarchy, small persistent context. Reject: copying card stacks, floating navigation, category rainbow. ASI's spatial task needs one open canvas.

## B. Oura

Source: https://ouraring.com/blog/new-oura-app-experience/ — Today and My Health screenshots, `oura-detail.png`, `oura-health.png`. My Health image was displayed at 300 CSS px for legibility; this is not a native size measurement.

- Sans type; modest app title, much larger personal interpretation, tiny date/context. Comfortable vertical rhythm; narrow phone column.
- Dark tonal groups, rounded corners, no hard internal borders. Tree/landscape and glow dominate the hero; white narrative dominates metrics. Bottom navigation separates present-day and longer-term views.
- Longitudinal line carries a time story below a sentence; controls are secondary. Selected destination uses filled icon and label. Interactive focus/feedback, error/empty and desktop app adaptation were not observed. Anatomy not present.
- Adopt: history belongs to the person and has time context. Region → dated episodes, with the user's words prominent. Reject: readiness scores, scenery, glow, invented trends, motivational health interpretation. ASI only has recorded episodes.

## C. Linear (Raycast considered, not used as a product anchor)

Source: https://linear.app/docs/select-issues — embedded product screenshot plus documented keyboard behavior, `linear-selection.png`. Also inspected https://linear.app/features and https://www.raycast.com/; their marketing pages do not establish in-product interaction details.

- Product screenshot: small sans rows, restrained weight changes, aligned compact columns; the row rhythm is much tighter than topic spacing. Wide desktop surface with narrow navigation.
- Flat dark surfaces, few divider lines, small control radii, negligible row shadows. Selected rows use both a checkbox and muted purple fill; icons remain supporting.
- Documentation distinguishes hover/highlight from selection and describes keyboard selection. We did not run the app, so actual focus outline/animation timing is unknown. Docs 404 was observed (`linear-product.png`): quiet centered message, persistent navigation. Mobile product adaptation/anatomy not observed.
- Adopt: distinct focus/selection, stable alignment, compact action rows, explicit selection toggle. Reject: developer sidebar, issue board, dark SaaS shell, hidden hover-only controls or tiny targets. ASI keeps 44px interaction targets.

## D. BioDigital Human

Source: https://support.biodigital.com/hc/en-us/articles/360005542733-What-is-the-Anatomy-Tree ; official attachment https://support.biodigital.com/hc/article_attachments/33610989957271 . Article browser hit challenge; attachment successfully inspected as `biodigital-product.png`.

- Small sans labels; modest tree heading, compact indented rows. Large anatomy canvas occupies roughly three-fifths of the product image; the tree stays narrow and flat.
- Light canvas, white inspector, restrained separators; tiny radii; shadows only on floating tools. Color concentrates on anatomy/selected area, with a separate tinted selected tree row.
- Tool rail touches the viewport; tree disclosure maintains context. Selection associates the named structure with the body. Visibility icons belong to the selected row. Documentation explains expand/search/isolate/fade; live feedback not tested.
- Empty/error/focus/mobile appearance unknown. Adopt: canvas dominance and contextual inspector, names tied to spatial target. Reject: editor ribbon, model library, full ontology tree, cyan medical findings implication. ASI suggestions must remain tentative.

## E. Complete Anatomy

Sources: https://3d4medical.com/ and https://3d4medical.com/professional . Public product/video imagery, `complete-detail.png` and `complete-professional.png` (where available). App Store link redirected to a general storefront in this environment and is NOT product evidence.

- Homepage poster shows anatomy occupying the presentation surface beneath a very thin title strip. The enlarged anatomical object, not a surrounding form, establishes focus.
- Distinguish website from product: huge marketing headline, teal CTA and dark gradient are site styling, not an ASI reference. Native type scale, exact spacing, radius, border/shadow tokens and mobile control behavior cannot be established from this poster.
- Adopt only the directly visible object-first scale relationship. Layer naming/selection interaction, keyboard focus and error states need a richer demo and are not asserted from this evidence. Reject proprietary models, realism claims, educational feature scope, marketing shell.

## Translation to ASI (implementation rules, not source claims)

1. Give Locate a continuous mineral-gray canvas and a narrow inspector, not two equal cards. Desktop canvas target: 60% of width.
2. Bring location controls next to the body; keep advanced pin and structure controls behind explicit disclosure/staged views on phones.
3. Differentiate suggestion (dashed contour + label), approximate area (solid contour + check), structure indication (checkbox + wording), pin (crosshair), uncertainty (plain explicit text), safety/error (label + message).
4. Keep question content at readable width with a quiet location context. No score or survey completion celebration.
5. Present dated personal history through a body-region index. Do not manufacture charts from sparse records.
6. Use 28/22/18/16/14/12px roles, 4/8/12/16/24/32/48 spacing, 44px minimum controls. These are ASI decisions, not copied native tokens.
7. Preserve all server-authored safety text and coverage states. Reference aesthetics never override uncertainty.

## Evidence limits

Static screenshots establish composition, not interaction correctness. None of these screenshots proves live accessibility, loading behavior or responsive breakpoints. ASI must independently verify those. No optional fashionable references were added.

## Observation follow-up

Complete Anatomy professional page was also inspected (`complete-professional.png`): the Library
example places an anatomical neck close-up between compact dark supporting panels; the 3D Models
example uses a skeleton on a dark open field with peripheral tools. ASI adopts the object/context
ratio, not those educational controls or anatomy assets. Selection/focus behavior remains unknown.

## Materialised reference decisions

- BioDigital: `BodyMap` places the canvas at 60% of the desktop workspace; supporting controls are a bounded inspector. No editor ribbon copied.
- Apple: record sections use heading/label/value hierarchy and minimal separators; actions remain below the content. Its white rounded topic-card stack was rejected.
- Oura: `BodyIndex` leads into region-specific dated episodes. No fabricated score, graph or interpretation.
- Linear: inspector controls keep a stable baseline and explicit pressed state; native choices give a visible selection marker independent of tint. No issue-management shell.
- Complete Anatomy: the larger body object shares its surface with peripheral viewport controls. The simplistic existing body asset remains an explicit limitation.
