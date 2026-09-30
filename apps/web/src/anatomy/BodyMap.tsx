import { useState } from 'react';
import { getStructure, REGIONS } from '@asi/shared';
import { anatomy, useSession } from '../state/session.ts';
import { BODY_SILHOUETTE, toMapPoint } from './svg2d.ts';
import type { ViewName } from './svg2d.ts';
import { ChoiceGroup } from '../ui/primitives.tsx';

type Inspector = 'area' | 'feeling' | 'structures';
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
    setStage,
    orchestratorKind,
  } = useSession();
  void viewerTick;
  const location = record.location,
    region = REGIONS[location.region];
  const [view, setView] = useState<ViewName>(
    location.region === 'lower_back' ||
      location.subRegionId?.endsWith('posterior')
      ? 'posterior'
      : 'anterior',
  );
  const [pendingSub, setPendingSub] = useState<string | null>(null);
  const [pendingPoint, setPendingPoint] = useState(location.point);
  const [inspector, setInspector] = useState<Inspector>('area');
  const [layer, setLayer] = useState('all');
  const shapes = anatomy.shapesForRegion(location.region, view);
  const candidates = record.consideredStructures;
  const selected = location.userSelectedStructureIds;
  const layers = [
    ...new Set(
      candidates
        .map((c) => getStructure(c.structureId)?.layer)
        .filter((v) => v !== undefined),
    ),
  ];
  const chosen = region.subRegions.find((s) => s.id === pendingSub);
  function chooseSub(id: string) {
    setPendingSub(id);
    if (!shapes.some((s) => s.subRegionId === id))
      setView(
        anatomy
          .shapesForRegion(location.region, 'posterior')
          .some((s) => s.subRegionId === id)
          ? 'posterior'
          : 'anterior',
      );
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
        <div className="viewer-panel">
          <div className="viewer-toolbar">
            <ChoiceGroup
              label="Body view"
              value={view}
              options={[
                { value: 'anterior', label: 'Front' },
                { value: 'posterior', label: 'Back' },
              ]}
              onChange={(v) => {
                setView(v);
                anatomy.apply({ type: 'setView', view: v });
              }}
            />
            <span className="small">Schematic / 2D</span>
          </div>
          <div className="viewer-canvas">
            <div className="viewer-caption">
              <span className="eyebrow">Location study</span>
              <strong>{region.label}</strong>
              <span>{view === 'anterior' ? 'Front view' : 'Back view'}</span>
            </div>
            <svg
              viewBox="0 0 100 186"
              className="bodymap__svg"
              role="img"
              aria-label={`${region.label}, schematic ${view === 'anterior' ? 'front' : 'back'} view. Use location buttons for keyboard selection.`}
              onClick={(e) => {
                setPendingPoint(
                  toMapPoint(
                    e.clientX,
                    e.clientY,
                    e.currentTarget.getBoundingClientRect(),
                  ),
                );
                const target = (e.target as SVGElement).closest(
                  '[data-subregion]',
                ) as SVGElement | null;
                if (target?.dataset.subregion)
                  setPendingSub(target.dataset.subregion);
              }}
            >
              <g className="bodymap__body">
                {Object.entries(BODY_SILHOUETTE).map(([key, d]) => (
                  <path key={key} d={d} />
                ))}
              </g>
              <g className="bodymap__zones">
                {shapes.map((shape) => (
                  <g
                    key={shape.subRegionId}
                    data-subregion={shape.subRegionId}
                    className="bodymap__zone"
                  >
                    <title>{shape.label}</title>
                    <path
                      d={shape.d}
                      className={`bodymap__zone-shape ${pendingSub === shape.subRegionId ? 'is-active' : location.subRegionId === shape.subRegionId || candidates.some((c) => region.subRegions.find((sub) => sub.id === shape.subRegionId)?.structures.some((structure) => structure.id === c.structureId)) ? 'has-candidate' : ''}`}
                    />
                  </g>
                ))}
              </g>
              {pendingPoint && (
                <g
                  className="bodymap__pin"
                  transform={`translate(${pendingPoint.x * 100} ${pendingPoint.y * 186})`}
                >
                  <circle r={3.5} />
                  <path d="M -6 0 H -2 M 2 0 H 6 M 0 -6 V -2 M 0 2 V 6" />
                </g>
              )}
            </svg>
            <span className="canvas-instruction">
              Choose an area.
              <br />
              Mark an approximate point if helpful.
            </span>
          </div>
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
                <span aria-hidden="true">＋</span>Pin
              </li>
            </ul>
            <p className="small">
              Side and depth are recorded separately; this schematic does not
              mirror them.
            </p>
          </div>
        </div>
        <aside className="location-inspector" aria-label="Location controls">
          <div
            className="inspector-switch"
            role="group"
            aria-label="Location tools"
          >
            {(
              [
                ['area', 'Area & pin'],
                ['feeling', 'Side & depth'],
                ['structures', 'Structures'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                aria-pressed={inspector === id}
                onClick={() => setInspector(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="inspector-body">
            {inspector === 'area' && (
              <section>
                <span className="eyebrow">Your approximate location</span>
                <h3>Where do you mean?</h3>
                <p className="small">
                  Choose on the schematic or use a location below.
                </p>
                <div className="subregion-options">
                  {region.subRegions.map((sub) => (
                    <button
                      key={sub.id}
                      className="subregion-option"
                      aria-pressed={pendingSub === sub.id}
                      onClick={() => chooseSub(sub.id)}
                    >
                      <span>{sub.label}</span>
                      <span aria-hidden="true">
                        {pendingSub === sub.id ? '✓' : '↗'}
                      </span>
                    </button>
                  ))}
                </div>
                <details className="pin-controls">
                  <summary>Fine positioning · optional pin</summary>
                  <p className="small">
                    A pin is an approximate mark, not a structure.
                  </p>
                  <button
                    className="btn"
                    onClick={() => setPendingPoint({ x: 0.5, y: 0.5 })}
                  >
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
                          onChange={(e) =>
                            setPendingPoint({
                              ...pendingPoint,
                              x: Number(e.target.value) / 100,
                            })
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
                          onChange={(e) =>
                            setPendingPoint({
                              ...pendingPoint,
                              y: Number(e.target.value) / 100,
                            })
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
              </section>
            )}
            {inspector === 'structures' && (
              <section>
                <span className="eyebrow">Optional detail</span>
                <h3>Structure suggestions</h3>
                <p className="small">
                  Selecting a structure indicates where you mean. It is not a
                  finding.
                </p>
                {layers.length > 0 && (
                  <label className="layer-filter">
                    Tissue filter
                    <select
                      value={layer}
                      onChange={(e) => setLayer(e.target.value)}
                    >
                      <option value="all">All tissues</option>
                      {layers.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!candidates.length && (
                  <p className="candidate-empty">
                    No structure suggestions were returned. Continue with your
                    approximate area.
                  </p>
                )}
                <ul className="candidates__list">
                  {candidates
                    .filter(
                      (c) =>
                        layer === 'all' ||
                        getStructure(c.structureId)?.layer === layer,
                    )
                    .map((c) => {
                      const structure = getStructure(c.structureId);
                      if (!structure) return null;
                      const isSelected = selected.includes(c.structureId);
                      return (
                        <li
                          key={c.structureId}
                          className={`candidate-item ${isSelected ? 'candidate-item--selected' : ''}`}
                        >
                          <span className="small">
                            {isSelected
                              ? '✓ Your visual selection'
                              : '◇ Tool suggestion · not selected'}
                          </span>
                          <h4>{structure.layTerm || structure.label}</h4>
                          {structure.layTerm && (
                            <p className="small">{structure.label}</p>
                          )}
                          <button
                            className="link"
                            aria-pressed={isSelected}
                            onClick={() =>
                              isSelected
                                ? deselect(c.structureId)
                                : select(c.structureId)
                            }
                          >
                            {isSelected
                              ? 'Remove visual selection'
                              : 'Indicate this structure'}
                          </button>
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
              {location.side === 'unknown'
                ? 'Side not established'
                : location.side}{' '}
              ·{' '}
              {location.depth === 'unknown'
                ? 'depth not established'
                : location.depth}
            </p>
            <p className="small">
              {selected.length} visual structure selection
              {selected.length === 1 ? '' : 's'} ·{' '}
              {pendingPoint ? 'pin placed' : 'no pin'}
            </p>
          </div>
        </aside>
      </div>
      <div className="location-footer">
        <div role="status">
          <strong>
            {chosen ? `✓ ${chosen.label}` : 'Choose an approximate location'}
          </strong>
          <span className="small">
            Location indication, not a clinical finding.
          </span>
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
          Use this location & continue <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
