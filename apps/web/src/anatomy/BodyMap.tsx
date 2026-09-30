import { useCallback, useMemo, useState } from 'react';
import { getStructure, REGIONS } from '@asi/shared';
import type { Side } from '@asi/shared';
import { anatomy, useSession } from '../state/session.ts';
import { BODY_SILHOUETTE, toMapPoint } from '../anatomy/svg2d.ts';
import type { ViewName } from '../anatomy/svg2d.ts';
import { labelFor } from '../state/logic.ts';

const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'anterior', label: 'Front' },
  { id: 'posterior', label: 'Back' },
  { id: 'lateral_left', label: 'Left side' },
  { id: 'lateral_right', label: 'Right side' },
];

const SIDES: readonly Side[] = ['left', 'right', 'midline', 'bilateral'];

export function BodyMap() {
  const region = useSession((s) => s.record.location.region);
  const subRegionId = useSession((s) => s.record.location.subRegionId);
  const side = useSession((s) => s.record.location.side);
  const point = useSession((s) => s.record.location.point);
  const considered = useSession((s) => s.consideredStructures);
  const selected = useSession((s) => s.record.location.userSelectedStructureIds);
  useSession((s) => s.viewerTick);
  const { pinAt, select, selectSubRegion, setSide } = useSession();

  const [view, setView] = useState<ViewName>('anterior');

  const shapes = useMemo(() => anatomy.shapesForRegion(region, view), [region, view]);
  const regionDef = REGIONS[region];

  const onClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      pinAt(toMapPoint(e.clientX, e.clientY, rect));
      const target = (e.target as SVGElement).closest('[data-subregion]') as SVGElement | null;
      if (target?.dataset.subregion) selectSubRegion(target.dataset.subregion);
    },
    [pinAt, selectSubRegion],
  );

  const anyHighlight = considered.length > 0 || selected.length > 0;

  return (
    <div className="bodymap">
      <div className="bodymap__views" role="tablist" aria-label="Body view">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            className={view === v.id ? 'chip chip--on' : 'chip'}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="bodymap__side">
        <span className="bodymap__sidelabel">Side</span>
        {SIDES.map((s) => (
          <button
            key={s}
            className={side === s ? 'chip chip--on' : 'chip'}
            onClick={() => setSide(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <svg
        viewBox="0 0 100 186"
        className="bodymap__svg"
        onClick={onClick}
        role="img"
        aria-label={`${regionDef.label} body map`}
      >
        <g className="bodymap__body">
          <path d={BODY_SILHOUETTE.head} />
          <path d={BODY_SILHOUETTE.neck} />
          <path d={BODY_SILHOUETTE.torso} />
          <path d={BODY_SILHOUETTE.armLeft} />
          <path d={BODY_SILHOUETTE.armRight} />
          <path d={BODY_SILHOUETTE.legLeft} />
          <path d={BODY_SILHOUETTE.legRight} />
          <path d={BODY_SILHOUETTE.footLeft} />
          <path d={BODY_SILHOUETTE.footRight} />
        </g>

        <g className="bodymap__zones">
          {shapes.map((shape) => {
            const isActive = shape.subRegionId === subRegionId;
            return (
              <g key={shape.subRegionId} data-subregion={shape.subRegionId} className="bodymap__zone">
                <title>{shape.label}</title>
                <path
                  d={shape.d}
                  className={[
                    'bodymap__zone-shape',
                    isActive ? 'is-active' : '',
                    anyHighlight ? 'has-candidate' : '',
                  ].join(' ')}
                />
              </g>
            );
          })}
        </g>

        {point && (
          <g className="bodymap__pin" transform={`translate(${point.x * 100} ${point.y * 186})`}>
            <circle r={4.2} className="bodymap__pin-halo" />
            <circle r={2.1} className="bodymap__pin-dot" />
          </g>
        )}
      </svg>

      <p className="bodymap__hint">
        Click roughly where it hurts. {regionDef.orientationCues[0]}.
      </p>

      {considered.length > 0 && (
        <div className="candidates">
          <h3 className="candidates__title">Does that look like the place?</h3>
          <p className="candidates__note">
            These are suggestions from your description. Tapping one records <em>where you are
            pointing</em> on the body map. It does not mean anything is wrong with that structure —
            only a clinician can say that.
          </p>
          <ul className="candidates__list">
            {considered.map((c) => {
              const s = getStructure(c.structureId);
              if (!s) return null;
              return (
                <li key={c.structureId}>
                  <button className="candidate" onClick={() => select(c.structureId)}>
                    <strong>{s.label}</strong>
                    {s.layTerm && <span className="candidate__lay">{labelFor(c.structureId)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
