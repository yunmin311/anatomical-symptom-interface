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
  /**
   * Structures the user POINTED AT on the model. This records a visual location
   * choice, not a clinical finding.
   */
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
  | { type: 'highlight'; structureIds: string[]; as: 'candidate' | 'selected' }
  | { type: 'clearHighlight' }
  /**
   * The user dismissed a suggestion: "not that one". Distinct from clearing a
   * highlight, because rejection survives re-rendering the candidate list and
   * has to be re-applied whenever it comes back. Rejecting also withdraws any
   * selection, so a structure is never both selected and rejected.
   */
  | { type: 'reject'; structureIds: string[] }
  | { type: 'clearReject'; structureIds: string[] }
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

/* ------------------------------------------------------------------ *
 * Renderer lifecycle.
 *
 * AnatomyAdapter is the STATE contract and is deliberately free of any
 * rendering concern, so the 2D and 3D viewers stay interchangeable above it.
 * A renderer adds the things only a real renderer can do: own a canvas, be
 * mounted and disposed, hit-test pixels, and move a camera.
 *
 * Identity rule, and the reason `asiId` exists at all: no engine-internal
 * handle (a three.js object UUID, a mesh name, a DOM node) may become a
 * business identifier. Every lookup, every emitted pick and every state entry
 * is keyed by `asiId`, the stable id the manifest owns. Engine handles are
 * resolved through the adapter and never escape it, so swapping the renderer
 * or reloading a mesh cannot invalidate a stored selection.
 * ------------------------------------------------------------------ */

/** What a pick resolved to. Never carries an engine handle. */
export interface PickResult {
  kind: 'subregion' | 'structure' | 'none';
  /** A manifest `asiId`. Absent when nothing was hit. */
  asiId?: string;
  subRegionId?: string;
  structureId?: string;
  /** Normalised 0..1 surface point, so a pin means the same in 2D and 3D. */
  point?: MapPoint;
}

export type CameraPreset = 'anterior' | 'posterior' | 'lateral_left' | 'lateral_right';

/**
 * The 2D map's name for the same thing. Kept as an alias so the two viewers
 * cannot drift into using different view vocabularies, and so geometry code does
 * not have to import an adapter to learn what a view is.
 */
export type ViewName = CameraPreset;

export interface ViewerCapabilities {
  /** Can raycast pixels back to an asiId. */
  picking: boolean;
  /** Can move a camera to a named view. */
  cameraPresets: boolean;
  /** Can hide whole tissue layers. */
  layers: boolean;
  /** Needs a GPU context; false for the 2D fallback. */
  requiresGpu: boolean;
}

export interface RenderedViewer extends AnatomyAdapter {
  readonly capabilities: ViewerCapabilities;
  /**
   * Attach to a host element and start rendering. Resolves once the viewer is
   * usable. Must reject rather than throw synchronously on failure so the
   * workspace can fall back to 2D instead of showing a blank canvas.
   */
  mount(host: HTMLElement): Promise<void>;
  /** Resize to the host's content box. Must be safe to call before mount. */
  resize(width: number, height: number): void;
  /** Move the camera to a named anatomical view. */
  focusCamera(preset: CameraPreset, opts?: { immediate?: boolean }): void;
  /**
   * Resolve a pixel to an asiId. `clientX/clientY` are viewport coordinates.
   * Returns kind 'none' rather than throwing when nothing is under the point.
   */
  pick(clientX: number, clientY: number): PickResult;
  /** Where a pinned MapPoint currently sits in normalised canvas space. */
  projectPin(point: MapPoint): MapPoint | null;
  /** True once mounted and not disposed. */
  isLive(): boolean;
  /**
   * Release GPU resources, listeners and the canvas. Idempotent, and safe to
   * call on a viewer that failed to mount. After dispose, mount() may be called
   * again on a fresh host.
   */
  dispose(): void;
}
