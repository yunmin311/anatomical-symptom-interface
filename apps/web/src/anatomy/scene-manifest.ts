/**
 * RENDERER SCENE CONTRACT — not the production asset manifest.
 *
 * This file describes how a piece of geometry is handed to the viewer: which
 * mesh, which views, which tissue layer, roughly where to point the camera. It
 * exists so the renderer can be built and tested, and so the renderer never has
 * to know where geometry came from.
 *
 * IT IS NOT THE ASSET AUTHORITY, AND THE NAMES SAY SO. The production authority
 * is the canonical `AssetManifest` in `@asi/shared`
 * (`packages/shared/src/anatomy-manifest.ts`), which owns asset identity,
 * provenance, licensing, FMA bindings and geometry metadata. These types are
 * named `RendererScene*` rather than `RendererSceneManifest` precisely because two
 * files called "the manifest" is how a renderer scene quietly becomes treated as
 * licence evidence. There is exactly one adapter between them
 * (`./asset-scene-adapter.ts`) and it is one-directional: canonical in, scene
 * out. Nothing here may be cited as provenance, and no second authority may be
 * hand-written here.
 *
 * ATTRIBUTION IS DERIVED, NOT AUTHORED. `externalAssetNotice` exists because the
 * renderer has to display something, but on a production scene it is
 * *computed* from `attribution`, which the adapter fills from the canonical
 * manifest's `licence` and `source`. `assertSceneAttribution` recomputes the
 * notice and refuses a scene whose string disagrees, so a hand-written notice
 * cannot be used to route around the canonical manifest.
 *
 * Phase 1A ships a fixture scene: procedurally generated, deliberately
 * non-medical geometry whose sole purpose is to prove the renderer contract.
 * `assertNonMedical` refuses to let it be mistaken for an anatomy source, and the
 * UI surfaces `disclaimer` whenever a fixture is active.
 */
import type { BodyRegion, Structure, SubRegion, TissueLayer } from '@asi/shared';
import type { CameraPreset, MapPoint } from './types.ts';

/**
 * Which body of geometry a scene is made of.
 *
 * Dataset-AGNOSTIC on purpose. It used to be `'fixture' | 'bodyparts3d'`, which
 * named one supplier in a contract the renderer should not know anything about:
 * every non-synthetic manifest would be labelled BodyParts3D, including a Z-Anatomy
 * scene, one of our own, or a mix — and the label would be a guess presented as a
 * fact. The dataset name belongs in exactly one place, `attribution.source.dataset`,
 * which comes from the canonical manifest.
 *
 * So the renderer contract says only what it can honestly tell: synthetic
 * placeholder geometry, or real geometry from an external source it does not name.
 */
export type RendererSceneSource = 'fixture' | 'external';

export interface RendererSceneEntry {
  /**
   * The stable business id, carried through from the canonical manifest
   * unchanged. This is the ONLY identity the renderer has: no mesh name, no
   * three.js UUID and no DOM handle may appear where an id is needed.
   */
  asiId: string;
  kind: 'subregion' | 'structure';
  region: BodyRegion;
  /**
   * The CANONICAL sub-region list, whole and in order.
   *
   * A real structure can legitimately be reachable from more than one
   * sub-region — `asi:shoulder.deltoid` is selectable from both
   * `shoulder.anterior` and `shoulder.lateral`, and one mesh serves both. This
   * list is that truth, so it is carried whole rather than collapsed. Reading
   * `subRegionIds[0]` as "the" sub-region is exactly the silent truncation this
   * shape exists to prevent; use `soleSubRegionId` when a single answer is
   * genuinely unambiguous.
   */
  subRegionIds: string[];
  /**
   * Present ONLY when `subRegionIds` has exactly one member, i.e. when there is
   * exactly one correct answer. Absent for the many-sub-region case, because a
   * convenience field that guesses is worse than none.
   */
  soleSubRegionId?: string;
  /** @asi/shared structure id. Absent for sub-region proxy geometry. */
  structureId?: string;
  /** Tissue layer, used for layer visibility. Carried through unchanged. */
  layer: TissueLayer;
  /** Which camera presets show this entry. */
  views: CameraPreset[];
  /**
   * How to build the geometry. `primitive` entries are generated in code and
   * carry no external asset; `url` entries are fetched, and mount() does not
   * report ready until they have all loaded.
   *
   * `nodeName` is OPTIONAL and must stay optional. The Core pipeline emits one
   * mesh per GLB, so requiring a node name would make the production adapter
   * refuse every real asset it is meant to consume. It exists for a future file
   * that packs several parts.
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
   * Camera-framing metadata CONVERTED from the canonical `bounds`.
   *
   * The canonical bounds are the authority on where the geometry is; these are a
   * derived convenience for the renderer, never an independently authored
   * position. Absent on hand-built fixture entries, which have no canonical
   * bounds to convert.
   */
  framing?: { center: [number, number, number]; size: [number, number, number] };
  /**
   * Approximate centre in normalised body space, used for camera focus and for
   * the 2D cross-view indicator. Not a hit target: picking is always done by the
   * renderer.
   */
  focusPoint?: MapPoint;
  /**
   * Human-readable name. On a production scene this is derived from the
   * canonical `anatomicalLabel` / `layTerm`, so the same string cannot appear in
   * two spellings in two authorities.
   */
  label?: string;
  /**
   * Source mesh name, PROVENANCE ONLY.
   *
   * Carried so a renderer diagnostic can say which upstream part an entry came
   * from. It must never be used as an identity, a lookup key or a substitute for
   * `asiId`: third-party terminologies get re-numbered and renamed, and an
   * upstream rename must not repoint a saved selection.
   */
  provenance?: { meshName: string; dataset: string; release: string; conceptId?: string | null };
}

/**
 * Where a scene's assets came from, converted from the canonical manifest.
 *
 * This is a DERIVED VIEW of `licence` and `source`, not a second copy that can be
 * edited: `notice` is computed from the two fields beside it and
 * `assertSceneAttribution` fails if it does not match.
 *
 * `synthetic` says the geometry was generated by this repository rather than
 * taken from a body dataset. It is true for a fixture and it is what makes a
 * licence line on a fixture meaningful instead of decorative: this project
 * generated the quads, so dedicating them is a true statement, whereas printing
 * a real dataset's licence beside synthetic geometry would be a fabrication.
 */
export interface RendererSceneAttribution {
  licence: { id: string; name: string; url: string; attribution: string; verifiedOn: string };
  source: { dataset: string; release: string; doi?: string | null; conceptId?: string | null; archive?: string | null };
  /** The exact string the renderer must display. Derived; never authored. */
  notice: string;
  /** True when the geometry was generated here, not taken from a body dataset. */
  synthetic: boolean;
}

export interface RendererSceneManifest {
  /** Bumped when entry shape changes, so a stale cache is detectable. */
  version: string;
  source: RendererSceneSource;
  /**
   * Present when source is 'fixture'. The UI surfaces this so a fixture can
   * never read as a finished anatomy product.
   */
  disclaimer?: string;
  /**
   * Required whenever any entry uses `url` geometry, whatever the source.
   *
   * A loaded file is the one thing in the renderer the product cannot vouch for
   * on its own, so it has to be attributable out loud. On a production scene it
   * is DERIVED from `attribution` (see `assertSceneAttribution`); on a fixture it
   * says the geometry is synthetic and is not a licence statement.
   */
  externalAssetNotice?: string;
  /**
   * Derived from the canonical manifest. Null on a fixture, which has no licence
   * provenance to report — a synthetic test asset must never be presented as if
   * it had a licence provenance it does not have.
   */
  attribution?: RendererSceneAttribution | null;
  /** Overall height of the figure in manifest units, for camera framing. */
  bounds: { height: number; radius: number };
  entries: RendererSceneEntry[];
}

export class SceneManifestError extends Error {}

/**
 * Compute the attribution notice from canonical licence and source fields.
 *
 * Exported so the renderer and the adapter cannot disagree about what the notice
 * says, and so the equality check in `assertSceneAttribution` has something to
 * be checked against.
 */
export function deriveAssetNotice(
  licence: { attribution: string; id: string; name: string; url: string },
  source: { dataset: string; release: string },
): string {
  const citation = `Source: ${source.dataset} (${source.release})`;
  return `${licence.attribution} Licence: ${licence.name} (${licence.id}) — ${licence.url}. ${citation}.`;
}

/**
 * Build the `asiId` -> entry index and validate the invariants the renderer
 * depends on. Returns the index; the manifest is treated as immutable.
 */
export function indexScene(manifest: RendererSceneManifest): Map<string, RendererSceneEntry> {
  const index = new Map<string, RendererSceneEntry>();
  for (const entry of manifest.entries) {
    if (!entry.asiId) throw new SceneManifestError('every scene entry needs an asiId');
    if (index.has(entry.asiId))
      throw new SceneManifestError(`duplicate asiId in scene: ${entry.asiId}`);
    if (entry.kind === 'structure' && !entry.structureId)
      throw new SceneManifestError(
        `structure entry ${entry.asiId} must name a structureId to bind to the domain`,
      );
    if (entry.views.length === 0)
      throw new SceneManifestError(`entry ${entry.asiId} is visible in no view`);

    // The convenience field is derived, so it is checked rather than trusted: an
    // entry that claims one unambiguous sub-region while listing several is
    // asserting something its own list contradicts, and a caller that trusted it
    // would silently pick for the user.
    if (entry.soleSubRegionId !== undefined && entry.subRegionIds.length !== 1)
      throw new SceneManifestError(
        `entry ${entry.asiId} declares a sole sub-region but lists ${entry.subRegionIds.length}`,
      );
    if (entry.soleSubRegionId !== undefined && entry.subRegionIds[0] !== entry.soleSubRegionId)
      throw new SceneManifestError(
        `entry ${entry.asiId} declares sole sub-region ${entry.soleSubRegionId}, which is not in its list`,
      );

    if (entry.geometry.type === 'url') {
      if (!entry.geometry.url.trim())
        throw new SceneManifestError(`entry ${entry.asiId} has url geometry with no url`);
      // A blank nodeName would silently mean "the whole file", which is the one
      // reading an author almost never intends and cannot notice.
      if (entry.geometry.nodeName !== undefined && !entry.geometry.nodeName.trim())
        throw new SceneManifestError(
          `entry ${entry.asiId} has a nodeName that is present but blank; omit it to use the whole asset`,
        );
    }
    index.set(entry.asiId, entry);
  }
  if (index.size === 0) throw new SceneManifestError('scene has no entries');
  return index;
}

/**
 * Guard against a fixture being presented as anatomy, and against a production
 * scene routing around the canonical manifest.
 *
 * A fixture MAY reference an external file — that is how the url geometry path
 * gets tested at all, and it has nothing to do with whether the result is
 * anatomy — but it must still declare itself a fixture. A production scene, by
 * contrast, MUST carry derived attribution whose notice matches, which is what
 * makes "no hand-written externalAssetNotice" enforceable rather than aspirational.
 */
export function assertNonMedical(scene: RendererSceneManifest): void {
  if (scene.source === 'fixture' && !scene.disclaimer)
    throw new SceneManifestError('a fixture scene must carry a disclaimer');
  const usesUrl = scene.entries.some((entry) => entry.geometry.type === 'url');
  if (usesUrl && !scene.externalAssetNotice?.trim())
    throw new SceneManifestError(
      'a scene that loads external assets must name them in externalAssetNotice',
    );
  // A fixture MAY carry a licence, because a fixture is geometry this repository
  // generated and dedicating it is a true statement. What it may not do is claim
  // a licence or a dataset that is not synthetic — that is synthetic geometry
  // described with a real body dataset's provenance, which is the failure mode
  // this guards.
  if (scene.source === 'fixture' && scene.attribution && !scene.attribution.synthetic)
    throw new SceneManifestError(
      'a fixture scene must not claim non-synthetic licence provenance; synthetic geometry has no source dataset',
    );
  // And a production scene must not be synthetic either, whatever its generator
  // says, because a synthetic manifest cannot be a source dataset.
  if (scene.source === 'external' && scene.attribution?.synthetic)
    throw new SceneManifestError(
      'an external scene cannot carry synthetic provenance; the generator declared itself synthetic',
    );
}

/**
 * Verify a production scene's notice really is derived from its attribution.
 *
 * Without this, `externalAssetNotice` is just a free-text field a scene author
 * could fill with anything — including something that names a licence nobody
 * ever verified. Recomputing it from the canonical-derived fields closes that.
 */
export function assertSceneAttribution(scene: RendererSceneManifest): void {
  if (!scene.attribution)
    throw new SceneManifestError(
      `scene ${scene.version} loads assets but carries no attribution; it did not come from the canonical manifest`,
    );
  const expected = deriveAssetNotice(scene.attribution.licence, scene.attribution.source);
  if (scene.externalAssetNotice !== expected)
    throw new SceneManifestError(
      'externalAssetNotice must be derived from licence.attribution, source.dataset and source.release',
    );
}

/** Entries of a region, optionally narrowed to the ones a camera preset shows. */
export function entriesFor(
  scene: RendererSceneManifest,
  region: BodyRegion,
  view?: CameraPreset,
  layerVisible?: (layer: TissueLayer) => boolean,
): RendererSceneEntry[] {
  return scene.entries.filter(
    (entry) =>
      entry.region === region &&
      (!view || entry.views.includes(view)) &&
      (!layerVisible || layerVisible(entry.layer)),
  );
}

/**
 * Cross-check a scene against the domain ontology. Catches the failure mode
 * where an asset claims a structure the domain does not have, which would let
 * the viewer highlight something the record cannot store.
 */
export function verifyAgainstOntology(
  scene: RendererSceneManifest,
  subRegions: SubRegion[],
  structures: Structure[],
): void {
  const subIds = new Set(subRegions.map((s) => s.id));
  const structureIds = new Set(structures.map((s) => s.id));
  for (const entry of scene.entries) {
    for (const sub of entry.subRegionIds) {
      if (!subIds.has(sub))
        throw new SceneManifestError(
          `${entry.asiId} names sub-region ${sub}, which the ontology does not define`,
        );
    }
    if (entry.structureId && !structureIds.has(entry.structureId))
      throw new SceneManifestError(
        `${entry.asiId} names structure ${entry.structureId}, which the ontology does not define`,
      );
  }
}

/* ------------------------------------------------------------------ *
 * Picking: sub-region vs structure
 * ------------------------------------------------------------------ */

/**
 * What should happen to the current sub-region after the user clicked something.
 *
 * A click on real geometry means "here", and a structure is reachable from
 * several sub-regions, so a click cannot tell us which one the user meant. The
 * honest answers are: keep what they already had if it still applies, adopt the
 * one and only sub-region when there is exactly one, or change nothing and let
 * the user say so. Inventing one is the one answer that is always wrong.
 */
export type SubRegionResolution =
  /** The current sub-region is one of the structure's, so nothing changes. */
  | { kind: 'keep'; subRegionId: string }
  /** Exactly one candidate, so it is unambiguous and is adopted. */
  | { kind: 'use'; subRegionId: string }
  /** Several candidates and no current match: the user must choose. */
  | { kind: 'unresolved'; candidates: string[] };

/**
 * Decide the sub-region for a picked structure.
 *
 * `currentSubRegionId` is the record's own value and is checked FIRST, because a
 * user who has already said "anterior" and then clicked a deltoid meant "that
 * deltoid, in the anterior view I was already in", not a reset to whatever the
 * manifest happens to list first.
 */
export function resolveSubRegionForStructure(
  structureSubRegionIds: string[],
  currentSubRegionId: string | null | undefined,
): SubRegionResolution {
  if (currentSubRegionId && structureSubRegionIds.includes(currentSubRegionId))
    return { kind: 'keep', subRegionId: currentSubRegionId };
  if (structureSubRegionIds.length === 1)
    return { kind: 'use', subRegionId: structureSubRegionIds[0]! };
  if (structureSubRegionIds.length === 0) return { kind: 'unresolved', candidates: [] };
  return { kind: 'unresolved', candidates: [...structureSubRegionIds] };
}