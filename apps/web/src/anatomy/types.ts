/**
 * The Anatomical Model Layer as a contract.
 *
 * Product plan §6: 3D viewer control, layer visibility, selection and user
 * marking are explicitly OUTSIDE what a prompt can do. So the model layer is a
 * first-class interface, not a component buried in the UI. The orchestrator
 * drives it through this contract; the UI never talks to a viewer directly.
 *
 * Today: Svg2dAnatomyAdapter, which is enough to validate the core hypothesis
 * (does visual localisation beat typing?) with zero asset downloads.
 * Next:    Three3dAnatomyAdapter over BodyParts3D / Z-Anatomy, added behind
 *          this same interface with no changes above it.
 */
import type { BodyRegion, Depth, Side, Structure, SubRegion, TissueLayer } from '@asi/shared';

/** A point on the body map, normalised 0..1 so it is resolution independent. */
export interface MapPoint {
  x: number;
  y: number;
}

export interface BodyPin {
  id: string;
  region: BodyRegion;
  side: Side;
  point: MapPoint;
  /** How many episodes have happened at (or very near) this point. */
  episodeCount: number;
  lastEpisodeAt: string | null;
  label?: string;
}

export interface ViewerState {
  region: BodyRegion;
  /** Which sub-regions of the current region are visible. */
  visibleSubRegionIds: string[];
  /** Tissue layers currently shown, superficial → deep. */
  visibleLayers: TissueLayer[];
  /** Structures the user has explicitly confirmed. These are facts. */
  selectedStructureIds: string[];
  /** Structures the model has proposed. These are candidates. */
  highlightedStructureIds: string[];
  /** Structures the user has explicitly rejected. */
  rejectedStructureIds: string[];
  /** Every pin ever dropped on this region. */
  pins: BodyPin[];
  activePin: MapPoint | null;
}

export type ViewerCommand =
  | { type: 'focusRegion'; region: BodyRegion }
  | { type: 'setView'; view: 'anterior' | 'posterior' | 'lateral_left' | 'lateral_right' }
  | { type: 'showLayers'; layers: TissueLayer[] }
  | { type: 'hideLayers'; layers: TissueLayer[] }
  | { type: 'focusSubRegion'; subRegionId: string }
  | { type: 'highlight'; structureIds: string[]; as: 'candidate' | 'confirmed' }
  | { type: 'clearHighlight' }
  | { type: 'dropPin'; point: MapPoint }
  | { type: 'movePin'; point: MapPoint }
  | { type: 'removePin'; pinId: string }
  | { type: 'setDepth'; depth: Depth };

export interface AnatomyAdapter {
  readonly kind: string;
  getState(): ViewerState;
  apply(cmd: ViewerCommand): void;
  subscribe(fn: (state: ViewerState) => void): () => void;
  /** Structures the user can actually click in the current view. */
  pickableStructures(): Structure[];
  /** Sub-regions clickable in the current view. */
  pickableSubRegions(): SubRegion[];
}
