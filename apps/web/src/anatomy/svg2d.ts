/**
 * SVG body map: the always-available viewer.
 *
 * This is not a placeholder to be replaced by 3D. It is the mobile path, the
 * accessibility path, the low-power path and the fast overview, and it has to
 * work when nothing else does. Geometry lives in `svg-geometry.ts`; this file
 * owns state and the adapter contract.
 *
 * Deliberately schematic: a hit-target and orientation system, not an atlas. The
 * shapes do not claim to be anatomy, and the UI labels them as schematic.
 */
import { REGIONS, TISSUE_LAYER_ORDER } from '@asi/shared';
import type { BodyRegion, Depth, Structure, SubRegion, TissueLayer } from '@asi/shared';
import {
  ZONES,
  ZONE_INDEX,
  firstViewFor,
  silhouetteFor,
  zonesForRegionView,
} from './svg-geometry.ts';
import type {
  AnatomyAdapter,
  BodyPin,
  CameraPreset,
  MapPoint,
  ViewerCommand,
  ViewerState,
  ViewName,
} from './types.ts';
import { layersForDepth } from './three3d.ts';

export type { ViewName };

/** Which view each region opens in, because "back of the knee" starts at the back. */
export const REGION_DEFAULT_VIEW: Record<BodyRegion, ViewName> = {
  shoulder: 'anterior',
  neck: 'anterior',
  lower_back: 'posterior',
  knee: 'anterior',
};

export const VIEW_LABEL: Record<ViewName, string> = {
  anterior: 'Front',
  posterior: 'Back',
  lateral_left: 'Left side',
  lateral_right: 'Right side',
};

const initialState = (): ViewerState => ({
  region: 'shoulder',
  visibleSubRegionIds: [],
  visibleLayers: [...TISSUE_LAYER_ORDER],
  selectedStructureIds: [],
  highlightedStructureIds: [],
  rejectedStructureIds: [],
  pins: [],
  activePin: null,
});

export class Svg2dAnatomyAdapter implements AnatomyAdapter {
  readonly kind = 'svg2d';
  private state: ViewerState = initialState();
  private view: ViewName = 'anterior';
  private listeners = new Set<(state: ViewerState) => void>();
  private disposed = false;

  getState(): ViewerState {
    return this.state;
  }

  getView(): ViewName {
    return this.view;
  }

  subscribe(fn: (state: ViewerState) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
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
        this.view = cmd.view as ViewName;
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
        } else {
          s.highlightedStructureIds = [
            ...new Set([...s.highlightedStructureIds, ...set]),
          ];
        }
        s.rejectedStructureIds = s.rejectedStructureIds.filter((id) => !set.has(id));
        break;
      }
      case 'reject': {
        const set = new Set(cmd.structureIds);
        s.rejectedStructureIds = [...new Set([...s.rejectedStructureIds, ...set])];
        s.selectedStructureIds = s.selectedStructureIds.filter((id) => !set.has(id));
        s.highlightedStructureIds = s.highlightedStructureIds.filter((id) => !set.has(id));
        break;
      }
      case 'clearReject':
        s.rejectedStructureIds = s.rejectedStructureIds.filter(
          (id) => !cmd.structureIds.includes(id),
        );
        break;
      case 'setSelected':
        // Replace, never merge: a deselected id has to be able to leave.
        s.selectedStructureIds = [...new Set(cmd.structureIds)];
        s.highlightedStructureIds = s.highlightedStructureIds.filter(
          (id) => !s.selectedStructureIds.includes(id),
        );
        s.rejectedStructureIds = s.rejectedStructureIds.filter(
          (id) => !s.selectedStructureIds.includes(id),
        );
        break;
      case 'setHighlighted':
        s.highlightedStructureIds = [...new Set(cmd.structureIds)];
        s.selectedStructureIds = s.selectedStructureIds.filter(
          (id) => !s.highlightedStructureIds.includes(id),
        );
        break;
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
        s.visibleLayers = layersForDepth(cmd.depth);
        break;
    }
    this.emit();
  }

  /** Silhouette parts for the current view. */
  silhouette(): Record<string, string> {
    return silhouetteFor(this.view);
  }

  /**
   * Zones drawn in the current view, restricted to the focused region. Never
   * return another region's targets: the map is a locating tool, not a board of
   * every possible area at once.
   */
  zones() {
    return zonesForRegionView(this.state.region, this.view);
  }

  zone(subRegionId: string) {
    return ZONE_INDEX.get(subRegionId);
  }

  /** The view that can show a sub-region, or null when the map cannot draw it. */
  viewForSubRegion(subRegionId: string): ViewName | null {
    return firstViewFor(subRegionId);
  }

  allZones() {
    return ZONES;
  }

  /** Structures clickable right now, honouring layer visibility and rejection. */
  pickableStructures(): Structure[] {
    const visible = new Set(this.state.visibleLayers);
    const subs = this.state.visibleSubRegionIds.length
      ? this.state.visibleSubRegionIds
      : REGIONS[this.state.region].subRegions.map((x) => x.id);
    const seen = new Map<string, Structure>();
    for (const id of subs) {
      const structures =
        REGIONS[this.state.region].subRegions.find((x) => x.id === id)?.structures ?? [];
      for (const structure of structures) {
        if (
          visible.has(structure.layer) &&
          !this.state.rejectedStructureIds.includes(structure.id)
        )
          seen.set(structure.id, structure);
      }
    }
    return [...seen.values()];
  }

  pickableSubRegions(): SubRegion[] {
    return REGIONS[this.state.region].subRegions;
  }

  /** Stable order for keyboard traversal, independent of paint order. */
  keyboardOrder(): string[] {
    return this.zones().map((zone) => zone.subRegionId);
  }

  setView(preset: CameraPreset): void {
    this.view = preset as ViewName;
    this.emit();
  }

  isLive(): boolean {
    return !this.disposed;
  }

  /** Uniform teardown with the 3D viewer; the 2D map owns no GPU resources. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

export { layersForDepth };
export type { BodyPin, MapPoint, TissueLayer, Depth };
