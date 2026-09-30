/**
 * SVG body map: the Phase-0 validation vehicle.
 *
 * Why 2D first, when 3D is the differentiator:
 *   1. The core question in product plan §12 is "do users describe location
 *      better with a visual aid than by typing?" A 2D map answers that in a day.
 *   2. Zero asset licensing, zero 200MB model download, works offline.
 *   3. A 2D front/ back view is honestly closer to how people self-report
 *      ("the front of my shoulder") than a 3D model they have to rotate.
 *   4. The adapter boundary means the 3D layer drops in later without
 *      touching a single call site.
 *
 * The shapes below are deliberately schematic, not anatomically literal. They
 * are a hit-target system, not an atlas — see docs/research/anatomy-assets.md
 * for the 3D upgrade path.
 */
import { REGIONS, TISSUE_LAYER_ORDER, TISSUE_LAYER_ORDER as LAYERS } from '@asi/shared';
import type { BodyRegion, Structure, SubRegion, TissueLayer, Depth, Side } from '@asi/shared';
import type {
  AnatomyAdapter,
  BodyPin,
  MapPoint,
  ViewerCommand,
  ViewerState,
} from './types.ts';

export type ViewName = 'anterior' | 'posterior' | 'lateral_left' | 'lateral_right';

/**
 * Schematic body outline, 0..100 x 0..180 coordinate space.
 *
 * Proportioned so the figure reads as a person rather than a pictogram: the
 * head is ~19% of total height, the shoulders slope from the neck, and the
 * waist draws in before the hips. Every path still spans the landmark bands the
 * sub-region hit shapes occupy (deltoid x66..84 y58..80, lumbar x40..60
 * y118..148, knee x33..50 y156..168) so a redrawn silhouette can never move a
 * click target off the body.
 */
const BODY_SILHOUETTE = {
  head: 'M 50 8 C 60 8 66 16 66 26 C 66 35 59 42 50 42 C 41 42 34 35 34 26 C 34 16 40 8 50 8 Z',
  neck: 'M 43 40 L 57 40 L 59 57 L 41 57 Z',
  torso:
    'M 41 57 C 34 58 28 62 25 69 C 23 74 23 80 24 88 C 25 96 27 100 28 106 ' +
    'C 29 116 28 130 30 143 C 30 147 33 150 37 150 L 63 150 C 67 150 70 147 70 143 ' +
    'C 72 130 71 116 72 106 C 73 100 75 96 76 88 C 77 80 77 74 75 69 ' +
    'C 72 62 66 58 59 57 Z',
  // The arm inner edge is tucked under the torso edge so the two read as one
  // shoulder mass instead of a slab floating beside it.
  armLeft: 'M 25 69 C 19 73 15 81 13 91 L 9 126 C 8 134 11 139 16 139 L 21 139 C 24 139 24 135 24 129 L 23 92 C 23 84 24 76 25 71 Z',
  armRight: 'M 75 69 C 81 73 85 81 87 91 L 91 126 C 92 134 89 139 84 139 L 79 139 C 76 139 76 135 76 129 L 77 92 C 77 84 76 76 75 71 Z',
  legLeft: 'M 31 147 L 49 147 L 47 175 L 34 175 Z',
  legRight: 'M 51 147 L 69 147 L 66 175 L 53 175 Z',
  footLeft: 'M 34 173 L 47 173 L 46 180 L 32 180 Z',
  footRight: 'M 53 173 L 66 173 L 68 180 L 54 180 Z',
};

export interface HitShape {
  subRegionId: string;
  mapId: string;
  label: string;
  /** SVG path in the 100x180 space. */
  d: string;
  views: ViewName[];
}

/**
 * Sub-region hit targets. Coordinates are schematic: the goal is that clicking
 * roughly where the pain is lands on roughly the right sub-region, and the user
 * can always refine with a follow-up question.
 */
const HIT_SHAPES: HitShape[] = [
  // ---- shoulder ----
  { subRegionId: 'shoulder.anterior', mapId: 'shoulder-anterior', label: 'Front of shoulder', d: 'M 70 60 C 76 62 79 68 79 76 L 74 80 C 72 72 70 66 66 62 Z', views: ['anterior'] },
  { subRegionId: 'shoulder.lateral', mapId: 'shoulder-lateral', label: 'Outside of shoulder', d: 'M 70 58 C 78 58 84 64 84 72 L 78 76 C 77 67 74 62 68 60 Z', views: ['anterior', 'lateral_left', 'lateral_right'] },
  { subRegionId: 'shoulder.posterior', mapId: 'shoulder-posterior', label: 'Back of shoulder', d: 'M 70 60 C 76 62 79 68 79 76 L 74 80 C 72 72 70 66 66 62 Z', views: ['posterior'] },

  // ---- neck ----
  { subRegionId: 'neck.anterior', mapId: 'neck-anterior', label: 'Front of neck', d: 'M 43 47 L 57 47 L 58 58 L 42 58 Z', views: ['anterior'] },
  { subRegionId: 'neck.lateral', mapId: 'neck-lateral', label: 'Side of neck', d: 'M 40 46 L 45 46 L 45 58 L 39 58 Z', views: ['anterior', 'lateral_left'] },
  { subRegionId: 'neck.posterior', mapId: 'neck-posterior', label: 'Back of neck', d: 'M 43 46 L 57 46 L 58 58 L 42 58 Z', views: ['posterior'] },

  // ---- lower back ----
  // The midline and the two paravertebral bands are drawn as adjacent, not
  // nested: central used to span the full width and was therefore completely
  // covered by its neighbours, so it could never be clicked on the map.
  { subRegionId: 'lower_back.left_paravertebral', mapId: 'lower-back-left', label: 'Left side of lower back', d: 'M 40 118 L 47 118 L 47 138 L 40 138 Z', views: ['posterior'] },
  { subRegionId: 'lower_back.central', mapId: 'lower-back-central', label: 'Centre of lower back', d: 'M 47 118 L 53 118 L 53 138 L 47 138 Z', views: ['posterior'] },
  { subRegionId: 'lower_back.right_paravertebral', mapId: 'lower-back-right', label: 'Right side of lower back', d: 'M 53 118 L 60 118 L 60 138 L 53 138 Z', views: ['posterior'] },
  { subRegionId: 'lower_back.sacrococcygeal', mapId: 'lower-back-sacral', label: 'Tailbone', d: 'M 40 138 L 60 138 L 60 148 L 40 148 Z', views: ['posterior'] },

  // ---- knee ----
  { subRegionId: 'knee.anterior', mapId: 'knee-anterior', label: 'Front of knee', d: 'M 38 156 L 46 156 L 46 168 L 38 168 Z', views: ['anterior'] },
  { subRegionId: 'knee.medial', mapId: 'knee-medial', label: 'Inside of knee', d: 'M 46 156 L 50 156 L 50 168 L 46 168 Z', views: ['anterior'] },
  { subRegionId: 'knee.lateral', mapId: 'knee-lateral', label: 'Outside of knee', d: 'M 33 156 L 37 156 L 37 168 L 33 168 Z', views: ['anterior', 'lateral_left', 'lateral_right'] },
  { subRegionId: 'knee.posterior', mapId: 'knee-posterior', label: 'Back of knee', d: 'M 38 156 L 46 156 L 46 168 L 38 168 Z', views: ['posterior'] },
];

const SHAPE_INDEX = new Map(HIT_SHAPES.map((s) => [s.subRegionId, s] as const));

/** Which view each region needs to be visible in to be clickable at all. */
const REGION_DEFAULT_VIEW: Record<BodyRegion, ViewName> = {
  shoulder: 'anterior',
  neck: 'anterior',
  lower_back: 'posterior',
  knee: 'anterior',
};

const defaultState = (): ViewerState => ({
  region: 'shoulder',
  visibleSubRegionIds: [],
  visibleLayers: [...LAYERS],
  selectedStructureIds: [],
  highlightedStructureIds: [],
  rejectedStructureIds: [],
  pins: [],
  activePin: null,
});

/**
 * Adapter over the schematic SVG map. It holds the authoritative viewer state
 * and the shape geometry; the React component only renders it.
 */
export class Svg2dAnatomyAdapter implements AnatomyAdapter {
  readonly kind = 'svg2d';
  private state: ViewerState = defaultState();
  private view: ViewName = REGION_DEFAULT_VIEW.shoulder;
  private listeners = new Set<(s: ViewerState) => void>();

  getState(): ViewerState {
    return this.state;
  }

  getView(): ViewName {
    return this.view;
  }

  subscribe(fn: (s: ViewerState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  apply(cmd: ViewerCommand): void {
    const s = this.state;
    switch (cmd.type) {
      case 'focusRegion':
        s.region = cmd.region;
        s.visibleSubRegionIds = [];
        s.highlightedStructureIds = [];
        this.view = REGION_DEFAULT_VIEW[cmd.region];
        break;
      case 'setView':
        this.view = cmd.view;
        break;
      case 'showLayers':
        s.visibleLayers = [...new Set([...s.visibleLayers, ...cmd.layers])];
        break;
      case 'hideLayers':
        s.visibleLayers = s.visibleLayers.filter((l) => !cmd.layers.includes(l));
        break;
      case 'focusSubRegion':
        s.visibleSubRegionIds = [cmd.subRegionId];
        break;
      case 'highlight': {
        const set = new Set(cmd.structureIds);
        if (cmd.as === 'selected') {
          s.selectedStructureIds = [...new Set([...s.selectedStructureIds, ...set])];
          s.highlightedStructureIds = s.highlightedStructureIds.filter((id) => !set.has(id));
          s.rejectedStructureIds = s.rejectedStructureIds.filter((id) => !set.has(id));
        } else {
          s.highlightedStructureIds = [...new Set([...s.highlightedStructureIds, ...set])];
        }
        break;
      }
      case 'clearHighlight':
        s.highlightedStructureIds = [];
        break;
      case 'dropPin':
      case 'movePin':
        s.activePin = cmd.point;
        break;
      case 'removePin':
        s.pins = s.pins.filter((p) => p.id !== cmd.pinId);
        if (s.activePin) s.activePin = null;
        break;
      case 'setDepth':
        // Depth is expressed by which layers are visible: superficial keeps skin
        // and fascia, deep keeps tendon/joint/bone/nerve.
        s.visibleLayers = layersForDepth(cmd.depth);
        break;
    }
    this.emit();
  }

  shapesForRegion(region: BodyRegion, view: ViewName = this.view): HitShape[] {
    return REGIONS[region].subRegions
      .map((sr) => {
        const shape = SHAPE_INDEX.get(sr.id);
        return shape ? { ...shape, label: shape.label || sr.label, mapId: shape.mapId } : null;
      })
      .filter((x): x is HitShape => Boolean(x) && (x!.views.includes(view) || view.startsWith('lateral')));
  }

  /** Structures clickable right now, honouring layer visibility. */
  pickableStructures(): Structure[] {
    const visible = new Set(this.state.visibleLayers);
    const subs = this.state.visibleSubRegionIds.length
      ? this.state.visibleSubRegionIds
      : REGIONS[this.state.region].subRegions.map((x) => x.id);
    const seen = new Map<string, Structure>();
    for (const id of subs) {
      for (const structure of REGIONS[this.state.region].subRegions.find((x) => x.id === id)?.structures ?? []) {
        if (visible.has(structure.layer)) seen.set(structure.id, structure);
      }
    }
    return [...seen.values()];
  }

  pickableSubRegions(): SubRegion[] {
    return REGIONS[this.state.region].subRegions;
  }
}

function layersForDepth(depth: Depth): TissueLayer[] {
  switch (depth) {
    case 'superficial':
      return ['skin', 'subcutaneous', 'fascia'];
    case 'intermediate':
      return ['subcutaneous', 'fascia', 'muscle', 'tendon'];
    case 'deep':
      return ['muscle', 'tendon', 'ligament', 'joint', 'bone', 'nerve', 'vessel'];
    default:
      return [...TISSUE_LAYER_ORDER];
  }
}

/** Convert a click in the SVG's user space to a normalised 0..1 point. */
export function toMapPoint(clientX: number, clientY: number, rect: DOMRect): MapPoint {
  return {
    x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  };
}

export { BODY_SILHOUETTE, HIT_SHAPES, layersForDepth, SHAPE_INDEX };
export type { Side };
