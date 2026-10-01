# Phase 1A — Anatomy Workspace

`phase1/anatomy-workspace`, from `origin/main` at `1f2f26e`. Presentation and
front-end only: `packages/shared`, `packages/server`, `scripts`, the database,
provenance and safety rules are untouched.

## What this phase is, and what it is not

It is **3D viewer infrastructure plus a rebuilt 2D fallback**, not anatomy.

The honest state of the viewer before this phase was a schematic silhouette used
as a hit-target system: one drawing reused for front and back, no side views,
overlapping sub-region zones, and a `rejectedStructureIds` field in viewer state
that no command could ever set. That is a placeholder, and the phase does not
pretend otherwise.

What exists now:

- `Three3dAnatomyAdapter`, a real renderer behind the existing
  `AnatomyAdapter` state contract.
- A **manifest** as the only bridge between a business id and a piece of
  geometry.
- A **fixture manifest**: procedurally generated primitive volumes, explicitly
  not a body, with a disclaimer the UI is required to show.
- A **2D map** rebuilt as a locating interface in its own right — the mobile,
  accessibility and low-power path, not a downgrade.
- **Depth wired to the viewer**: felt depth changes visible layers and nothing
  else.
- A **fallback that cannot white-screen**, verified in a real browser.
- A **spatial history read model** as a frontend consumption boundary.

What does **not** exist, and will not until the asset pipeline does: any
anatomically meaningful mesh. Nothing in the 3D viewer is a claim about a body.

## 3D architecture

### The identity rule

No engine handle ever becomes a business identifier. `Three3dAnatomyAdapter`
holds its meshes in a private `Map<asiId, Object3D>`; `pick()` resolves a
raycast straight back to an `asiId` plus domain ids and returns them. A
`PickResult` is specified to carry no mesh, no UUID and no engine-space
coordinate. This is what makes a renderer swap, a mesh reload or a re-parented
scene unable to invalidate a stored selection.

`viewerState` therefore contains only ids the domain already owns. A test
asserts no `asiId` matches a UUID or an `ObjectN` pattern.

### The manifest seam

`apps/web/src/anatomy/manifest.ts` is the **renderer scene contract** — how a
piece of geometry is handed to the viewer: which mesh, which views, which tissue
layer, roughly where to point the camera. It is what lets the renderer contract
be built and tested before any real asset exists, and it is the only thing that
knows how an `asiId` relates to geometry.

It is **not** the production asset manifest, and must not be cited as one:

- Asset **identity, provenance and licensing** are domain concerns. They belong
  to the canonical shared manifest,
  `packages/shared/src/anatomy-manifest.ts`, landing with `phase1/core-foundation`.
- The web manifest deliberately carries **no licence, no source attestation and
  no asset provenance**. It cannot answer "may we ship this?" and is not meant to.
- On integration, an **adapter converts the canonical manifest into this scene
  shape**. The renderer keeps consuming the scene contract and changes nothing.

Phase 1A does not copy, merge or re-implement the canonical manifest, and
reconciling the two is explicitly left to integration.

```ts
interface ManifestEntry {
  asiId: string;            // stable, namespaced, renderer-agnostic
  kind: 'subregion' | 'structure';
  region: BodyRegion;
  subRegionId?: string;     // must exist in the ontology
  structureId?: string;     // must exist in the ontology
  layer: TissueLayer;
  views: CameraPreset[];
  geometry:
    | { type: 'primitive'; shape: ...; position: ...; scale: ... }
    | { type: 'url'; url: string; nodeName?: string; ... };
  focusPoint?: MapPoint;
}
```

Two guards make a fixture impossible to mistake for anatomy:

- `assertNonMedical` rejects a `source: 'fixture'` manifest that has no
  disclaimer or that references an external asset.
- `verifyAgainstOntology` rejects any entry naming a sub-region or structure the
  domain does not define, so an asset cannot make the viewer highlight
  something the record cannot store.

### One state authority

`AnatomyWorkspace` does **not** own viewer state. The session's adapter does; 3D
is a projection of it. This project has already paid for two writable copies of
one fact once, with selection, so a renderer here may read state and report a
pick, but only the source is ever written to. `project()` replays whole state
rather than diffing, because a viewer that missed an event must still be correct.

### Camera and framing

Four presets (`anterior`, `posterior`, `lateral_left`, `lateral_right`) at four
distinct stations, asserted distinct in a test. Distance is derived from the
focused region's own bounding sphere rather than fixed, so a region fills the
field instead of floating in it, and framing is recomputed on resize because it
depends on aspect.

`lateral_left` puts the camera on the figure's left flank. Whether that maps to
the *patient's* left on screen is a mirroring question, not something this
adapter guesses at — see the handoff.

### Fallback

`start()` always resolves. A missing GPU, an invalid manifest, a throwing mount
and a lost context all land on the 2D map with a plain sentence saying why, and
`BodyMap` shows the map unless 3D is *genuinely* rendering. `fallback.mjs` forces
each path in a real browser and requires the map to be visible and Locate to stay
completable.

The `webglcontextlost` listener is bound to the **canvas**, because that event
does not bubble and a listener on the host would never see it.

## 2D improvements

Still a hit-target and orientation system, not an atlas — but a usable one.

- **Per-view silhouettes.** Front, back (with scapula and spine marks) and two
  genuinely mirrored side profiles. The old geometry reused one drawing for front
  and back, so the view control told the user nothing.
- **No overlapping zones.** Two real defects fixed: `neck.lateral` and
  `neck.posterior` sat 2 units apart in the side profile, and `knee.anterior`
  and `knee.posterior` shared a centroid exactly, so one silently swallowed the
  other. Sub-regions a profile cannot honestly distinguish no longer claim
  lateral views.
- **Only the focused region is drawn.** The old map rendered every sub-region's
  targets at once, so a shoulder view showed knee and neck boxes on the body.
- **Side is expressed by the drawing.** Zones are authored once for the figure's
  left and mirrored with a transform, so there is no second hand-kept copy to
  drift. `nearestZone` mirrors the *centroid* and never the tap: mirroring both
  would make the function invariant to side, and choosing a side would then have
  no effect on what can be hit.
- **Tappable small zones.** A tap resolves to the nearest zone within a radius
  rather than requiring a pixel-accurate hit.
- **Persisted pin meaning preserved.** The viewBox stays `0 0 100 186` because
  `location.point` is stored against that box; the figure is drawn to fit the
  box rather than moving the box.
- **Rejected suggestions** are a real state: a dismissed suggestion is kept as
  evidence of what was considered, left out of the pickable set, and can be
  brought back. Presentation-only — it is not written to the record.

## Depth interaction

Depth is a report of how deep something *feels*. It changes **layer visibility
and nothing else**:

| felt depth | layers shown |
|---|---|
| near the surface | skin, subcutaneous, fascia |
| in between | subcutaneous, fascia, muscle, tendon |
| deep inside | muscle, tendon, ligament, joint, bone, nerve, vessel |
| not sure | all layers |

It never names or infers a tissue, and it stays separate from any structure
suggestion. The visible layers are listed in the inspector so the link is
visible rather than implied.

A real bug fixed here: depth usually arrives from the user's own words via
localisation, and the localise path never told the viewer, so the record said
"deep inside" while the viewer showed every layer. `syncViewer` now projects it
on every write. Verified by reverting the fix and watching the assertion fail at
all three widths.

## Mobile

2D is the default below 900px. A phone should not wait for a canvas to warm up,
and the whole point of the phone layout is that the body is the first thing you
see. The toggle is always available, so this is a default and not a wall.

Layout is phone-specific rather than a stacked desktop page: anatomy first, three
staged inspector choices, fine positioning behind disclosure, and a sticky
continue. Layer and depth controls are progressive disclosure — depth sits in the
"Side & depth" stage, not on the first screen. The selection receipt is always
visible.

A layout bug fixed here: an inactive 3D host still occupied the full width of the
canvas flex row, pushing the 2D body off-centre at 375px.

## Spatial history

`apps/web/src/ui/spatial-history.ts` is the consumption boundary for the read
model the main agent is building: region → location marks → episode count →
most recent episode → inspect.

It is derived client-side from episodes the API already returns, adds no
persisted field, and is explicitly **not** a second domain schema. A labelled
fixture source stands in until the server read model lands; when it does, this
becomes a fetch and the components do not change.

A mark is region + sub-region + side, never a bare region — "shoulder" cannot
place anything, and the same sub-region on opposite sides is two places. A mark
carries a point only if an episode actually had a pin, so the index never places
something the user did not indicate. "Most recent" means latest by date, not last
fetched. Nothing models severity, score, risk or trend; a test asserts none of
those words appear in the serialised model.

## Tests

| Suite | What it covers |
|---|---|
| `anatomy.test.ts` (32) | manifest guards, `asiId` stability, depth→layer, camera distinctness, keyboard path, 2D geometry invariants including overlap and nearest-zone |
| `spatial-history.test.ts` (11) | grouping, mark identity, recency, no-severity invariant |
| `hit-zones.mjs` | clicks every zone at 1440 and 375; asserts the matching sub-region and that no foreign region is drawn |
| `three3d.mjs` | real WebGL mount, live context, fixture disclaimer, no leaked canvas |
| `fallback.mjs` | no-WebGL, lost context, explicit 2D; map visible and Locate completable in each |
| `evidence.mjs` | depth reaches the viewer from localisation; 20 screenshots, no overflow |
| existing `browser.mjs` / `accessibility.mjs` | unchanged, still green |

Every failure above was found by one of these, not by inspection.

## Evidence

`data/design-phase1-evidence/index.html` (gitignored, local). 20 Phase 1A shots at
1440 / 768 / 375: both surfaces, all four views, depth with the layer list, the
no-WebGL fallback, and the health map with location marks.

## Where the real BodyParts3D manifest lands

The renderer will not need to change. What lands is a manifest and an adapter
that converts it.

**The canonical source of asset truth is not the web manifest.** Once
`phase1/core-foundation` provides `packages/shared/src/anatomy-manifest.ts`, that
is where BodyParts3D asset identity, provenance and licensing are recorded, and
this phase does not duplicate any of it. The web manifest is the scene contract
the renderer consumes.

The integration work is:

1. An adapter reads the **canonical** manifest and emits the scene shape above.
2. `source: 'bodyparts3d'` with `geometry.type: 'url'` plus the asset `url` and,
   when one file holds many parts, the `nodeName` to extract.
3. `asiId` per part, namespaced to the project, with `subRegionId` /
   `structureId` bound to ontology ids. `verifyAgainstOntology` refuses anything
   else, which is the point.
4. `views` per part, so a part is only shown from cameras that can see it.
5. `layer` per part, so felt depth has something to hide.
6. `bounds.height` and `bounds.radius` describing the figure, so camera framing
   works without hardcoded numbers.

`primitive` entries may stay alongside `url` entries during a transition: the
adapter builds what it can and a missing asset is a manifest problem to report,
not a crash.

Licensing is **not** this phase's to record. When BodyParts3D is chosen, its
terms are captured in the canonical shared manifest, not here.
