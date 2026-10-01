/**
 * RENDERER SCENE CONTRACT — not the production asset manifest.
 *
 * This file describes how a piece of geometry is handed to the viewer: which
 * mesh, which views, which tissue layer, roughly where to point the camera. It
 * exists so the renderer contract can be built and tested before any real asset
 * exists, and so the renderer never has to know where geometry came from.
 *
 * It is deliberately NOT the authoritative description of an anatomy asset.
 * Asset identity, provenance and licensing are domain concerns and belong to the
 * canonical shared manifest (`packages/shared/src/anatomy-manifest.ts`, landing
 * with `phase1/core-foundation`). This file carries no licence, no source
 * attestation and no asset provenance, and nothing here may be cited as such.
 * When the canonical manifest lands, an adapter converts it into this scene
 * shape; reconciliation between the two is integration work, deliberately out of
 * scope here.
 *
 * Phase 1A ships a fixture manifest only. It is procedurally generated,
 * deliberately non-medical geometry whose sole purpose is to prove the
 * renderer contract. `assertNonMedical` refuses to let it be mistaken for an
 * anatomy source, and the UI surfaces `disclaimer` whenever a fixture is active.
 */
import type { BodyRegion, Structure, SubRegion, TissueLayer } from '@asi/shared';
import type { CameraPreset, MapPoint } from './types.ts';

export type ManifestSource = 'fixture' | 'bodyparts3d';

export interface ManifestEntry {
  /**
   * The stable business id. Structure ids match @asi/shared structure ids so a
   * manifest cannot invent anatomy the domain does not know about; fixture
   * geometry uses the `<region>.<subRegion>.<part>` form instead.
   */
  asiId: string;
  kind: 'subregion' | 'structure';
  region: BodyRegion;
  subRegionId?: string;
  /** @asi/shared structure id. Absent for fixture geometry. */
  structureId?: string;
  /** Tissue layer, used for layer visibility. */
  layer: TissueLayer;
  /** Which camera presets show this entry. */
  views: CameraPreset[];
  /**
   * How to build the geometry. `primitive` entries are generated in code and
   * carry no external asset; `url` entries are fetched and are the path a real
   * GLB pipeline will use.
   */
  geometry:
    | {
        type: 'primitive';
        shape: 'box' | 'sphere' | 'cylinder' | 'capsule';
        /** Centre in manifest units; y is up, origin at the body centre. */
        position: [number, number, number];
        scale: [number, number, number];
        /** Radians about each axis, applied after scale. */
        rotation?: [number, number, number];
      }
    | {
        type: 'url';
        url: string;
        /** Sub-range of the asset to use, when one file holds many parts. */
        nodeName?: string;
        position?: [number, number, number];
        scale?: [number, number, number];
        rotation?: [number, number, number];
      };
  /**
   * Approximate centre in normalised body space, used for camera focus and for
   * the 2D cross-view indicator. Not a hit target: picking is always done by
   * the renderer.
   */
  focusPoint?: MapPoint;
  /** Shown when a user cannot use the canvas. Never a clinical claim. */
  label?: string;
}

export interface AnatomyManifest {
  /** Bumped when entry shape changes, so a stale cache is detectable. */
  version: string;
  source: ManifestSource;
  /**
   * Present when source is 'fixture'. The UI surfaces this so a fixture can
   * never read as a finished anatomy product.
   */
  disclaimer?: string;
  /** Overall height of the figure in manifest units, for camera framing. */
  bounds: { height: number; radius: number };
  entries: ManifestEntry[];
}

export class ManifestError extends Error {}

/**
 * Build the `asiId` -> entry index and validate the invariants the renderer
 * depends on. Returns the index; the manifest is treated as immutable.
 */
export function indexManifest(manifest: AnatomyManifest): Map<string, ManifestEntry> {
  const index = new Map<string, ManifestEntry>();
  for (const entry of manifest.entries) {
    if (!entry.asiId) throw new ManifestError('every manifest entry needs an asiId');
    if (index.has(entry.asiId))
      throw new ManifestError(`duplicate asiId in manifest: ${entry.asiId}`);
    if (entry.kind === 'structure' && !entry.structureId)
      throw new ManifestError(
        `structure entry ${entry.asiId} must name a structureId to bind to the domain`,
      );
    if (entry.views.length === 0)
      throw new ManifestError(`entry ${entry.asiId} is visible in no view`);
    index.set(entry.asiId, entry);
  }
  if (index.size === 0) throw new ManifestError('manifest has no entries');
  return index;
}

/**
 * Guard against a fixture being presented as anatomy. The Phase 1A fixture is
 * a set of primitives, not a body, and the product must say so out loud.
 */
export function assertNonMedical(manifest: AnatomyManifest): void {
  if (manifest.source !== 'fixture') return;
  if (!manifest.disclaimer)
    throw new ManifestError('a fixture manifest must carry a disclaimer');
  if (manifest.entries.some((entry) => entry.geometry.type !== 'primitive'))
    throw new ManifestError(
      'a fixture manifest must not reference external assets: it would imply anatomy it does not have',
    );
}

/** Entries of a region, optionally narrowed to the ones a camera preset shows. */
export function entriesFor(
  manifest: AnatomyManifest,
  region: BodyRegion,
  view?: CameraPreset,
  layerVisible?: (layer: TissueLayer) => boolean,
): ManifestEntry[] {
  return manifest.entries.filter(
    (entry) =>
      entry.region === region &&
      (!view || entry.views.includes(view)) &&
      (!layerVisible || layerVisible(entry.layer)),
  );
}

/**
 * Cross-check a manifest against the domain ontology. Catches the failure mode
 * where an asset claims a structure the domain does not have, which would let
 * the viewer highlight something the record cannot store.
 */
export function verifyAgainstOntology(
  manifest: AnatomyManifest,
  subRegions: SubRegion[],
  structures: Structure[],
): void {
  const subIds = new Set(subRegions.map((s) => s.id));
  const structureIds = new Set(structures.map((s) => s.id));
  for (const entry of manifest.entries) {
    if (entry.subRegionId && !subIds.has(entry.subRegionId))
      throw new ManifestError(
        `${entry.asiId} names sub-region ${entry.subRegionId}, which the ontology does not define`,
      );
    if (entry.structureId && !structureIds.has(entry.structureId))
      throw new ManifestError(
        `${entry.asiId} names structure ${entry.structureId}, which the ontology does not define`,
      );
  }
}
