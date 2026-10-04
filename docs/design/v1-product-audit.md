# V1 product audit — the real product, before any redesign

Branch `design/v1-product-refinement`, from `main` @ `eaf69e9`. This is the audit
the refinement pass is built on. Nothing here is a design proposal yet; it is
what the product does today, observed rather than inferred.

## How this was observed

The app was run against real production anatomy — the four BodyParts3D regions,
the seeded six-episode history — and driven end to end at **375, 768 and 1440**.
No screenshots of the old fixture, no mock, no stubbed scene.

Three harnesses, all reproducible and all committed:

| Script | Answers |
|---|---|
| `scripts/audit-serve.sh` | boots the app on its own ports with a scratch seeded DB |
| `scripts/audit-capture.mjs` | walks the whole flow at three widths, captures every screen, reports horizontal overflow, the 3D state per region, and the exact chrome copy |
| `scripts/audit-interactions.mjs` | two questions a screenshot cannot answer: does a prior selection survive the round trip, and does 3D work at 375 |
| `scripts/audit-copy-truth.mjs` | asserts each on-screen claim against what is actually mounted |

Run: `bash scripts/audit-serve.sh --fresh && bash scripts/audit-capture.sh`.

---

## Headline: what is real, and what the interface says about it

**The 3D viewer is real.** Real BodyParts3D 4.0 geometry, CC BY 4.0, verified
mesh-by-mesh against the archive. It mounts for shoulder, neck, lower_back and
knee at 1440, and it works at 375 and 768 too once asked. Attribution is derived
from the manifest and cannot be hand-typed.

**The interface describes none of that.** On the 3D surface, with a live WebGL
context and real anatomy on screen, the toolbar reads:

> `3D · fixture volumes`

and the footer, in the same breath, reads:

> `Showing your right side. Schematic only: it does not show tissue.`

Both are false. The first says placeholder volumes where there is real anatomy;
the second denies tissue over a viewer that is showing tissue. This is the single
worst finding in the audit: **the product undersells its own strongest asset with
copy inherited from the phase when it had none.** A user reading it concludes the
anatomy is not real, and has no reason to trust the parts that are.

The `legend` (`Suggested · Your area · Saved · ＋Pin`) is likewise 2D-map copy
sitting above a 3D viewer, and the `canvas-instruction` ("Tap near an area, or
use the buttons") is hidden exactly when the 3D surface is up — the one surface
where tapping a mesh is how you select.

---

## Per-screen findings

### Describe — 1440 / 768 / 375

Good: one textarea, one primary action, a visible boundary line ("For symptom
location and organisation. Not diagnosis or treatment."), the supported areas
named. The refusal path is genuinely strong — it quotes the user's words, says
nothing was recorded, and points at a clinician.

- **Hierarchy is inverted at 1440.** "Locate your discomfort" (the page heading)
  outranks "Shoulder" (the actual anatomical answer) by a wide margin. The thing
  the user came to identify is the smallest text on the screen.
- The four-area list is in an aside labelled "Four areas available in this
  prototype. Other symptoms may not be supported." — honest, but it competes
  with the input for attention.
- 375: the header wraps `Personal health map` onto two lines and the brand onto
  two lines. Four lines of chrome before the task.

### Locate — the defining screen, and the weakest

**Information hierarchy.** Region ("Shoulder") is an `h2` inside a "Suggested
starting area" eyebrow, above a `blockquote` of the user's words, with
`Offline rules suggestion · please check` on the right and an `Edit description`
link. Four competing elements where one should dominate: *where am I looking?*

The answer to that question is genuinely hard to find. It is not in the heading
(it says "Locate your discomfort", a task, not a place). It is in the canvas
caption at 12px. It is repeated as `viewer-caption` "Location study / Shoulder /
Front" — a label that appears only on the 2D surface and is hidden on 3D, which
is where you most need it.

**Primary vs secondary action.** `Use this location & continue` is correctly the
only primary button. But it is **disabled and its reason is 900px away**: the
status "Choose an approximate location" sits bottom-left while the button sits
bottom-right, and the inspector's own receipt says "No area chosen yet" in
muted grey. Three statements of the same fact, none adjacent to the control.

**Explicit current side.** Present and correct — `Showing your right side.` —
but as 12px muted text in a footer above a legend, not as part of the region
statement. At 375 and 768 the side is stated *only* there.

**Explicit current depth.** In the `Side & depth` inspector tab, which is a
third-level control. Depth is one of the four questions the roadmap says the user
must always be able to answer, and it is behind a tab labelled with two other
concepts. Worse, the depth control's own output — "Shown in the viewer: muscle,
tendon, ligament, joint, bone, nerve, vessel" — appears as a list of raw tissue
names with no frame, immediately after a "Visibility only" caveat.

**2D / 3D mode hierarchy.** Two radio groups stacked (`Body view`, then
`Viewer`), with a third text label to their right that is the actual source of
truth and the least legible thing in the toolbar. "3D · fixture volumes" /
"Schematic / 2D" is a `span.small`. The mode is the second-most-important fact
on the screen after the region and it is styled as a caption.

**Suggested vs user-selected.** The legend says `Your area` and `Saved` — but
`Saved` means "this is the record's sub-region" and `Your area` means "this is
your pending draft". Those are not a suggestion/selection distinction; they are
draft/committed. Meanwhile the actual suggestion-vs-selection distinction lives
only inside the candidate list, as text prefixes (`◇ Tool suggestion · not
selected` / `✓ Your visual selection`).

**Candidate list.** On 1440 it renders one candidate ("the tendon that runs over
the top of the shoulder joint") with two adjacent links and **no separation
between them**: `Indicate this structureNot this one`. A real defect, visible in
the screenshot.

**Unavailable 3D — the knee.** With side `unknown`, the panel shows:

> `Which side? The 3D viewer shows real anatomy for one side at a time, and
> choosing one here is not a guess this tool will make for you.`

The refusal is correct and well-reasoned. The **presentation is broken**: the
message overlaps the `viewer-caption` ("Location study / Knee / Front"), and both
overlap the 2D body. Three text layers collide at the top-left of the canvas. The
user is told to make a decision, but the control for it (side) is in a different
inspector tab.

**3D at 375 / 768.** Works. `defaultSurface()` picks 2D below 900px, and choosing
3D explicitly mounts a live canvas at 335×240 (375) / 349×380 (768). Two problems:
the anatomy occupies a small band, and the **first area button sits at `top:
1035px` at 375** — below the fold, after the canvas, so the non-3D path to the
primary decision requires a long scroll past a viewer the user did not ask for.

**Horizontal overflow:** none, at any width, on any screen. The layout discipline
is genuinely good.

### Interview — 1440 / 375

Good: the question is the largest text on the screen, the region's own words stay
visible in the sidebar, `Why we ask this` is collapsed, and `I am not sure` is a
peer of Yes/No rather than an afterthought.

- **Progress is a bare number**: `0 of 8 answered`. There is no indication of
  which question you are on, how many remain, or what "answered" means when
  "I am not sure" is a legitimate answer. The domain's `questionProgress`
  distinguishes outstanding from answered; the UI flattens it.
- **The sidebar is a receipt, not a summary**: `Shoulder · right · deep` in raw
  enum casing. `right` and `deep` are domain values leaking into user-facing type.
  The same leak appears in `RecordDetails` (`Side: right`, `Depth: deep`) and in
  the summary (`Depth (patient report) Deep` — one of these is capitalised).
- **"Adjust location" is a bare link** under a receipt. Returning to Locate is a
  normal action, not an escape.
- 375: the sidebar collapses to a bare three-line block with no label. It is not
  obvious that `right · deep` is the current location.

### Review — 1440 / 375

Structurally sound and unusually honest: `Missing information is not a negative
answer.`, `Unanswered questions remain "Not asked"; uncertainty remains "Not
established".`, and a `Change:` link per answered question.

- **Long and flat.** Every section is `<h3>` + `FactList` at the same weight.
  A clinician scanning for location, quality, and safety finds no hierarchy
  between them. Eight `Not asked` rows run consecutively with no visual grouping.
- **"Not saved yet"** is a `StatusTag` next to "Review before saving" — it reads
  as a state the record is *in*, rather than a fact about saving.
- `Change: Did this start after something specific?` — the affordance is a link
  styled identically to every other link on the page, including `Start a new
  episode`. Nothing signals that it returns you to the interview.

### Health map — 1440 / 375

Genuinely good, and better than the rest. The body index carries counts, the
place list is separate from the region list, `Counts reflect saved records, not
symptom severity.` is stated once and correctly, and `Continue this episode` is
the right verb.

- **Episode titles are placeholders**: three seeded episodes all read
  `shoulder — 2026-10-03`, indistinguishable except by date. The user cannot tell
  them apart, so "most recent occurrence" and "open episode" are not actually
  answerable.
- `open` / `resolved` status tags are unstyled raw domain values.
- The place list shows `Front of shoulder · right  3` — a count with no
  "last time" and no way to know which of the three is recent.
- **24 fields not established** in the expanded episode: an accurate wall of
  `not asked`. Truthful, and unscannable.

### Summary — 1440 / 375

The domain summary is authoritative and correct. The presentation is the
weakest screen in the product for a *clinician*, which is the stated audience.

- `summary.chiefComplaint` renders as
  `Shoulder — character not established; not established; duration not asked;
  frequency not asked; trend not asked.` A run-on of semicolons at the top of the
  document, where the user's own words should be.
- `Sources in this record: user statement 5 fields / user selection 1 field` sits
  above the copy button, so provenance and export share a block.
- **The user's own words appear third**, below the anatomical location table.
- At 375 the whole summary is one column of `Not asked` with no visual grouping;
  scanability for the user is poor even though the content is right.

### Refusal — 1440

Correct and well-executed. No findings.

---

## Accessibility — what the audit could and could not confirm

The existing gates pass: axe at 18 scans, hit-zones 30/30, the full
`scripts/final-gates.sh` run is 27 PASS / 0 FAIL / 0 SKIP. So semantics are not
being removed anywhere.

Friction the automated gates do not catch:

- The **canvas instruction is hidden on 3D** — the surface where a keyboard user
  most needs to know that selection happens by picking a mesh, and where the
  `keyboardOrder()` path is the only route.
- **Two disabled-button explanations** (`Use this location`, `Continue`) are
  visually distant from their controls. A screen-reader user tabbing to a disabled
  button gets no reason.
- `role="status"` regions exist for announcements (`.viewer-toolbar` announces
  view changes, `Body3d` announces mode), which is right.
- The candidate list's two adjacent links (`Indicate this structureNot this
  one`) are two tab stops with no separator — announced correctly, read as one
  phrase visually.

---

## What the audit says the priorities actually are

Ranked by how much they cost the user, not by how hard they are:

1. **The interface lies about the anatomy.** `3D · fixture volumes` and
   `Schematic only: it does not show tissue` above real CC-BY geometry. Truth
   defect, and it undermines the product's strongest asset. *Not cosmetic.*
2. **Selection continuity is broken.** Measured, not inferred — after a full round
   trip:
   ```
   recordedZoneInMap:  "zone-shoulder.anterior"   ← the map knows
   activeZoneInMap:    null
   pressedSubRegionButtons: []
   receipt:            "No area chosen yet · 1 visual structure selection · no pin"
   continueEnabled:    false
   ```
   The recorded area is on the map but **no control is pressed and the primary
   action is disabled**. The user must re-choose an area they already chose, to
   get back to where they were. This is the roadmap's "explicit selection marker"
   item, and it is worse than described: it is not a missing marker, it is a
   **disabled primary action that contradicts the screen above it**.
3. **Region / side / depth are not answersable at a glance.** All four of the
   roadmap's questions take work: region is an `h2`, side is 12px muted footer
   text, depth is behind a tab.
4. **Depth has no interaction, only a four-way switch.** `Near the surface /
   In between / Deep inside / Not sure` cannot express "not the skin", "deeper",
   "around the muscle". The domain `Depth` enum has exactly four values, and the
   UI is honest about that — but the roadmap asks for the interaction, and the
   interaction cannot be had with four values. **Capability request below.**
5. **Interview progress is a number.** No position, no outstanding, no clarity
   that "not sure" counts as answered.
6. **Review and summary are flat and long.** Truthful, unscannable, and the
   clinician case is the stated one.
7. **Mobile anatomy workspace pushes its primary decision below the fold.**
8. **Candidate links run together.** Real defect.

---

## Capability requests for the Main Agent

Frontend-owned work cannot honestly deliver these. Each needs a domain decision.

### 1. Depth needs a second axis (blocking for Priority B)

`Depth = 'superficial' | 'intermediate' | 'deep' | 'unknown'` cannot express
"not the skin", "around the muscle", or a *relative* move ("deeper than I said").
Three options, all requiring domain work:

- **Relative depth commands** on the existing enum: `deeper` / `shallower` as
  user actions that move through the existing values. Achievable without a schema
  change, but the *intent* ("not the skin") is still not storable.
- **A `depthQualifier` field**: `null | 'not-skin' | 'around-tissue' | 'deep-inside'`,
  a separate claim about the felt quality, so `Depth` keeps meaning depth and the
  qualifier keeps meaning the user's phrasing. This is the smallest change that
  lets the UI say what the user said.
- **A free-text `depthPhrase`** alongside the enum, unparsed, as provenance. The
  interview already has this shape for `triggerDetail`.

**Recommendation: (2).** It is additive, it does not overload `Depth`'s meaning,
and it is the only one that lets the interface say "not the skin" in the user's
own words. Until then the depth interaction is four buttons, and no amount of
frontend work makes it feel natural.

### 2. Per-field origin status (non-blocking, already partly documented)

`suggested` vs `chosen` per field. The session holds proposed side/depth/subregion
alongside user edits with no per-field interaction status. Needed for precise
origin badges. Frontend will not invent one.

### 3. Episode titles (non-blocking, but it hurts the longitudinal story)

Titles are `"<region> — <date>"`. Three episodes in one region are
indistinguishable, so "most recent occurrence" and "open episode" cannot be read
off the list. Either a title derived from what the user said, or a UI that shows
the distinguishing facts (phrase excerpt, qualities, status) instead of relying on
the title.

### 4. `layTerm` for every V1 structure

Unchanged from the roadmap. Unglamorous, non-negotiable for a clinical audience.

### 5. One place for a field's user-facing wording (non-blocking, found during the pass)

The same field is worded differently on two screens the user sees in the same
session: the review table says `Depth: Deep inside` and the saved summary says
`Depth (patient report): Deep`, because `summary.history` is built by the domain
from `titleCase(record.location.depth)` while the review reads the enum through a
presentation helper.

The frontend deliberately did **not** patch this. Rewriting a domain-produced
value would be a second implementation of the summary, which is exactly the class
of bug `renderPlainText` was centralised to prevent. The fix is for the label/value
pair to come from one place — ideally the same lookup the summary already uses for
`ONSET_LABEL` and `TRIGGER_LABEL`, extended to side and depth.

### 6. Spatial history: does an episode count as "asked"? (non-blocking, found during the pass)

`SpatialHistoryNode` carries `episodeCount` and `lastEpisodeAt`, which is enough to
answer "where have I pointed, and when". It cannot answer "how often did this
actually happen", because a count of records is not a count of occurrences: a
reopened episode updates in place, so one complaint is one record however many
times it was continued. The view therefore labels every number as episodes and
states `Counts reflect saved records, not symptom severity` once. If the product
wants to say anything stronger, the domain has to say it.

---

## What this audit deliberately does not do

- **No medical anatomy is proposed.** The 3D asset is external BodyParts3D; the
  2D map is a declared placeholder and stays one. If the 2D map needs to be better,
  that is an asset requirement, not a drawing task — see
  `docs/design/2d-anatomy-asset-requirement.md`.
- **No screenshot was taken of a fixture.** Every screen above was produced with
  real production scenes mounted.
- **No domain semantics are proposed as design.** Where the domain cannot express
  something truthful, it is listed above as a capability request.