import { useMemo, useState } from 'react';
import { getStructure, REGIONS, TISSUE_LAYER_ORDER } from '@asi/shared';
import type { TissueLayer } from '@asi/shared';
import { anatomy, useSession } from '../state/session.ts';
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
import { Body3d } from './Body3d.tsx';
import type { ViewName } from './types.ts';
import { ChoiceGroup } from '../ui/primitives.tsx';

type Inspector = 'area' | 'feeling' | 'structures';
type Surface = '3d' | '2d';

const VIEW_OPTIONS: { value: ViewName; label: string }[] = [
  { value: 'anterior', label: 'Front' },
  { value: 'posterior', label: 'Back' },
  { value: 'lateral_left', label: 'Left side' },
  { value: 'lateral_right', label: 'Right side' },
];

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
  const [pendingSub, setPendingSub] = useState<string | null>(null);
  const [pendingPoint, setPendingPoint] = useState(location.point);
  const [inspector, setInspector] = useState<Inspector>('area');
  const [layer, setLayer] = useState('all');
  const [surface, setSurface] = useState<Surface>(defaultSurface);
  /**
   * Whether 3D is genuinely up. The 2D map is shown unless it is, so a failed
   * canvas cannot leave the panel blank: gating the map on the user's REQUEST
   * for 3D is exactly how both surfaces end up hidden at once.
   */
  const [threeDReady, setThreeDReady] = useState(false);
  const showThreeD = surface === '3d' && threeDReady;
  const [announced, setAnnounced] = useState('');

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

  return (
    <section className="location-workbench" aria-label="Anatomical workspace">
      <div className="location-context">
        <div>
          <span className="eyebrow">Suggested starting area</span>
          <h2>{region.label}</h2>
        </div>
        <blockquote>{location.userPhrase}</blockquote>
        <div className="location-source">
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
                  { value: '2d', label: '2D map' },
                ]}
                onChange={(next) => {
                  setSurface(next);
                  setAnnounced(
                    next === '3d'
                      ? 'Showing the 3D viewer. The 2D map is always available.'
                      : 'Showing the 2D body map.',
                  );
                }}
              />
            </div>
            <span className="small viewer-toolbar__label">
              {showThreeD ? '3D · fixture volumes' : 'Schematic / 2D'}
            </span>
          </div>
          <div className="viewer-canvas">
            {/* On the 3D surface the caption would sit on top of the canvas and
                repeat what the toolbar and inspector already say. */}
            <div className="viewer-caption" hidden={showThreeD}>
              <span className="eyebrow">Location study</span>
              <strong>{region.label}</strong>
              <span>{VIEW_LABEL[view]}</span>
            </div>
            <Body3d
              active={surface === '3d'}
              onSubRegion={chooseSub}
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
              The 2D map stays mounted even when 3D has the surface, so a context
              loss has something to fall back to and the region controls never
              depend on a canvas being alive.
            */}
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              className={`bodymap__svg${showThreeD ? ' is-hidden' : ''}`}
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
                          isPending
                            ? ' is-active'
                            : isRecorded
                              ? ' is-recorded'
                              : hasCandidate
                                ? ' has-candidate'
                                : ''
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
            <span className="canvas-instruction">
              Tap near an area, or use the buttons.
              <br />
              A pin marks an approximate point.
            </span>
          </div>
          <p className="sr-only" role="status">
            {announced}
          </p>
          <div className="viewer-foot">
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
            <p className="small">
              {location.side === 'unknown'
                ? 'Side not set — the drawing shows one side and mirrors when you choose.'
                : `Showing your ${location.side} side.`}{' '}
              Schematic only: it does not show tissue.
            </p>
          </div>
        </div>
        <aside className="location-inspector" aria-label="Location controls">
          <div className="inspector-switch" role="group" aria-label="Location tools">
            {(
              [
                ['area', 'Area & pin'],
                ['feeling', 'Side & depth'],
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
                <span className="eyebrow">Your approximate location</span>
                <h3>Where do you mean?</h3>
                <p className="small">Choose on the schematic or use a location below.</p>
                <div className="subregion-options">
                  {region.subRegions.map((sub) => {
                    const drawable = zonesForRegionView(location.region, view).some(
                      (z) => z.subRegionId === sub.id,
                    );
                    return (
                      <button
                        key={sub.id}
                        className="subregion-option"
                        aria-pressed={pendingSub === sub.id}
                        onClick={() => chooseSub(sub.id)}
                      >
                        <span>{sub.label}</span>
                        <span className="subregion-option__hint">
                          {pendingSub === sub.id ? '✓' : drawable ? 'on this view' : '↗'}
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
            {inspector === 'feeling' && (
              <section>
                <span className="eyebrow">Your spatial description</span>
                <h3>Side and depth</h3>
                <p className="small">
                  These describe what you feel; they do not identify tissue.
                </p>
                <ChoiceGroup
                  label="Your side"
                  value={location.side}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'right', label: 'Right' },
                    { value: 'midline', label: 'Centre' },
                    { value: 'bilateral', label: 'Both sides' },
                    { value: 'unknown', label: 'Not sure' },
                  ]}
                  onChange={setSide}
                />
                <ChoiceGroup
                  label="Where does it feel?"
                  value={location.depth}
                  options={[
                    { value: 'superficial', label: 'Near the surface' },
                    { value: 'intermediate', label: 'In between' },
                    { value: 'deep', label: 'Deep inside' },
                    { value: 'unknown', label: 'Not sure' },
                  ]}
                  onChange={setDepth}
                />
                {/*
                  Depth is wired to the viewer: it decides which layers the map
                  and the 3D viewer are showing. It is a report of how deep
                  something FEELS, so it only ever changes visibility and never
                  names a tissue.
                */}
                <div className="depth-layers">
                  <span className="eyebrow">Shown in the viewer</span>
                  <ul>
                    {TISSUE_LAYER_ORDER.filter((l) => visibleLayers.includes(l)).map((l) => (
                      <li key={l} data-testid={`visible-layer-${l}`}>
                        {l}
                      </li>
                    ))}
                  </ul>
                  <p className="small">
                    {location.depth === 'unknown'
                      ? 'Depth not established, so every layer is shown.'
                      : 'Visibility only. Nothing here says which tissue is involved.'}
                  </p>
                </div>
              </section>
            )}
            {inspector === 'structures' && (
              <section>
                <span className="eyebrow">Optional detail</span>
                <h3>Structure suggestions</h3>
                <p className="small">
                  Selecting a structure indicates where you mean. It is not a finding.
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
                          <span className="small">
                            {isSelected
                              ? '✓ Your visual selection'
                              : isRejected
                                ? '✕ Not this one'
                                : '◇ Tool suggestion · not selected'}
                          </span>
                          <h4>{structure.layTerm || structure.label}</h4>
                          {structure.layTerm && <p className="small">{structure.label}</p>}
                          {isRejected ? (
                            <button
                              className="link"
                              onClick={() => anatomy.apply({ type: 'clearReject', structureIds: [c.structureId] })}
                            >
                              Bring this suggestion back
                            </button>
                          ) : (
                            <button
                              className="link"
                              aria-pressed={isSelected}
                              onClick={() =>
                                isSelected ? deselect(c.structureId) : select(c.structureId)
                              }
                            >
                              {isSelected
                                ? 'Remove visual selection'
                                : 'Indicate this structure'}
                            </button>
                          )}
                          {!isSelected && !isRejected && (
                            <button
                              className="link link--quiet"
                              onClick={() => reject(c.structureId)}
                            >
                              Not this one
                            </button>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </section>
            )}
          </div>
          <div className="inspector-receipt">
            <span className="eyebrow">Current description</span>
            <p>
              {location.side === 'unknown' ? 'Side not established' : location.side} ·{' '}
              {location.depth === 'unknown' ? 'depth not established' : location.depth}
            </p>
            <p className="small" data-testid="selection-receipt">
              {pendingSub
                ? `${region.subRegions.find((s) => s.id === pendingSub)?.label ?? pendingSub}`
                : 'No area chosen yet'}{' '}
              · {selected.length} visual structure selection
              {selected.length === 1 ? '' : 's'} · {pendingPoint ? 'pin placed' : 'no pin'}
            </p>
          </div>
        </aside>
      </div>
      <div className="location-footer">
        <div role="status">
          <strong>{chosen ? `✓ ${chosen.label}` : 'Choose an approximate location'}</strong>
          <span className="small">Location indication, not a clinical finding.</span>
        </div>
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
      </div>
    </section>
  );
}
