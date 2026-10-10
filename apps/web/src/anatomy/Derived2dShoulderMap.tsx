import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DerivedViewGridSchema,
  buildSelectableIndex,
  cellFromFraction,
  gridIdAt,
  resolveAtlasSelection,
  type DerivedLayer,
  type DerivedViewGrid,
  type DerivedViewName,
} from '@asi/shared';

/**
 * THE DERIVED 2D SHOULDER MAP, INSIDE THE PRODUCT.
 *
 * Previously the product's only 2D surface was a hand-authored SVG silhouette
 * that could locate an AREA and nothing else. Those sixteen orthographic
 * renders and their hit grids already existed, derived from the same BodyParts3D
 * geometry the 3D viewer loads, and no component requested any of it.
 *
 * This is that surface. It is the first place a person can TAP A STRUCTURE in 2D,
 * and it is why the grids had to be published: without them the image is a
 * picture, and a picture cannot be indicated on.
 *
 * THREE THINGS THIS GETS RIGHT THAT THE OLD SURFACE COULD NOT
 * -----------------------------------------------------------
 *
 * 1. A tap resolves to the SAME identity 3D uses. The grid carries `bp3d:FJ####`
 *    ids and so does the atlas manifest, so a tap here and a click in 3D select
 *    the identical structure.
 *
 * 2. A view-only structure cannot be written. It is highlighted, labelled, and
 *    offered for looking at, and the crosswalk then says no. The user sees a real
 *    anatomical structure and is told honestly that the record has no entry for
 *    it, rather than being offered a selection that would not survive saving.
 *
 * 3. It degrades. If the grid is missing or unparseable the map says so and the
 *    area buttons still work. A failed image fetch must never become a silent
 *    dead surface in the middle of the journey.
 */

const VIEWS_DIR = '/anatomy/views/shoulder/right';

const LAYER_LABEL: Record<DerivedLayer, string> = {
  surface: 'Surface',
  bone: 'Bone',
  muscle: 'Muscle',
  vascular: 'Blood vessels',
};

const LAYER_ORDER: DerivedLayer[] = ['surface', 'muscle', 'bone', 'vascular'];

export interface Derived2dProps {
  /** Which way the person is looking. Mirrors the 3D camera vocabulary. */
  view: DerivedViewName;
  /**
   * Structures the record already holds, as canonical asi ids. Used to mark what
   * is chosen -- never as the source of the mark, which comes from the grid.
   */
  selectedCanonicalIds: readonly string[];
  /** Atlas structure ids currently highlighted from the 3D view, for cross-surface sync. */
  highlightedAtlasIds?: readonly string[];
  onSelect?: (args: { atlasStructureId: string; canonicalAsiId: string | null; label: string }) => void;
  /** Announced to assistive tech; the map's interaction is not otherwise perceivable. */
  onAnnounce?: (message: string) => void;
}

interface AtlasStructureLite {
  id: string;
  label: string;
  canonicalAsiId?: string | null;
  symptomRecordSelectable?: boolean;
}

export function Derived2dShoulderMap({
  view,
  selectedCanonicalIds,
  highlightedAtlasIds,
  onSelect,
  onAnnounce,
}: Derived2dProps) {
  const [layer, setLayer] = useState<DerivedLayer>('muscle');
  const [grid, setGrid] = useState<DerivedViewGrid | null>(null);
  const [structures, setStructures] = useState<AtlasStructureLite[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'no-selection' | 'failed'>('loading');
  const [hover, setHover] = useState<{ atlasId: string; label: string } | null>(null);
  const [cursor, setCursor] = useState<{ atlasId: string; canonical: string | null; label: string; reason?: string } | null>(
    null,
  );
  const [detailOpen, setDetailOpen] = useState(false);

  const selectable = useMemo(() => buildSelectableIndex(structures), [structures]);
  const byAtlasId = useMemo(() => new Map(structures.map((s) => [s.id, s])), [structures]);

  // The atlas manifest is fetched once: it is the identity authority for both the
  // 2D and 3D surfaces, and reading structure labels from anywhere else would
  // reintroduce exactly the drift the crosswalk exists to prevent.
  useEffect(() => {
    let cancelled = false;
    fetch('/anatomy/atlas/shoulder/right/atlas-manifest.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((raw: { structures?: AtlasStructureLite[] }) => {
        if (!cancelled) setStructures(raw.structures ?? []);
      })
      .catch(() => {
        if (!cancelled) setStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setCursor(null);
    fetch(`${VIEWS_DIR}/shoulder-${view}-${layer}.grid.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((raw) => {
        if (cancelled) return;
        const parsed = DerivedViewGridSchema.safeParse(raw);
        if (!parsed.success) {
          setStatus('failed');
          return;
        }
        setGrid(parsed.data);
        setStatus(parsed.data.selectable ? 'ready' : 'no-selection');
      })
      .catch(() => {
        if (!cancelled) setStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [view, layer]);

  const selectedAtlasIds = useMemo(() => {
    const ids = new Set(highlightedAtlasIds ?? []);
    for (const asiId of selectedCanonicalIds) {
      for (const [atlasId, canonical] of selectable.toCanonical) {
        if (canonical === asiId) ids.add(atlasId);
      }
    }
    return ids;
  }, [selectedCanonicalIds, highlightedAtlasIds, selectable.toCanonical]);

  const imageRef = useRef<HTMLImageElement | null>(null);

  /**
   * Which grid cell a pointer event lands in.
   *
   * Measured against the <img>, NOT the container. The image is letterboxed inside
   * a wider stage, so the container's box includes empty margin and every tap
   * would drift toward the centre -- which reads as "the map is slightly wrong"
   * rather than as a coordinate bug, and would make the hit grid quietly
   * disagree with 3D.
   */
  const cellAtPointer = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): { x: number; y: number } | null => {
      if (!grid) return null;
      const el = imageRef.current;
      if (!el) return null;
      const box = el.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return null;
      return cellFromFraction(
        grid,
        (event.clientX - box.left) / box.width,
        (event.clientY - box.top) / box.height,
      );
    },
    [grid],
  );

  const resolveCell = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      if (!grid) return;
      const cell = cellAtPointer(event);
      if (!cell) return;
      const atlasStructureId = gridIdAt(grid, cell.x, cell.y);
      // Empty space is a real answer: the map is scoped to the shoulder, so most
      // of the canvas is legitimately outside the anatomy.
      if (!atlasStructureId) {
        setCursor(null);
        setHover(null);
        onAnnounce?.('No structure at that point. Use the area buttons to choose.');
        return;
      }
      const meta = byAtlasId.get(atlasStructureId);
      const outcome = resolveAtlasSelection(meta ?? { id: atlasStructureId, label: atlasStructureId });
      setCursor({
        atlasId: atlasStructureId,
        canonical: outcome.writable ? outcome.canonicalAsiId : null,
        label: meta?.label ?? atlasStructureId,
        reason: outcome.writable ? undefined : outcome.reason,
      });
      setHover(null);
      setDetailOpen(true);
      onAnnounce?.(
        outcome.writable
          ? `${meta?.label ?? atlasStructureId}. Can be recorded.`
          : `${meta?.label ?? atlasStructureId}. View only, cannot be recorded.`,
      );
    },
    [grid, byAtlasId, cellAtPointer, onAnnounce],
  );

  const handleHover = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      if (!grid) return;
      const cell = cellAtPointer(event);
      if (!cell) return;
      const atlasStructureId = gridIdAt(grid, cell.x, cell.y);
      if (!atlasStructureId) {
        setHover(null);
        return;
      }
      setHover({ atlasId: atlasStructureId, label: byAtlasId.get(atlasStructureId)?.label ?? atlasStructureId });
    },
    [grid, byAtlasId, cellAtPointer],
  );

  return (
    <div className="derived2d" data-testid="derived2d">
      <div className="derived2d__controls" role="group" aria-label="Anatomy layer">
        {LAYER_ORDER.map((l) => (
          <button
            key={l}
            type="button"
            className={`derived2d__layer${l === layer ? ' is-on' : ''}`}
            aria-pressed={l === layer}
            data-testid={`derived2d-layer-${l}`}
            onClick={() => setLayer(l)}
          >
            {LAYER_LABEL[l]}
          </button>
        ))}
      </div>

      <div className="derived2d__stage">
        {status === 'failed' ? (
          <p className="derived2d__fallback" data-testid="derived2d-failed">
            This view could not be loaded. The area buttons below still work.
          </p>
        ) : (
          <div
            className="derived2d__image"
            onClick={resolveCell}
            onMouseMove={handleHover}
            onMouseLeave={() => setHover(null)}
            data-testid="derived2d-image"
          >
            <img
              ref={imageRef}
              src={`${VIEWS_DIR}/shoulder-${view}-${layer}.png`}
              alt={`Right shoulder, ${LAYER_LABEL[layer].toLowerCase()} layer, ${view} view, rendered from BodyParts3D geometry`}
              data-testid="derived2d-img"
              draggable={false}
            />
            {/*
              The hover marker is a plain caption, not an overlay ring.

              A ring positioned over the tapped structure looks more precise than
              the underlying data supports: the grid is 160x200 over a whole-body
              silhouette cropped to a shoulder, so any pixel-exact highlight would
              be a claim about accuracy the hit map cannot make. The caption says
              what is under the pointer and leaves the reading to the person.
            */}
            {hover && status === 'ready' && (
              <span className="derived2d__hovercaption" aria-hidden="true">
                {hover.label}
              </span>
            )}
          </div>
        )}
      </div>

      {/*
        ONE truth line for the map, not two.

        The viewer foot already states what this surface is, so a second one here
        said the same thing twice on every surface. Worse, the two were stacked:
        at 375 the map ran from y=519 to y=772 and its truth line to y=772, and
        the foot's copy started at exactly y=772 and ran past the fold. Two
        identical claims about provenance is worse than one, because it makes the
        copy look like emphasis when it is duplication.

        So this line only carries what the foot cannot: whether THIS layer is
        tappable. The map's identity is stated once, below.
      */}
      <p className="derived2d__truth small" data-testid="derived2d-layer-truth">
        {status === 'no-selection'
          ? `The ${LAYER_LABEL[layer].toLowerCase()} layer shows the body surface, which is context rather than a structure you can indicate.`
          : `The ${LAYER_LABEL[layer].toLowerCase()} layer is rendered from BodyParts3D geometry. Tap a structure to see whether it can be recorded; indicating one says where you mean, never what is involved.`}
      </p>

      {cursor && (
        <div className="derived2d__detail" data-testid="derived2d-detail" hidden={!detailOpen}>
          <p className="derived2d__name">
            <strong>{cursor.label}</strong>
          </p>
          {cursor.canonical ? (
            <>
              <p className="small">You can record this as the area you mean.</p>
              <button
                type="button"
                className="btn btn--primary"
                data-testid="derived2d-indicate"
                onClick={() =>
                  onSelect?.({
                    atlasStructureId: cursor.atlasId,
                    canonicalAsiId: cursor.canonical,
                    label: cursor.label,
                  })
                }
              >
                This is where I mean it
              </button>
            </>
          ) : (
            <p className="small" data-testid="derived2d-viewonly">
              {cursor.reason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}