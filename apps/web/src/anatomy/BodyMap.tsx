import { useState } from 'react';
import { getStructure, REGIONS } from '@asi/shared';
import { anatomy, useSession } from '../state/session.ts';
import { BODY_SILHOUETTE, toMapPoint } from './svg2d.ts';
import type { ViewName } from './svg2d.ts';
import { ChoiceGroup, StatusTag } from '../ui/primitives.tsx';

export function BodyMap() {
  const {
    record,
    viewerTick,
    pinAt,
    confirmSubRegion,
    setSide,
    setDepth,
    confirmStructure,
    setStage,
    orchestratorKind,
  } = useSession();
  void viewerTick;
  const location = record.location;
  const region = REGIONS[location.region];
  const [view, setView] = useState<ViewName>(
    location.region === 'lower_back' ||
      location.subRegionId?.endsWith('posterior')
      ? 'posterior'
      : 'anterior',
  );
  const [pendingSub, setPendingSub] = useState<string | null>(null);
  const [pendingPoint, setPendingPoint] = useState(location.point);
  const [layer, setLayer] = useState('all');
  const shapes = anatomy.shapesForRegion(location.region, view);
  const candidates = record.consideredStructures;
  const layers = [
    ...new Set(
      candidates
        .map((c) => getStructure(c.structureId)?.layer)
        .filter((v) => v !== undefined),
    ),
  ];
  const filtered = candidates.filter(
    (c) => layer === 'all' || getStructure(c.structureId)?.layer === layer,
  );
  const selected = location.userConfirmedStructureIds;
  const selectedSub = region.subRegions.find((sub) => sub.id === pendingSub);
  const suggestedSub = region.subRegions.find(
    (sub) => sub.id === location.subRegionId,
  );

  function chooseSub(id: string) {
    setPendingSub(id);
    const shape = anatomy
      .shapesForRegion(location.region, 'posterior')
      .find((s) => s.subRegionId === id);
    if (shape && !shapes.some((s) => s.subRegionId === id))
      setView('posterior');
    else if (!shapes.some((s) => s.subRegionId === id)) setView('anterior');
  }

  return (
    <section
      className="location-workbench"
      aria-label="Check anatomical location"
    >
      <div className="location-workbench__bar">
        <div>
          <StatusTag kind="candidate">Suggested area</StatusTag>
          <h2>{region.label}</h2>
        </div>
        <button className="link" onClick={() => setStage('describe')}>
          Edit description
        </button>
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
              onChange={(value) => {
                setView(value);
                anatomy.apply({ type: 'setView', view: value });
              }}
            />
            <span className="small">2D schematic</span>
          </div>
          <div className="viewer-canvas">
            <svg
              viewBox="0 0 100 186"
              className="bodymap__svg"
              aria-label={`${region.label}, schematic ${view === 'anterior' ? 'front' : 'back'} view. Use location buttons for keyboard selection.`}
              role="img"
              onClick={(event) => {
                setPendingPoint(
                  toMapPoint(
                    event.clientX,
                    event.clientY,
                    event.currentTarget.getBoundingClientRect(),
                  ),
                );
                const target = (event.target as SVGElement).closest(
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
                {shapes.map((shape) => {
                  const sub = region.subRegions.find(
                    (s) => s.id === shape.subRegionId,
                  );
                  const hasCandidate = candidates.some(
                    (c) =>
                      !selected.includes(c.structureId) &&
                      sub?.structures.some((s) => s.id === c.structureId),
                  );
                  return (
                    <g
                      key={shape.subRegionId}
                      data-subregion={shape.subRegionId}
                      className="bodymap__zone"
                    >
                      <title>{shape.label}</title>
                      <path
                        d={shape.d}
                        className={`bodymap__zone-shape ${hasCandidate || location.subRegionId === shape.subRegionId ? 'has-candidate' : ''} ${pendingSub === shape.subRegionId ? 'is-active' : ''}`}
                      />
                    </g>
                  );
                })}
              </g>
              {pendingPoint && (
                <g
                  className="bodymap__pin"
                  transform={`translate(${pendingPoint.x * 100} ${pendingPoint.y * 186})`}
                >
                  <circle r={4} className="bodymap__pin-halo" />
                  <circle r={2.2} className="bodymap__pin-dot" />
                  <path
                    d="M -6 0 H -3 M 3 0 H 6 M 0 -6 V -3 M 0 3 V 6"
                    stroke="var(--accent)"
                    strokeWidth=".8"
                  />
                </g>
              )}
            </svg>
            <div className="viewer-caption">
              <strong>{region.label}</strong>
              <span>{view === 'anterior' ? 'Front view' : 'Back view'}</span>
            </div>
          </div>
          <ul className="map-legend" aria-label="Map legend">
            <li>
              <span className="legend-mark legend-mark--candidate" />
              Suggested area
            </li>
            <li>
              <span className="legend-mark legend-mark--selected" />
              Your selection
            </li>
            <li>
              <span aria-hidden="true">＋</span>Your pin
            </li>
          </ul>
          <p className="small">
            This schematic does not show tissue depth or mirror the side you
            choose. Set your own side in the controls.
          </p>
          <details className="pin-controls">
            <summary>Place or adjust a pin with the keyboard</summary>
            <p className="small">
              A pin is an approximate mark on this view. It does not identify a
              structure.
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
                    onChange={(event) =>
                      setPendingPoint({
                        ...pendingPoint,
                        x: Number(event.target.value) / 100,
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
                    onChange={(event) =>
                      setPendingPoint({
                        ...pendingPoint,
                        y: Number(event.target.value) / 100,
                      })
                    }
                  />
                </label>
              </>
            )}
          </details>
        </div>
        <div className="location-controls">
          <div className="location-source">
            <p className="small">Your words</p>
            <blockquote>{location.userPhrase}</blockquote>
            <p className="small">
              {orchestratorKind === 'model'
                ? 'Model-proposed starting point'
                : 'Starting point from offline rules'}
              . Please check it.
            </p>
          </div>
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
          <fieldset className="choice-group">
            <legend>Choose the closest location</legend>
            <p className="small">
              {suggestedSub
                ? `Suggested: ${suggestedSub.label}. Select a location to check it.`
                : 'Choose on the map or use these buttons.'}
            </p>
            <div className="subregion-options">
              {region.subRegions.map((sub) => (
                <button
                  key={sub.id}
                  className={`subregion-option ${pendingSub === sub.id ? 'subregion-option--selected' : ''}`}
                  aria-pressed={pendingSub === sub.id}
                  onClick={() => chooseSub(sub.id)}
                >
                  <span>{sub.label}</span>
                  <span aria-hidden="true">
                    {pendingSub === sub.id ? '✓' : '+'}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
          <div className="selection-receipt" role="status">
            <strong>
              {selectedSub
                ? `Your selection: ${selectedSub.label}`
                : 'No location selected yet'}
            </strong>
            <p className="small">
              {pendingPoint
                ? 'An approximate pin is placed.'
                : 'A pin is optional.'}{' '}
              Choosing an area does not confirm a medical cause.
            </p>
          </div>
        </div>
      </div>
      <section className="candidate-section" aria-labelledby="candidate-title">
        <div className="section-heading">
          <div>
            <h3 id="candidate-title">Possible structures to consider</h3>
            <p className="muted">
              Optional suggestions from your description. Selecting one records
              where you mean, not what is wrong.
            </p>
          </div>
          {layers.length > 0 && (
            <label className="layer-filter">
              Filter suggestions by tissue
              <select
                value={layer}
                onChange={(event) => setLayer(event.target.value)}
              >
                <option value="all">All tissues</option>
                {layers.map((item) => (
                  <option value={item} key={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {candidates.length === 0 ? (
          <p className="candidate-empty">
            No structure candidates were returned. You can continue with a body
            location.
          </p>
        ) : (
          <ul className="candidates__list">
            {filtered.map((candidate) => {
              const structure = getStructure(candidate.structureId);
              if (!structure) return null;
              const isSelected = selected.includes(candidate.structureId);
              return (
                <li
                  key={candidate.structureId}
                  className={`candidate-card ${isSelected ? 'candidate-card--selected' : ''}`}
                >
                  <div>
                    <StatusTag kind={isSelected ? 'selected' : 'candidate'}>
                      {isSelected
                        ? '✓ Selected by you'
                        : 'Unconfirmed candidate'}
                    </StatusTag>
                    <h4>{structure.layTerm || structure.label}</h4>
                    {structure.layTerm && (
                      <p className="small">{structure.label}</p>
                    )}
                    <span className="small">{structure.layer}</span>
                  </div>
                  <button
                    className="btn"
                    disabled={isSelected}
                    onClick={() => confirmStructure(candidate.structureId)}
                  >
                    {isSelected ? 'Selected' : 'Select this structure'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <div className="location-footer">
        <p className="small">You can continue without selecting a structure.</p>
        <button
          className="btn btn--primary"
          disabled={!pendingSub}
          onClick={() => {
            if (!pendingSub) return;
            if (pendingPoint) pinAt(pendingPoint);
            confirmSubRegion(pendingSub);
          }}
        >
          Use this location & continue
        </button>
      </div>
    </section>
  );
}
