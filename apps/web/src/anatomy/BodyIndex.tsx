import { REGIONS } from '@asi/shared';
import type { BodyRegion } from '@asi/shared';
import { BODY_SILHOUETTE } from './svg2d.ts';

const POSITION: Record<BodyRegion, number> = {
  neck: 28,
  shoulder: 38,
  lower_back: 65,
  knee: 86,
};
/** A spatial index for the four existing regions, not a symptom-severity heatmap. */
export function BodyIndex({
  active,
  onSelect,
  counts,
}: {
  active?: BodyRegion;
  onSelect?: (region: BodyRegion) => void;
  counts?: Partial<Record<BodyRegion, number>>;
}) {
  return (
    <div className="body-index">
      <svg
        viewBox="0 0 100 186"
        aria-hidden="true"
        className="body-index__figure"
      >
        <g className="bodymap__body">
          {Object.entries(BODY_SILHOUETTE).map(([key, d]) => (
            <path key={key} d={d} />
          ))}
        </g>
      </svg>
      <div className="body-index__labels">
        {Object.values(REGIONS)
          .sort((a, b) => POSITION[a.id] - POSITION[b.id])
          .map((region) =>
            onSelect ? (
              <button
                key={region.id}
                style={{ top: `${POSITION[region.id]}%` }}
                className="body-index__label"
                aria-pressed={active === region.id}
                onClick={() => onSelect(region.id)}
              >
                <span>{region.label}</span>
                {counts && <span>{counts[region.id] || 0}</span>}
              </button>
            ) : (
              <span
                key={region.id}
                style={{ top: `${POSITION[region.id]}%` }}
                className={`body-index__label ${active === region.id ? 'is-active' : ''}`}
              >
                {region.label}
              </span>
            ),
          )}
      </div>
    </div>
  );
}
