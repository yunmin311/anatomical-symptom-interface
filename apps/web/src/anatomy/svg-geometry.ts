/**
 * 2D body geometry.
 *
 * Still a schematic hit-target system, not an atlas, and deliberately kept that
 * way: this is the mobile, accessibility and low-power path, and it has to load
 * instantly and work with a screen reader. What Phase 1A changes is that it is
 * now a usable locating interface rather than a placeholder:
 *
 *  - Each view has its OWN silhouette. Front, back and the two side profiles are
 *    different drawings, so the view toggle tells the user something true.
 *  - Zones never overlap inside a view, so every sub-region is reachable by
 *    clicking it. Overlap was the old failure mode: a wider zone painted later
 *    silently swallowed its neighbour.
 *  - Zones are authored ONCE for the figure's left side and mirrored at render
 *    time, so side is expressed by the drawing rather than by a separate label
 *    the user has to keep in sync.
 *  - Every zone carries a centroid. Taps resolve to the NEAREST zone rather than
 *    requiring a pixel-accurate hit, which is what makes a 4-unit-wide zone
 *    usable with a thumb at 375px.
 *
 * Coordinate space is 0..100 wide by 0..180 tall, y increasing downward.
 */
import type { ViewName } from './types.ts';

/**
 * Viewport in SVG user units. The height stays at 186 even though the drawing
 * occupies 6..180, because `location.point` is persisted as a 0..1 value against
 * this same box. Changing the box would silently move every pin already stored
 * in a user's history, so the figure is drawn to fit rather than the box moved
 * to fit the figure.
 */
export const VIEW_W = 100;
export const VIEW_H = 186;
/** Vertical extent the figure actually occupies. */
export const DRAW_TOP = 6;
export const DRAW_BOTTOM = 180;

type Silhouette = Record<string, string>;

/**
 * Landmarks, shared by the drawings and the zones so a zone can never drift off
 * the body it belongs to.
 */
export const LM = {
  headTop: 6,
  headBottom: 34,
  neckTop: 32,
  shoulderY: 46,
  armpitY: 70,
  waistY: 88,
  hipY: 100,
  crotchY: 104,
  kneeY: 130,
  ankleY: 168,
  footY: 180,
  shoulderHalf: 26,
  waistHalf: 18,
  hipHalf: 21,
  centre: 50,
} as const;

/** Front view. Reads as a person facing you. */
const ANTERIOR: Silhouette = {
  head: 'M 50 6 C 57 6 61 13 61 21 C 61 29 56 35 50 35 C 44 35 39 29 39 21 C 39 13 43 6 50 6 Z',
  // Tapered rather than rectangular: a stroked box between head and shoulders
  // reads as a post, not a neck.
  neck: 'M 46 33 L 54 33 C 56 38 57 42 57 45 L 43 45 C 43 42 44 38 46 33 Z',
  torso:
    'M 43 44 C 36 45 29 47 25 51 C 23 55 23 61 24 67 C 25 75 27 81 28 87 ' +
    'C 29 93 28 98 29 102 C 30 106 34 108 40 108 L 60 108 C 66 108 70 106 71 102 ' +
    'C 72 98 71 93 72 87 C 73 81 75 75 76 67 C 77 61 77 55 75 51 ' +
    'C 71 47 64 45 57 44 Z',
  armLeft:
    'M 25 51 C 19 55 16 63 15 73 L 12 106 C 11 114 14 118 19 118 L 23 118 ' +
    'C 26 118 27 114 27 108 L 27 75 C 27 67 27 59 28 53 Z',
  armRight:
    'M 75 51 C 81 55 84 63 85 73 L 88 106 C 89 114 86 118 81 118 L 77 118 ' +
    'C 74 118 73 114 73 108 L 73 75 C 73 67 73 59 72 53 Z',
  legLeft: 'M 31 104 L 48 104 L 45 168 L 34 168 Z',
  legRight: 'M 52 104 L 69 104 L 66 168 L 55 168 Z',
  footLeft: 'M 33 166 L 46 166 L 45 180 L 30 180 Z',
  footRight: 'M 54 166 L 67 166 L 70 180 L 55 180 Z',
};

/**
 * Back view. Same standing outline, but with the marks that make it legible as
 * the back rather than a duplicate of the front: shoulder-blade hint, the
 * spine line, and the gluteal cleft.
 */
const SPINE = 'M 50 46 L 50 100';
const SCAPULA_LEFT = 'M 34 52 C 40 50 45 52 47 58 C 42 60 37 58 34 52 Z';
const SCAPULA_RIGHT = 'M 66 52 C 60 50 55 52 53 58 C 58 60 63 58 66 52 Z';
const CLEFT = 'M 50 100 L 50 104';

const POSTERIOR: Silhouette = {
  ...ANTERIOR,
  // Back-only marks, drawn thin and listed in VIEW_DETAILS.
  spine: SPINE,
  scapulaLeft: SCAPULA_LEFT,
  scapulaRight: SCAPULA_RIGHT,
  cleft: CLEFT,
};

/**
 * Side profile. A genuinely different drawing: face and chest toward -x, the
 * back and buttocks toward +x, one arm, and the legs read as a single mass with
 * a split so the profile is not two overlapping columns.
 */
function profile(facingLeft: boolean): Silhouette {
  // Built for a figure facing -x, then mirrored for the other side.
  const s: Silhouette = {
    head:
      'M 46 7 C 54 7 59 14 59 22 C 59 28 56 32 52 34 C 47 36 42 34 40 30 ' +
      'C 37 29 35 27 35 25 C 35 23 37 22 39 21 C 40 15 42 9 46 7 Z',
    neck: 'M 44 32 L 54 31 L 56 44 L 44 45 Z',
    torso:
      'M 44 44 C 40 45 37 47 36 50 C 34 54 35 58 36 62 C 38 68 40 74 40 80 ' +
      'C 40 86 39 92 40 98 C 40 100 42 101 44 101 L 58 101 C 61 101 63 99 63 96 ' +
      'C 64 90 63 84 62 78 C 61 72 60 66 60 60 C 60 55 58 50 55 47 Z',
    arm:
      'M 38 50 C 33 54 31 62 31 72 L 30 104 C 30 112 33 116 38 116 L 42 116 ' +
      'C 45 116 46 112 46 106 L 45 74 C 45 66 44 58 42 52 Z',
    legs:
      'M 41 100 C 40 112 41 122 42 130 C 43 142 43 156 43 168 L 58 168 ' +
      'C 58 154 58 140 58 130 C 59 120 60 110 60 100 Z',
    legSplit: 'M 50 128 L 50 168',
    foot: 'M 40 166 L 60 166 L 62 180 L 36 180 Z',
    glute: 'M 63 92 C 66 94 66 99 63 101',
    chest: 'M 36 56 C 34 60 34 64 36 68',
  };
  if (!facingLeft) {
    // Mirror about x=50 so the profile faces the other way.
    const mirrored: Silhouette = {};
    for (const [key, d] of Object.entries(s)) mirrored[key] = mirrorPath(d);
    return mirrored;
  }
  return s;
}

export const SILHOUETTES: Record<ViewName, Silhouette> = {
  anterior: ANTERIOR,
  posterior: POSTERIOR,
  lateral_left: profile(true),
  lateral_right: profile(false),
};

/** Extra thin strokes that only exist in some views (back marks, profile marks). */
export const VIEW_DETAILS: Partial<Record<ViewName, { part: string; d: string; weight: number }[]>> = {
  posterior: [
    { part: 'spine', d: SPINE, weight: 0.6 },
    { part: 'scapulaLeft', d: SCAPULA_LEFT, weight: 0.4 },
    { part: 'scapulaRight', d: SCAPULA_RIGHT, weight: 0.4 },
    { part: 'cleft', d: CLEFT, weight: 0.5 },
  ],
  lateral_left: [
    { part: 'chest', d: 'M 36 56 C 34 60 34 64 36 68', weight: 0.5 },
    { part: 'glute', d: 'M 63 92 C 66 94 66 99 63 101', weight: 0.5 },
    { part: 'legSplit', d: 'M 50 128 L 50 168', weight: 0.5 },
  ],
  lateral_right: [
    { part: 'chest', d: mirrorPath('M 36 56 C 34 60 34 64 36 68'), weight: 0.5 },
    { part: 'glute', d: mirrorPath('M 63 92 C 66 94 66 99 63 101'), weight: 0.5 },
    { part: 'legSplit', d: mirrorPath('M 50 128 L 50 168'), weight: 0.5 },
  ],
};

/** Silhouette for a view. Views are exhaustive, so this never falls through. */
export function silhouetteFor(view: ViewName): Silhouette {
  return SILHOUETTES[view] ?? ANTERIOR;
}

/**
 * Mirror a path about the vertical centre line, touching x only.
 *
 * Every path in this module is authored with absolute commands in strict `x y`
 * pairs, so alternating tokens are the x coordinates. Mirroring every number
 * would also flip y and turn the figure inside out.
 */
export function mirrorPath(d: string): string {
  let index = 0;
  return d.replace(/-?\d+(\.\d+)?/g, (token) => {
    const isX = index % 2 === 0;
    index += 1;
    const value = Number(token);
    return isX ? String(round2(VIEW_W - value)) : String(round2(value));
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface Zone {
  subRegionId: string;
  mapId: string;
  label: string;
  /**
   * One shape per view. A sub-region that is only meaningful from the front is
   * simply absent from the other views, rather than drawn somewhere misleading.
   */
  shapes: Partial<Record<ViewName, string>>;
  /** Centroid per view, for nearest-zone tap resolution. */
  centroids: Partial<Record<ViewName, [number, number]>>;
}

const zone = (
  subRegionId: string,
  mapId: string,
  label: string,
  shapes: Partial<Record<ViewName, string>>,
  centroids: Partial<Record<ViewName, [number, number]>>,
): Zone => ({ subRegionId, mapId, label, shapes, centroids });

/**
 * Zones, authored on the figure's LEFT (the viewer's right in an anterior
 * drawing) and mirrored at render time for the other side.
 *
 * Lateral views are authored ONCE, for the flank that faces the camera, and the
 * same mirror transform used for `side` turns them into the opposite flank.
 * That keeps one source of truth per sub-region instead of two hand-kept copies
 * that can drift apart.
 *
 * Within any single view these do not overlap. That is the invariant the
 * previous geometry broke, and it is what the overlap test checks.
 */
export const ZONES: Zone[] = [
  zone(
    'shoulder.anterior',
    'shoulder-anterior',
    'Front of shoulder',
    {
      // Kept inside the silhouette: the shoulder mass spans roughly x25..75 at
      // this height, so a zone drawn out at x74..84 floats off the body.
      anterior: 'M 54 47 C 60 47 64 51 64 57 L 59 61 C 58 55 56 51 52 49 Z',
      lateral_left: 'M 40 44 C 45 44 49 47 50 52 L 45 54 C 44 50 42 47 39 46 Z',
      lateral_right: 'M 40 44 C 45 44 49 47 50 52 L 45 54 C 44 50 42 47 39 46 Z',
    },
    {
      anterior: [58, 54],
      lateral_left: [45, 49],
      lateral_right: [45, 49],
    },
  ),
  zone(
    'shoulder.lateral',
    'shoulder-lateral',
    'Outside of shoulder',
    {
      anterior: 'M 66 47 C 72 47 76 51 76 57 L 71 61 C 70 55 68 51 64 49 Z',
      lateral_left: 'M 50 44 C 56 44 60 47 61 53 L 55 55 C 54 50 52 47 49 46 Z',
      lateral_right: 'M 50 44 C 56 44 60 47 61 53 L 55 55 C 54 50 52 47 49 46 Z',
    },
    { anterior: [70, 54], lateral_left: [55, 49], lateral_right: [55, 49] },
  ),
  zone(
    'shoulder.posterior',
    'shoulder-posterior',
    'Back of shoulder',
    {
      posterior: 'M 64 44 C 70 45 74 50 74 58 L 70 62 C 69 55 67 50 63 47 Z',
      lateral_left: 'M 55 52 C 60 48 64 46 66 50 L 62 56 C 60 53 57 52 55 52 Z',
      lateral_right: 'M 55 52 C 60 48 64 46 66 50 L 62 56 C 60 53 57 52 55 52 Z',
    },
    { posterior: [68, 52], lateral_left: [61, 51], lateral_right: [61, 51] },
  ),
  zone(
    'neck.anterior',
    'neck-anterior',
    'Front of neck',
    {
      anterior: 'M 44 34 L 56 34 L 57 44 L 43 44 Z',
      lateral_left: 'M 42 34 L 52 33 L 53 44 L 42 45 Z',
      lateral_right: 'M 42 34 L 52 33 L 53 44 L 42 45 Z',
    },
    { anterior: [50, 39], lateral_left: [47, 39], lateral_right: [47, 39] },
  ),
  zone(
    'neck.lateral',
    'neck-lateral',
    'Side of neck',
    {
      anterior: 'M 56 34 L 62 35 L 63 45 L 57 44 Z',
      lateral_left: 'M 53 33 L 58 33 L 59 44 L 53 44 Z',
      lateral_right: 'M 53 33 L 58 33 L 59 44 L 53 44 Z',
    },
    { anterior: [59, 39], lateral_left: [55, 38], lateral_right: [55, 38] },
  ),
  zone(
    'neck.posterior',
    'neck-posterior',
    'Back of neck',
    // No lateral view: a profile cannot honestly tell the front of the neck
    // from the back of it, and drawing both there would stack two targets on the
    // same few units of neck.
    { posterior: 'M 42 33 L 58 33 L 58 44 L 42 44 Z' },
    { posterior: [50, 38] },
  ),
  zone(
    'lower_back.left_paravertebral',
    'lower-back-left',
    'Left side of lower back',
    {
      posterior: 'M 36 76 L 45 76 L 45 96 L 36 96 Z',
      lateral_left: 'M 52 76 L 62 78 L 62 98 L 52 96 Z',
      lateral_right: 'M 52 76 L 62 78 L 62 98 L 52 96 Z',
    },
    { posterior: [40, 86], lateral_left: [57, 87], lateral_right: [57, 87] },
  ),
  zone(
    'lower_back.central',
    'lower-back-central',
    'Centre of lower back',
    { posterior: 'M 45 76 L 55 76 L 55 96 L 45 96 Z' },
    { posterior: [50, 86] },
  ),
  zone(
    'lower_back.right_paravertebral',
    'lower-back-right',
    'Right side of lower back',
    {
      posterior: 'M 55 76 L 64 76 L 64 96 L 55 96 Z',
      lateral_left: 'M 38 78 L 48 76 L 48 96 L 38 98 Z',
      lateral_right: 'M 38 78 L 48 76 L 48 96 L 38 98 Z',
    },
    { posterior: [60, 86], lateral_left: [43, 87], lateral_right: [43, 87] },
  ),
  zone(
    'lower_back.sacrococcygeal',
    'lower-back-sacral',
    'Tailbone',
    { posterior: 'M 42 96 L 58 96 L 57 104 L 43 104 Z' },
    { posterior: [50, 100] },
  ),
  zone(
    'knee.anterior',
    'knee-anterior',
    'Front of knee',
    // No lateral view: from the side, "front of knee" and "back of knee" are the
    // same few centimetres, and offering both would make either one untappable.
    { anterior: 'M 37 124 L 44 124 L 44 136 L 37 136 Z' },
    { anterior: [40, 130] },
  ),
  zone(
    'knee.medial',
    'knee-medial',
    'Inside of knee',
    { anterior: 'M 44 124 L 50 124 L 50 136 L 44 136 Z' },
    { anterior: [47, 130] },
  ),
  zone(
    'knee.lateral',
    'knee-lateral',
    'Outside of knee',
    {
      anterior: 'M 31 124 L 37 124 L 37 136 L 31 136 Z',
      lateral_left: 'M 58 124 L 63 124 L 63 136 L 58 136 Z',
      lateral_right: 'M 58 124 L 63 124 L 63 136 L 58 136 Z',
    },
    { anterior: [34, 130], lateral_left: [60, 130], lateral_right: [60, 130] },
  ),
  zone(
    'knee.posterior',
    'knee-posterior',
    'Back of knee',
    { posterior: 'M 37 124 L 48 124 L 48 136 L 37 136 Z' },
    { posterior: [42, 130] },
  ),
];

export const ZONE_INDEX = new Map(ZONES.map((z) => [z.subRegionId, z] as const));

/** Zones drawn in a given view, in a stable order. */
export function zonesForView(view: ViewName): Zone[] {
  return ZONES.filter((z) => Boolean(z.shapes[view]));
}

/**
 * Zones for one region in one view. The map must only ever offer the region the
 * user is actually locating: drawing neck and knee targets on a shoulder view
 * turns the body into a board of unrelated boxes.
 */
export function zonesForRegionView(
  region: string,
  view: ViewName,
): Zone[] {
  const prefix = `${region}.`;
  return zonesForView(view).filter((z) => z.subRegionId.startsWith(prefix));
}

/** The first view that can show a sub-region, used to move the map to it. */
export function firstViewFor(subRegionId: string): ViewName | null {
  const target = ZONE_INDEX.get(subRegionId);
  if (!target) return null;
  return (['anterior', 'posterior', 'lateral_left', 'lateral_right'] as ViewName[]).find(
    (view) => Boolean(target.shapes[view]),
  ) ?? null;
}

/** Transform that mirrors the authored left-side zones for the other side. */
export function sideTransform(side: string): string | null {
  if (side === 'right') return `translate(${VIEW_W} 0) scale(-1 1)`;
  return null;
}

/** Mirror a point in body space, matching sideTransform. */
export function mirrorPoint(point: MapPointLike, side: string): MapPointLike {
  return side === 'right' ? { x: (VIEW_W - point.x) / VIEW_W, y: point.y } : point;
}

export interface MapPointLike {
  x: number;
  y: number;
}

/**
 * Map a pointer event to normalised body space using the same box the SVG
 * viewBox uses, so a point means the same thing here, in the pin, and in the
 * stored record.
 */
export function clientToBody(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): MapPointLike {
  if (rect.width === 0 || rect.height === 0) return { x: 0.5, y: 0.5 };
  return {
    x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  };
}

/** Inverse of clientToBody, for placing the pin marker. */
export function bodyToUser(point: MapPointLike): [number, number] {
  return [point.x * VIEW_W, point.y * VIEW_H];
}

/**
 * Nearest-zone resolution. Given a tap in 0..1 body space, return the zone whose
 * centroid is closest, provided it is within `maxDistance`. This is what makes
 * small zones tappable: the user aims at the knee, not at a 4-unit-wide polygon.
 */
/**
 * Nearest-zone resolution. Given a tap in 0..1 body space, return the zone whose
 * centroid is closest, provided it is within `maxDistance`. This is what makes
 * small zones tappable: the user aims at the knee, not at a 4-unit-wide polygon.
 *
 * Only the CENTROID is mirrored, never the tap. The tap is where the user
 * actually pressed on screen; the drawing is what moves when the side changes.
 * Mirroring both would make the function invariant to side, and choosing a side
 * would then have no effect at all on what can be hit.
 */
export function nearestZone(
  point: MapPointLike,
  region: string,
  view: ViewName,
  side: string,
  maxDistance = 0.14,
): Zone | null {
  const px = point.x * VIEW_W;
  const py = point.y * VIEW_H;
  let best: Zone | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of zonesForRegionView(region, view)) {
    const centroid = candidate.centroids[view];
    if (!centroid) continue;
    const cx = side === 'right' ? VIEW_W - centroid[0] : centroid[0];
    const distance = Math.hypot(px - cx, py - centroid[1]) / VIEW_W;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best && bestDistance <= maxDistance ? best : null;
}
