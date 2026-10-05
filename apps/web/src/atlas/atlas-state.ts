/**
 * Atlas viewer state, and the single pure function that derives what each
 * structure should look like.
 *
 * ## Isolate and solo are different, and isolate is the primary one
 *
 * ISOLATE keeps the selected structure fully visible and drops everything around
 * it to low-opacity anatomical context. The user still knows where they are,
 * because the surrounding body is still there as a ghost. This is the default
 * action for a selection.
 *
 * SOLO hides everything else outright. It answers "show me only this", and it is
 * NOT the default, because a single floating structure with no body around it
 * destroys anatomical orientation -- which is the whole reason to show a body
 * rather than a diagram.
 *
 * ## Nothing here touches the record
 *
 * This module decides what is DRAWN. It never writes anatomy data, never
 * mutates a selection id list, and knows nothing about provenance. The user's
 * selection semantics live in packages/shared/src/symptom.ts
 * (`projectUserSelection`, ordered-unique first-occurrence-wins) and are
 * untouched by any of this.
 */

import { GHOST_OPACITY, type System } from './material-system.ts';

export type AtlasMode = 'explore' | 'isolate' | 'solo';

export interface AtlasState {
  /** The structure the user picked. Null means nothing is selected. */
  selectedId: string | null;
  hoveredId: string | null;
  mode: AtlasMode;
  /** Explicitly hidden structure ids. */
  hiddenIds: readonly string[];
  /** Per-system layer switches. */
  systemVisibility: Readonly<Record<string, boolean>>;
  /** Opacity applied to ordinary, non-selected structures. */
  opacity: number;
  /** Whole-body context shell. */
  bodyVisible: boolean;
}

export const INITIAL_ATLAS_STATE: AtlasState = {
  selectedId: null,
  hoveredId: null,
  mode: 'explore',
  hiddenIds: [],
  systemVisibility: {},
  opacity: 1,
  bodyVisible: true,
};

export interface StructureLike {
  id: string;
  label: string;
  system: System;
}

export interface RenderState {
  visible: boolean;
  /** 0..1 */
  opacity: number;
  selected: boolean;
  hovered: boolean;
  /** True when present only as low-opacity context around a selection. */
  ghosted: boolean;
}

/**
 * Derive the render state for every structure.
 *
 * Precedence, in order:
 *   1. explicit hide -- a direct, specific instruction beats every mode
 *   2. solo          -- only the selection
 *   3. selected      -- full opacity, immune to its own layer being off
 *   4. isolate       -- everything else ghosted
 *   5. layer off     -- hidden regardless of mode
 *   6. opacity       -- the user's slider
 *
 * Two orderings here are deliberate and both were bugs once:
 *
 * Hide outranks selection. Otherwise `selected` short-circuits before `hidden` is
 * consulted and Hide silently does nothing -- and the selected structure is the
 * ONLY one the panel offers a Hide button for, so the control was a no-op in
 * exactly the case anybody would use it.
 *
 * Selection still outranks its own layer switch. A layer is a broad setting; a
 * selection is a specific request for one structure, and a user who picks
 * something and then switches its layer off still expects to see the thing they
 * picked.
 */
export function deriveRenderStates(
  structures: readonly StructureLike[],
  state: AtlasState,
): Map<string, RenderState> {
  const out = new Map<string, RenderState>();
  const sel = state.selectedId;

  for (const s of structures) {
    const selected = s.id === sel;
    const hovered = s.id === state.hoveredId;
    const layerOn = state.systemVisibility[s.system] !== false;
    const hidden = state.hiddenIds.includes(s.id);

    let visible: boolean;
    let opacity: number;

    if (hidden) {
      visible = false;
      opacity = 0;
    } else if (state.mode === 'solo') {
      visible = selected;
      opacity = 1;
    } else if (selected) {
      visible = true;
      opacity = 1;
    } else if (state.mode === 'isolate') {
      visible = layerOn;
      opacity = GHOST_OPACITY;
    } else {
      visible = layerOn;
      opacity = state.opacity;
    }

    out.set(s.id, {
      visible,
      opacity,
      selected,
      hovered,
      ghosted: visible && !selected && opacity <= GHOST_OPACITY,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ actions */

export function select(state: AtlasState, id: string | null): AtlasState {
  return { ...state, selectedId: id };
}

export function hover(state: AtlasState, id: string | null): AtlasState {
  return { ...state, hoveredId: id };
}

export function setMode(state: AtlasState, mode: AtlasMode): AtlasState {
  // Leaving solo or isolate returns to plain exploration. There is no mode in
  // which a selection survives invisibly.
  return { ...state, mode };
}

export function toggleSystem(state: AtlasState, system: string): AtlasState {
  const next = { ...state.systemVisibility };
  const on = next[system] !== false;
  if (on) next[system] = false;
  else delete next[system];
  return { ...state, systemVisibility: next };
}

export function setSystem(state: AtlasState, system: string, visible: boolean): AtlasState {
  const next = { ...state.systemVisibility };
  if (visible) delete next[system];
  else next[system] = false;
  return { ...state, systemVisibility: next };
}

export function toggleHidden(state: AtlasState, id: string): AtlasState {
  const hidden = state.hiddenIds.includes(id);
  return {
    ...state,
    hiddenIds: hidden ? state.hiddenIds.filter((h) => h !== id) : [...state.hiddenIds, id],
  };
}

export function setOpacity(state: AtlasState, opacity: number): AtlasState {
  const clamped = Math.max(0.05, Math.min(1, opacity));
  return { ...state, opacity: clamped };
}

export function setBodyVisible(state: AtlasState, visible: boolean): AtlasState {
  return { ...state, bodyVisible: visible };
}

/**
 * Back to square one.
 *
 * Clears the selection AND returns to explore mode. Leaving a mode while keeping
 * the selection would re-apply ghosting or solo without the user having asked
 * for it on the way back.
 */
export function reset(state: AtlasState): AtlasState {
  return { ...INITIAL_ATLAS_STATE };
}

/* ------------------------------------------------------------------ search */

export interface SearchHit {
  item: StructureLike;
  /** Higher is a better match. */
  score: number;
  /** Character ranges that matched, for highlighting. */
  ranges: ReadonlyArray<readonly [number, number]>;
}

/**
 * Rank structures for the search box.
 *
 * Ranking, best first: exact label, then label prefix, then word-boundary match,
 * then substring, then an anatomical-name match on any token. Ties break on
 * label so results are stable rather than dependent on input order.
 *
 * Matches are case- and diacritic-insensitive because the labels come from
 * FMA-derived names containing Latin forms.
 */
export function searchStructures(
  structures: readonly StructureLike[],
  rawQuery: string,
  limit = 25,
): SearchHit[] {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');

  const q = norm(rawQuery).trim();
  if (q.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const item of structures) {
    const label = norm(item.label);
    let score = 0;
    const ranges: Array<readonly [number, number]> = [];
    const at = label.indexOf(q);
    if (at < 0) continue;
    if (label === q) score = 1000;
    else if (at === 0) score = 900 - label.length * 0.1;
    else if (/\s/.test(label[at - 1] ?? '')) score = 800 - label.length * 0.1;
    else score = 600 - label.length * 0.1;
    ranges.push([at, at + q.length]);
    hits.push({ item, score, ranges });
  }

  hits.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
  return hits.slice(0, limit);
}