/**
 * Selective context for isolate.
 *
 * ## Why a single global opacity cannot work
 *
 * The first isolate implementation dropped every non-selected structure to one
 * global 13%. With 42 meshes overlapping that accumulates into a brown-grey fog:
 * the selected structure stays readable, but the "context" is noise rather than
 * orientation, and it competes with the selection for attention. Lowering the
 * number to 6% would dim the bones out of usefulness; raising it thickens the fog.
 *
 * The fix is not a better number, it is fewer things at a visible level.
 *
 * ## The classes
 *
 *   selected     100%  normal presentation
 *   bone         ~15%  the skeleton is what tells you WHERE you are; keep it
 *   adjacent     ~5.5% muscle physically next to the selection
 *   system       ~4%   artery/vein, but only if the user had that layer on
 *   hidden       --     everything else, not drawn at all
 *
 * The skeleton earns its opacity because bone is a landmark you orient by. Most
 * of the fog in the first version was muscle stacked on muscle, and the fix for
 * that is to draw less of it, not to draw it paler.
 *
 * ## Adjacency is measured, not guessed
 *
 * There is no adjacency relation in the source data, and inventing one from
 * structure names would be exactly the guessing this project refuses. So
 * adjacency is computed from the per-structure bounds that BodyParts3D ships in
 * every OBJ header: two structures are adjacent when their boxes come within a
 * margin derived from the SELECTED structure's own size. A small structure gets a
 * small margin; the shoulder as a whole gets a large one. Deterministic, derived
 * from real data, and it scales with what is selected.
 */

import type { AtlasState, StructureLike } from './atlas-state.ts';

export type ContextClass = 'selected' | 'bone' | 'adjacent' | 'system' | 'hidden';

export interface ContextPresentation {
  visible: boolean;
  opacity: number;
}

export const CONTEXT_OPACITY = {
  /** The selection is never dimmed. */
  selected: 1,
  /** Bone: the landmark you orient by. */
  bone: 0.15,
  /** Muscle physically next to the selection. */
  adjacent: 0.055,
  /** Artery and vein, if the user asked for them. */
  system: 0.04,
} as const;

/** A point in the same units the manifest carries bounds in. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * An axis-aligned box.
 *
 * Points are {x,y,z} rather than tuples on purpose: this project runs with
 * noUncheckedIndexedAccess, so `box.min[0]` is `number | undefined` and every use
 * needs an assertion. Named components remove the problem instead of suppressing
 * it.
 */
export interface Box {
  min: Vec3;
  max: Vec3;
}

/** Gap between two boxes on each axis; 0 when they overlap or touch. */
function gap(a: Box, b: Box): Vec3 {
  return {
    x: Math.max(0, Math.max(a.min.x - b.max.x, b.min.x - a.max.x)),
    y: Math.max(0, Math.max(a.min.y - b.max.y, b.min.y - a.max.y)),
    z: Math.max(0, Math.max(a.min.z - b.max.z, b.min.z - a.max.z)),
  };
}

export function boxDiagonal(b: Box): number {
  return Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
}

/**
 * Is `other` close enough to `sel` to count as adjacent?
 *
 * The margin is a fraction of the SELECTED structure's own diagonal, so a small
 * structure like the teres minor does not sweep in the whole shoulder, and a
 * large one like the scapula legitimately reaches its neighbours.
 */
export function isAdjacent(sel: Box, other: Box, fraction = 0.35): boolean {
  const reach = boxDiagonal(sel) * fraction;
  const g = gap(sel, other);
  return Math.hypot(g.x, g.y, g.z) <= reach;
}

export interface ContextInput {
  id: string;
  system: string;
  bounds: Box | null;
}

export interface ContextResult {
  classes: Map<string, ContextClass>;
  opacities: Map<string, number>;
  /** Counts per class, for the caption and for tests. */
  counts: Record<ContextClass, number>;
}

/**
 * Decide what each structure is doing, given a selection and the user's layer
 * choices.
 *
 * Explicit hide always wins, in every mode, because it is a direct instruction.
 * Outside isolate this reduces to the ordinary explore behaviour, so callers can
 * use one function.
 */
export function deriveContext(
  structures: readonly ContextInput[],
  state: AtlasState,
): ContextResult {
  const classes = new Map<string, ContextClass>();
  const opacities = new Map<string, number>();
  const counts: Record<ContextClass, number> = {
    selected: 0, bone: 0, adjacent: 0, system: 0, hidden: 0,
  };

  const selected = structures.find((s) => s.id === state.selectedId) ?? null;
  const layerOn = (s: ContextInput) => state.systemVisibility[s.system] !== false;
  const isHidden = (s: ContextInput) => state.hiddenIds.includes(s.id);
  const soloing = state.mode === 'solo';
  const isolating = state.mode === 'isolate' && selected !== null;

  for (const s of structures) {
    let cls: ContextClass;

    if (isHidden(s)) {
      cls = 'hidden';
    } else if (soloing) {
      cls = s.id === state.selectedId ? 'selected' : 'hidden';
    } else if (s.id === state.selectedId) {
      cls = 'selected';
    } else if (!isolating) {
      // Explore: ordinary layer + opacity behaviour.
      cls = layerOn(s) ? 'system' : 'hidden';
    } else if (s.system === 'bone') {
      // Bone is the orientation landmark, so it survives a layer being off while
      // isolating -- isolating is a request to see one thing in place, and
      // without the skeleton there is no "place".
      cls = 'bone';
    } else if (s.system === 'artery' || s.system === 'vein') {
      // Ghost vessels only if the user had that system switched on. A vessel
      // nobody asked for should not appear just because isolate is on.
      cls = layerOn(s) ? 'system' : 'hidden';
    } else if (s.system === 'muscle' || s.system === 'fascia' || s.system === 'tendon') {
      cls =
        layerOn(s) && selected?.bounds && s.bounds && isAdjacent(selected.bounds, s.bounds)
          ? 'adjacent'
          : 'hidden';
    } else {
      cls = 'hidden';
    }

    classes.set(s.id, cls);
    opacities.set(s.id, opacityFor(cls, state));
    counts[cls] += 1;
  }

  return { classes, opacities, counts };
}

function opacityFor(cls: ContextClass, state: AtlasState): number {
  switch (cls) {
    case 'selected':
      return CONTEXT_OPACITY.selected;
    case 'bone':
      return CONTEXT_OPACITY.bone;
    case 'adjacent':
      return CONTEXT_OPACITY.adjacent;
    case 'system':
      // In explore this class means "ordinary visible structure", so it uses the
      // user's opacity slider. While isolating it is a ghost.
      return state.mode === 'isolate' ? CONTEXT_OPACITY.system : state.opacity;
    case 'hidden':
      return 0;
  }
}

/** One line describing what isolate is doing, for the caption under the control. */
export function describeContext(counts: Record<ContextClass, number>): string {
  if (counts.selected === 0) return 'Pick a structure to isolate it in place.';
  const parts: string[] = [];
  if (counts.bone > 0) parts.push('skeleton for orientation');
  if (counts.adjacent > 0) parts.push(`${counts.adjacent} nearby`);
  if (counts.system > 0) parts.push('vessels');
  const hidden = counts.hidden;
  return parts.length
    ? `Showing the selection, ${parts.join(', ')}. ${hidden} other structure${hidden === 1 ? '' : 's'} hidden.`
    : `Showing the selection only. ${hidden} other structure${hidden === 1 ? '' : 's'} hidden.`;
}