import { useMemo, useState } from 'react';
import {
  getStructure,
  REGIONS,
  showcaseNote,
  TISSUE_LAYER_ORDER,
  isShowcaseRegion,
} from '@asi/shared';
import type { BodyRegion, Depth, Side, TissueLayer } from '@asi/shared';
import type { DerivedViewName } from '@asi/shared';
import { anatomy, useSession } from '../state/session.ts';
import { intentFromPick, reducePickToDraft } from './pick-intent.ts';
import type { MapPoint, PickResult } from './types.ts';
import { Derived2dShoulderMap } from './Derived2dShoulderMap.tsx';
import {
  VIEW_H,
  VIEW_W,
  VIEW_DETAILS,
  bodyToUser,
  clientToBody,
  nearestZone,
  sideTransform,
  silhouetteFor,
  zonesForRegionView,
} from './svg-geometry.ts';
import { REGION_DEFAULT_VIEW, VIEW_LABEL } from './svg2d.ts';
import { sidePhrase } from '../ui/presentation.ts';
import { Body3d } from './Body3d.tsx';
import type { ViewName } from './types.ts';
import { ChoiceGroup } from '../ui/primitives.tsx';

type Inspector = 'area' | 'structures';
type Surface = '3d' | '2d' | 'anatomy2d';

/**
 * Which product surface the workspace is showing.
 *
 * `2d` is the hand-authored body silhouette. `anatomy2d` is the derived
 * orthographic shoulder map. They are separate because they answer different
 * questions and neither replaces the other:
 *
 *   2d        where on the BODY -- an area, on a whole figure
 *   anatomy2d what STRUCTURE -- the shoulder itself, with tissue layers
 *
 * `anatomy2d` is only offered for the showcase region, because derived views only
 * exist where geometry was derived. Offering a body silhouette and calling it the
 * anatomy view would be the dishonest version of this, and it is what the product
 * used to do.
 */
const ANATOMY2D_REGION: BodyRegion = 'shoulder';

/** Map the product's view vocabulary onto the derived renderer's. */
const DERIVED_VIEW: Partial<Record<ViewName, DerivedViewName>> = {
  anterior: 'front',
  posterior: 'back',
  lateral_left: 'left',
  lateral_right: 'right',
};

const VIEW_OPTIONS: { value: ViewName; label: string }[] = [
  { value: 'anterior', label: 'Front' },
  { value: 'posterior', label: 'Back' },
  { value: 'lateral_left', label: 'Left side' },
  { value: 'lateral_right', label: 'Right side' },
];

/**
 * The felt words the roadmap asks the depth interaction to support.
 *
 * "Near the surface", "in between", "deep inside" and "not sure" are chosen
 * because they are things a person says, not because they name tissue. The
 * domain enum has exactly these four values and this UI must not invent a fifth:
 * a `depthQualifier` would let it say "not the skin", and that is a domain
 * change, requested in docs/design/v1-product-audit.md rather than invented here.
 */
const DEPTH_OPTIONS: { value: Depth; label: string; hint: string }[] = [
  { value: 'superficial', label: 'Near the surface', hint: 'Close to the skin.' },
  { value: 'intermediate', label: 'In between', hint: 'Neither near the skin nor deep inside.' },
  { value: 'deep', label: 'Deep inside', hint: 'Well below the surface.' },
  { value: 'unknown', label: 'Not sure', hint: 'You could say either way.' },
];

const SIDE_OPTIONS: { value: Side; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'midline', label: 'Centre' },
  { value: 'bilateral', label: 'Both sides' },
  { value: 'unknown', label: 'Not sure' },
];

/**
 * What each depth actually shows, in words a person would use.
 *
 * The old UI listed raw tissue names — "muscle, tendon, ligament, joint, bone" —
 * which reads as an anatomical claim the product has not made and cannot make
 * from a feeling. These are descriptions of the SLICE, not of what is involved.
 *
 * Keyed by `Depth` rather than by `string` on purpose: a `Record<string, string>`
 * compiles just as happily with a key the enum does not have, and the missing
 * entry would render as `undefined` in front of a user.
 */
const DEPTH_EFFECT: Record<Depth, string> = {
  superficial: 'the outermost layers are shown',
  intermediate: 'the middle layers are shown',
  deep: 'the deeper layers are shown',
  unknown: 'every layer is shown, because no depth has been established',
};

/**
 * 3D is offered on wide viewports only. A phone gets the 2D map by default: it
 * loads instantly, needs no GPU, and the whole point of the phone layout is
 * that the body is the first thing you see, not a canvas that has to warm up.
 * The toggle is always available, so this is a default and not a wall.
 */
function defaultSurface(): Surface {
  if (typeof window === 'undefined') return '2d';
  return window.innerWidth >= 900 ? '3d' : '2d';
}

export function BodyMap() {
  const {
    record,
    viewerTick,
    pinAt,
    selectSubRegion,
    setSide,
    setDepth,
    select,
    deselect,
    reject,
    setStage,
    orchestratorKind,
  } = useSession();
  void viewerTick;
  const location = record.location;
  const region = REGIONS[location.region];
  const [view, setView] = useState<ViewName>(REGION_DEFAULT_VIEW[location.region]);
  /*
    Seeded from the RECORD, not from null.
    
    The pending area used to start empty on every mount, so returning to Locate
    after choosing an area showed the recorded area on the map while leaving
    every sub-region button unpressed, the receipt reading "No area chosen yet",
    and the primary action disabled. The user had to re-choose an area they had
    already chosen just to get back to where they were. The record is the
    authority on where they were; the draft starts from it.
  */
  const [pendingSub, setPendingSub] = useState<string | null>(
    location.subRegionId ?? null,
  );
  const [pendingPoint, setPendingPoint] = useState<MapPoint | null>(location.point ?? null);
  const [inspector, setInspector] = useState<Inspector>('area');
  const [layer, setLayer] = useState('all');
  const [surface, setSurface] = useState<Surface>(defaultSurface);
  /**
   * Whether 3D is genuinely up. The 2D map is shown unless it is, so a failed
   * canvas cannot leave the panel blank: gating the map on the user's REQUEST
   * for 3D is exactly how both surfaces end up hidden at once.
   */
  const [threeDReady, setThreeDReady] = useState(false);
  const [announced, setAnnounced] = useState('');
  /**
   * Whether the showcase region's derived anatomy map is available at all.
   *
   * Checked from the region rather than the viewport, so it is a property of what
   * was built instead of a screen-size guess. A frozen region simply has no
   * derived views, and the toggle is not offered rather than offered and failing.
   */
  const hasDerivedViews = location.region === ANATOMY2D_REGION;
  const derivedView: DerivedViewName = DERIVED_VIEW[view] ?? 'front';

  const showThreeD = surface === '3d' && threeDReady;
  /** The derived anatomy map, when it is the requested surface and has views. */
  const showDerived = surface === 'anatomy2d' && hasDerivedViews;
  /** The hand-authored body silhouette: the area picker, and every fallback. */
  const showSchematic = !showThreeD && !showDerived;

  const candidates = record.consideredStructures;
  const selected = location.userSelectedStructureIds;
  const rejected = anatomy.getState().rejectedStructureIds;
  const visibleLayers = anatomy.getState().visibleLayers;
  const mirror = sideTransform(location.side === 'right' ? 'right' : 'left');
  const silhouette = silhouetteFor(view);
  const details = VIEW_DETAILS[view] ?? [];
  const side = location.side === 'right' ? 'right' : 'left';
  const zones = useMemo(() => zonesForRegionView(location.region, view), [location.region, view]);
  const candidateLayers = [
    ...new Set(
      candidates
        .map((c) => getStructure(c.structureId)?.layer)
        .filter((v): v is TissueLayer => v !== undefined),
    ),
  ];
  const chosen = region.subRegions.find((s) => s.id === pendingSub);
  /** The area already committed to the record, which is not the same as a draft. */
  const recorded = region.subRegions.find((s) => s.id === location.subRegionId);

  /** Sub-region ids that have a tool suggestion, for the candidate highlight. */
  const subRegionsWithCandidate = new Set(
    candidates
      .map((c) => {
        if (rejected.includes(c.structureId)) return undefined;
        return region.subRegions.find((sub) =>
          sub.structures.some((structure) => structure.id === c.structureId),
        )?.id;
      })
      .filter((id): id is string => Boolean(id)),
  );

  function chooseSub(id: string) {
    setPendingSub(id);
    setAnnounced(`${region.subRegions.find((s) => s.id === id)?.label ?? id} selected`);
    // Move to a view that actually shows the chosen sub-region, so the map
    // confirms the choice instead of contradicting it.
    if (!zonesForRegionView(location.region, view).some((zone) => zone.subRegionId === id)) {
      const target = anatomy.viewForSubRegion(id);
      if (target) changeView(target);
    }
  }

  function changeView(next: ViewName) {
    setView(next);
    anatomy.apply({ type: 'setView', view: next });
    setAnnounced(`${VIEW_LABEL[next]} view`);
  }

  function handleMapClick(event: React.MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = clientToBody(event.clientX, event.clientY, rect);
    setPendingPoint(point);
    // Nearest-zone resolution: a thumb aims at the knee, not at a 4-unit
    // polygon, so a tap near a zone selects it.
    const hit = nearestZone(point, location.region, view, side);
    if (hit) chooseSub(hit.subRegionId);
    else setAnnounced('No area matched that point. Use the area buttons to choose.');
  }

  /**
   * Apply a 3D pick. This is the AUTHORITATIVE write path for a click on real
   * geometry, and it lives here rather than in the viewer host because the viewer
   * host knows nothing about the record.
   *
   * A click on a structure is a visual LOCATION action, so two things follow and
   * they are deliberately different in kind:
   *
   *   - the structure is selected immediately, through `select`, which writes the
   *     canonical `location.userSelectedStructureIds`. That is the same immediate
   *     behaviour as the inspector's "Indicate this structure" button, because it is
   *     the same act and it is unambiguous.
   *
   *   - the AREA and the surface POINT are staged as a draft, exactly as a 2D map
   *     click stages them, and are committed by "Use this location" through
   *     `selectSubRegion` and `pinAt`. Staging rather than writing them is what lets
   *     an unresolved sub-region leave the user with a choice to make instead of a
   *     value the tool picked for them — and the confirm button stays disabled until
   *     an area exists.
   *
   * The point IS treated as a user pin, not discarded: clicking real geometry is a
   * user indicating a place on their body. It carries no tissue and no diagnostic
   * meaning — it is `location.point` and nothing else, and the receipt keeps saying
   * "location indication, not a clinical finding".
   */
  function handlePick(hit: PickResult) {
    // The RECORD's sub-region and side, so a pick that contradicts a side the user
    // already confirmed is refused rather than applied. See pickSideAgreement.
    const intent = intentFromPick(hit, location.subRegionId ?? null, location.side);
    const effect = reducePickToDraft(
      intent,
      { subRegionId: pendingSub, point: pendingPoint },
      location.subRegionId ?? null,
    );

    if (effect.draft.subRegionId !== pendingSub && effect.draft.subRegionId) {
      // Goes through chooseSub so the view follows, exactly as every other area
      // choice does. Deliberately NOT taken when nothing was resolved, which is what
      // keeps an unresolved pick from acquiring the first of its candidates.
      chooseSub(effect.draft.subRegionId);
    } else if (effect.draft.subRegionId !== pendingSub) {
      setPendingSub(effect.draft.subRegionId);
    }
    if (effect.draft.point) setPendingPoint(effect.draft.point);

    if (effect.selectStructureId) {
      // Immediate, because it is unambiguous and it is the whole point of the 3D
      // viewer. The canonical authority stays location.userSelectedStructureIds;
      // `select` writes exactly that and mirrors it to the viewer.
      select(effect.selectStructureId);
    }
    // Always announce, including for an unresolved pick: the structure selection
    // stands and the user has to be told the area is still theirs to choose.
    setAnnounced(effect.announce);
  }

  return (
    <section className="location-workbench" aria-label="Anatomical workspace">
      {/*
        ORIENTATION. The region is the answer to "what part of the body am I
        looking at", so it is the largest text on this screen — which it was not,
        while the page heading outranked it by a wide margin.
      */}
      <div className="orientation">
        <div className="orientation__where">
          <span className="eyebrow">
            {recorded ? 'Your recorded location' : 'Suggested starting area'}
          </span>
          <h2 className="orientation__region">{region.label}</h2>
          <p className="orientation__state">
            <span>{sidePhrase(location.side)}</span>
            <span aria-hidden="true"> · </span>
            <span>
              {location.depth === 'unknown'
                ? 'Depth not established'
                : DEPTH_OPTIONS.find((d) => d.value === location.depth)?.label}
            </span>
            <span aria-hidden="true"> · </span>
            <span>{VIEW_LABEL[view]}</span>
          </p>
        </div>
        <blockquote className="orientation__words">{location.userPhrase}</blockquote>
        <div className="orientation__source">
          <span className="small">
            {orchestratorKind === 'model'
              ? 'Model suggestion'
              : 'Offline rules suggestion'}{' '}
            · please check
          </span>
          <button className="link" onClick={() => setStage('describe')}>
            Edit description
          </button>
        </div>
      </div>

      {/*
        The bench grid opens HERE rather than after the controls, so side and
        depth become a rail column instead of a full-width band above the map.

        That band was 266px tall on a desktop and 446px on a phone, which put
        every zone except the shoulder below the fold: at 1440x1000 the knee sat
        at y=1136 and at 375x812 nothing was reachable at all. The map is the
        instrument this screen exists for, and it was the only thing you could
        not see. In the rail it is always on screen, never scrolled to, and it
        still reads left-to-right as "what you are looking at" then "what you
        can change about it".
      */}
      <div className="location-workbench__grid">
        <div className={`viewer-panel${showThreeD ? ' viewer-panel--3d' : ''}`}>
          <div className="viewer-toolbar">
            <div className="viewer-toolbar__views">
              <ChoiceGroup
                label="Body view"
                value={view}
                options={VIEW_OPTIONS}
                onChange={changeView}
              />
              <ChoiceGroup
                label="Viewer"
                value={surface}
                options={[
                  { value: '3d', label: '3D' },
                  // The derived anatomy map is offered only where it exists. A
                  // toggle that is present and then fails is worse than one that
                  // is not there.
                  ...(hasDerivedViews
                    ? [{ value: 'anatomy2d' as const, label: 'Anatomy maps' }]
                    : []),
                  { value: '2d', label: 'Body map' },
                ]}
                onChange={(next) => {
                  setSurface(next);
                  setAnnounced(
                    next === '3d'
                      ? 'Showing the 3D viewer. The other maps are always available.'
                      : next === 'anatomy2d'
                        ? 'Showing the anatomy maps. You can switch layers and tap a structure.'
                        : 'Showing the body map, for choosing an area.',
                  );
                }}
              />
            </div>
            {/*
              The mode label is the second most important fact on this screen, so
              it is a real element with real weight — not a caption that happened
              to be there.

              It used to read "3D · fixture volumes" above real CC-BY BodyParts3D
              geometry. That was not a stale label, it was a false statement: it
              told the user the anatomy they were looking at was placeholder,
              which is the one thing the product's strongest asset is not.
            */}
            <p className="viewer-toolbar__label" data-testid="surface-label">
              {showThreeD ? 'Real 3D anatomy' : showDerived ? 'Anatomy maps · BodyParts3D' : 'Body map'}
            </p>
          </div>
          <div className="viewer-canvas">
            <div className="viewer-caption" hidden={showThreeD || showDerived}>
              <span className="eyebrow">Schematic</span>
              <strong>{region.label}</strong>
              <span>{VIEW_LABEL[view]}</span>
            </div>
            <Body3d
              active={surface === '3d'}
              side={location.side}
              region={location.region}
              onPick={handlePick}
              onStatus={(next) => {
                setThreeDReady(next.mode === '3d');
                // Only a real failure moves the toolbar. The workspace emits a
                // "not ready yet" status while mounting, and treating that as a
                // failure would cancel the mount that was still in flight.
                const gaveUp =
                  next.mode === '2d' &&
                  next.ready &&
                  next.fallbackReason !== null &&
                  next.fallbackReason !== 'user-choice';
                if (gaveUp) setSurface((current) => (current === '3d' ? '2d' : current));
              }}
            />
            {/*
              THE DERIVED ANATOMY MAP. Real BodyParts3D orthographic renders with a
              hit grid, so a tap in 2D resolves to the same structure a click in 3D
              does. This is the first 2D surface in the product that can indicate a
              STRUCTURE; the schematic below can only indicate an area.
            */}
            {showDerived && (
              <Derived2dShoulderMap
                view={derivedView}
                selectedCanonicalIds={selected}
                onAnnounce={setAnnounced}
                onSelect={({ canonicalAsiId }) => {
                  if (canonicalAsiId) select(canonicalAsiId);
                }}
              />
            )}
            {/*
              The body map stays mounted even when another surface has it, so a
              context loss has something to fall back to and the region controls
              never depend on a canvas being alive.
            */}
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              className={`bodymap__svg${showThreeD || showDerived ? ' is-hidden' : ''}`}
              data-testid="bodymap-2d"
              role="img"
              aria-hidden={showThreeD ? 'true' : undefined}
              aria-label={`${region.label}, schematic ${VIEW_LABEL[view].toLowerCase()} view. Use the area buttons for keyboard selection.`}
              onClick={handleMapClick}
            >
              <g className="bodymap__body">
                {Object.entries(silhouette).map(([key, d]) => (
                  <path key={key} d={d} />
                ))}
              </g>
              <g className="bodymap__details">
                {details.map((detail) => (
                  <path key={detail.part} d={detail.d} strokeWidth={detail.weight} />
                ))}
              </g>
              <g className="bodymap__zones" transform={mirror ?? undefined}>
                {zones.map((zone) => {
                  const d = zone.shapes[view];
                  if (!d) return null;
                  const isPending = pendingSub === zone.subRegionId;
                  const isRecorded = location.subRegionId === zone.subRegionId;
                  const hasCandidate = subRegionsWithCandidate.has(zone.subRegionId);
                  return (
                    <g key={zone.subRegionId} data-subregion={zone.subRegionId} className="bodymap__zone">
                      <title>{zone.label}</title>
                      <path
                        d={d}
                        data-testid={`zone-${zone.subRegionId}`}
                        className={`bodymap__zone-shape${
                          isPending ? ' is-active' : ''
                        }${isRecorded ? ' is-recorded' : ''}${
                          !isPending && !isRecorded && hasCandidate ? ' has-candidate' : ''
                        }`}
                      />
                    </g>
                  );
                })}
              </g>
              {pendingPoint && (
                <g
                  className="bodymap__pin"
                  transform={`translate(${bodyToUser(pendingPoint).join(' ')})`}
                >
                  <circle r="3.5" />
                  <path d="M -6 0 H -2 M 2 0 H 6 M 0 -6 V -2 M 0 2 V 6" />
                </g>
              )}
            </svg>
            {/*
              Surface-specific, and VISIBLE. This was hidden exactly when 3D was
              up — the one surface where a tap on real geometry is how a structure
              is chosen, and where there is no zone to tap near.
            */}
            {/*
              Hidden on the derived map, which carries its own truth line. Both
              would sit at the bottom of the same stage and overlap, and the
              derived map's version is the one that names what it actually is.
            */}
            {!showDerived && (
              <span className="canvas-instruction">
                {showThreeD
                  ? 'Tap a structure to indicate where you mean. The area buttons below always work.'
                  : 'Tap near an area, or use the buttons. A pin marks an approximate point.'}
              </span>
            )}
          </div>
          <p className="sr-only" role="status">
            {announced}
          </p>
          <div className="viewer-foot">
            {/*
              The legend describes the 2D map's marks. Above a 3D viewer it was
              describing marks that are not on screen, so it is 2D-only now.
            */}
            {!showThreeD && !showDerived && (
              <ul className="map-legend" aria-label="Map legend">
                <li>
                  <span className="legend-mark legend-mark--candidate" />
                  Suggested
                </li>
                <li>
                  <span className="legend-mark legend-mark--selected" />
                  Your area
                </li>
                <li>
                  <span className="legend-mark legend-mark--recorded" />
                  Saved
                </li>
                <li>
                  <span aria-hidden="true">＋</span>Pin
                </li>
              </ul>
            )}
            {/*
              Surface-specific truth, and it no longer repeats the side — the
              orientation bar above already states it, and three copies of one
              fact at three sizes is how the fact stops being an answer.

              The old line said "Schematic only: it does not show tissue" on BOTH
              surfaces, including above a real 3D viewer that was showing tissue.
              That contradicted the attribution panel three inches to its right
              and told the user the product's real anatomy was a placeholder.
            */}
            <p className="small viewer-foot__truth" data-testid="surface-truth">
              {showThreeD ? (
                <>
                  Real anatomy geometry, shown for orientation. Indicating a
                  structure says where you mean — never what is involved.
                </>
              ) : showDerived ? (
                <>
                  Real anatomy, rendered from BodyParts3D and labelled in plain
                  language. Indicating a structure says where you mean — never
                  what is involved.
                </>
              ) : (
                <>
                  A schematic. It locates an area; it does not show tissue.
                </>
              )}
            </p>
          </div>
        </div>
        {/*
          SIDE AND DEPTH, always visible, and after the map in the DOM so the
          reading order matches the visual one: what you are looking at, then
          what you can change about it.

          They used to live behind a "Side & depth" inspector tab, which is a
          third-level control for two of the four facts a screen like this has to
          be able to answer at a glance. They are on an anatomical scale — one
          dimension, not two unrelated settings — so they read as one scale here.

          Depth's consequence is stated in words rather than as a list of tissue
          names. "muscle, tendon, ligament, bone" reads as an anatomical claim; the
          user reported a feeling and the viewer is showing a slice.
        */}
        <div className="location-controls">
          <ChoiceGroup
            label="Which side"
            value={location.side}
            options={SIDE_OPTIONS}
            onChange={(next) => {
              setSide(next);
              setAnnounced(`Side set to ${sidePhrase(next).toLowerCase()}`);
            }}
          />
          <ChoiceGroup
            label="How deep does it feel"
            value={location.depth}
            options={DEPTH_OPTIONS.map(({ value, label }) => ({ value, label }))}
            onChange={(next) => {
              setDepth(next);
              setAnnounced(
                next === 'unknown'
                  ? 'Depth not established, so every layer is shown'
                  : `Depth set: ${DEPTH_OPTIONS.find((d) => d.value === next)?.hint}`,
              );
            }}
          />
          <p className="location-controls__effect" data-testid="depth-effect">
            <span className="eyebrow">What that shows you</span>
            {DEPTH_EFFECT[location.depth]}. Depth is how the feeling reads, not a
            tissue — it changes what you can see, never what the record claims is
            involved.
          </p>
          <ul className="location-controls__layers" aria-label="Layers currently shown">
            {TISSUE_LAYER_ORDER.filter((l) => visibleLayers.includes(l)).map((l) => (
              <li key={l} data-testid={`visible-layer-${l}`}>
                {l}
              </li>
            ))}
          </ul>
        </div>
        <aside className="location-inspector" aria-label="Location tools">
          <div className="inspector-switch" role="group" aria-label="Location tools">
            {(
              [
                ['area', 'Area & pin'],
                ['structures', 'Structures'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} aria-pressed={inspector === id} onClick={() => setInspector(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="inspector-body">
            {inspector === 'area' && (
              <section>
                <span className="eyebrow">Where do you mean?</span>
                <h3>Choose an area</h3>
                {recorded && (
                  <p className="recorded-note" data-testid="recorded-area">
                    Recorded on this episode: <strong>{recorded.label}</strong>
                  </p>
                )}
                <div className="subregion-options">
                  {region.subRegions.map((sub) => {
                    const drawable = zonesForRegionView(location.region, view).some(
                      (z) => z.subRegionId === sub.id,
                    );
                    const isRecorded = location.subRegionId === sub.id;
                    return (
                      <button
                        key={sub.id}
                        className={`subregion-option${isRecorded ? ' is-recorded' : ''}`}
                        aria-pressed={pendingSub === sub.id}
                        onClick={() => chooseSub(sub.id)}
                      >
                        <span>{sub.label}</span>
                        <span className="subregion-option__hint">
                          {isRecorded
                            ? '✓ recorded'
                            : pendingSub === sub.id
                              ? '✓ chosen'
                              : drawable
                                ? 'on this view'
                                : '↗'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <details className="pin-controls">
                  <summary>Fine positioning · optional pin</summary>
                  <p className="small">A pin is an approximate mark, not a structure.</p>
                  <button className="btn" onClick={() => setPendingPoint({ x: 0.5, y: 0.5 })}>
                    Place pin at centre
                  </button>
                  {pendingPoint && (
                    <>
                      <label>
                        Horizontal position
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={Math.round(pendingPoint.x * 100)}
                          onChange={(event) =>
                            setPendingPoint({ ...pendingPoint, x: Number(event.target.value) / 100 })
                          }
                        />
                      </label>
                      <label>
                        Vertical position
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={Math.round(pendingPoint.y * 100)}
                          onChange={(event) =>
                            setPendingPoint({ ...pendingPoint, y: Number(event.target.value) / 100 })
                          }
                        />
                      </label>
                    </>
                  )}
                </details>
              </section>
            )}
            {inspector === 'structures' && (
              <section>
                <span className="eyebrow">Optional detail</span>
                <h3>Structure suggestions</h3>
                <p className="small">
                  Indicating a structure says where you mean. It is not a finding.
                </p>
                {candidateLayers.length > 0 && (
                  <label className="layer-filter">
                    Tissue filter
                    <select value={layer} onChange={(event) => setLayer(event.target.value)}>
                      <option value="all">All tissues</option>
                      {candidateLayers.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!candidates.length && (
                  <p className="candidate-empty">
                    No structure suggestions were returned. Continue with your approximate area.
                  </p>
                )}
                <ul className="candidates__list">
                  {candidates
                    .filter((c) => layer === 'all' || getStructure(c.structureId)?.layer === layer)
                    .map((c) => {
                      const structure = getStructure(c.structureId);
                      if (!structure) return null;
                      const isSelected = selected.includes(c.structureId);
                      const isRejected = rejected.includes(c.structureId);
                      return (
                        <li
                          key={c.structureId}
                          data-testid={`candidate-${c.structureId}`}
                          className={`candidate-item${
                            isSelected ? ' candidate-item--selected' : ''
                          }${isRejected ? ' candidate-item--rejected' : ''}`}
                        >
                          {/*
                            The origin label is the whole point of this list, so it
                            comes FIRST and is a real state, not a prefix buried
                            above the title.
                          */}
                          <span
                            className={`candidate-item__origin${
                              isSelected ? ' is-selected' : isRejected ? ' is-rejected' : ''
                            }`}
                          >
                            {isSelected
                              ? '✓ You indicated this'
                              : isRejected
                                ? '✕ Not this one'
                                : '◇ Tool suggestion · not indicated yet'}
                          </span>
                          <h4>{structure.layTerm || structure.label}</h4>
                          {structure.layTerm && <p className="small">{structure.label}</p>}
                          {isRejected ? (
                            <button
                              className="link"
                              onClick={() =>
                                anatomy.apply({ type: 'clearReject', structureIds: [c.structureId] })
                              }
                            >
                              Bring this suggestion back
                            </button>
                          ) : (
                            /*
                              These two were adjacent links with nothing between
                              them and read as one string — "Indicate this
                              structureNot this one" — in the screenshot at every
                              width. They are now a real action row.
                            */
                            <div className="candidate-item__actions">
                              <button
                                className="btn btn--small"
                                aria-pressed={isSelected}
                                onClick={() =>
                                  isSelected ? deselect(c.structureId) : select(c.structureId)
                                }
                              >
                                {isSelected
                                  ? 'Remove visual selection'
                                  : 'Indicate this structure'}
                              </button>
                              {!isSelected && (
                                <button
                                  className="link link--quiet"
                                  onClick={() => reject(c.structureId)}
                                >
                                  Not this one
                                </button>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </section>
            )}
          </div>
        </aside>
      </div>
      {/*
        The primary action and the reason it is unavailable, TOGETHER. They were
        900px apart: the status bottom-left, the button bottom-right, and a third
        statement of the same fact in muted grey inside the inspector.
      */}
      <div className="location-footer">
        <button
          className="btn btn--primary"
          disabled={!pendingSub}
          onClick={() => {
            if (!pendingSub) return;
            if (pendingPoint) pinAt(pendingPoint);
            selectSubRegion(pendingSub);
          }}
        >
          Use this location &amp; continue <span aria-hidden="true">→</span>
        </button>
        <div role="status" className="location-footer__why">
          {chosen ? (
            <p>
              <strong>✓ {chosen.label}</strong>
              <span className="small">
                {selected.length > 0
                  ? ` · ${selected.length} structure${selected.length === 1 ? '' : 's'} indicated`
                  : ' · no structure indicated yet'}
                {pendingPoint ? ' · pin placed' : ''}
              </span>
            </p>
          ) : (
            <p>
              <strong>Choose an approximate area to continue</strong>
              <span className="small">
                {selected.length > 0
                  ? `${selected.length} structure${selected.length === 1 ? '' : 's'} indicated, waiting on an area.`
                  : 'Use the buttons, or tap near an area.'}
              </span>
            </p>
          )}
          <span className="small">A location indication, not a clinical finding.</span>
        </div>
      </div>
      <p className="sr-only" data-testid="selection-receipt">
        {pendingSub
          ? `${region.subRegions.find((s) => s.id === pendingSub)?.label ?? pendingSub} · ${selected.length} visual structure selection${selected.length === 1 ? '' : 's'} · ${pendingPoint ? 'pin placed' : 'no pin'}`
          : `No area chosen yet · ${selected.length} visual structure selection${selected.length === 1 ? '' : 's'} · ${pendingPoint ? 'pin placed' : 'no pin'}`}
      </p>
    </section>
  );
}