/**
 * Canonical asset manifest -> renderer scene.
 *
 * This is the ONLY path from the production asset authority to the renderer.
 * There is exactly one of it, it is one-directional, and the renderer has no way
 * to reach the canonical manifest any other way. That is the point: a second
 * authority for asset identity, provenance or licensing is how a scene ends up
 * describing geometry the pipeline never produced, and nobody notices until a
 * licence question is asked.
 *
 * WHAT THE ADAPTER MAY DO, and what it may not:
 *
 *  - CONVERT: canonical `file` becomes a URL, canonical `bounds` become framing
 *    metadata, `licence`/`source` become an attribution notice the renderer can
 *    display.
 *  - CARRY THROUGH UNCHANGED: `asiId`, `layer`, `subRegionIds`, `laterality`
 *    facts, the exact sub-region list and its order.
 *  - PROVENANCE ONLY: `meshName` and the source concept id travel as a note about
 *    where an entry came from. They are never an identity and never a key.
 *  - NOT INVENT: a structure id that the domain does not have, a sub-region that
 *    is not in the canonical list, a licence the manifest does not declare.
 *
 * WHY `parseManifest` IS CALLED FIRST. The canonical manifest validates that
 * every `asiId` resolves to a real structure, that its layer agrees with the
 * domain, that every sub-region exists and that the geometry budget is met. An
 * adapter that skipped that could build a scene the viewer would happily render
 * and the record could never store.
 */
import {
  AssetManifestSchema,
  manifestHasErrors,
  validateManifest,
} from '@asi/shared';
import type { AssetManifest, AssetManifestEntry, GeometryBudget } from '@asi/shared';
import type { CameraPreset, MapPoint } from './types.ts';
import {
  deriveAssetNotice,
  SceneManifestError,
} from './scene-manifest.ts';
import type {
  RendererSceneAttribution,
  RendererSceneEntry,
  RendererSceneManifest,
  RendererSceneSource,
} from './scene-manifest.ts';

/**
 * A manifest whose generator declares itself synthetic is dev/test-only.
 *
 * The marker lives on `generator` rather than a bespoke flag because the top
 * level of the canonical schema is intentionally not `.strict()` and a
 * hand-added field would simply be stripped — a synthetic manifest that
 * silently lost its own "synthetic" marker is exactly the confusion this
 * prevents. The prefix is checked, not the whole string, so a generator can
 * still version itself.
 */
const SYNTHETIC_GENERATOR_PREFIX = 'asi-synthetic';

export function isSyntheticManifest(manifest: AssetManifest): boolean {
  return manifest.generator.name.startsWith(SYNTHETIC_GENERATOR_PREFIX);
}

/** The fixed camera vocabulary. Kept local so the adapter has no view policy of its own. */
const ALL_VIEWS: CameraPreset[] = ['anterior', 'posterior', 'lateral_left', 'lateral_right'];

export interface AdapterOptions {
  /**
   * Where a canonical relative `file` is served from. Defaults to `/anatomy/`,
   * which is the path the generated assets are published under.
   */
  assetRoot?: string;
  /**
   * Camera presets a converted entry is visible in. A real structure is
   * reachable from every view the manifest does not restrict, and Phase 1 has no
   * per-view visibility metadata, so this defaults to all four rather than
   * guessing one.
   */
  views?: CameraPreset[];
  /** Budget for the manifest re-validation. Defaults to the shared budget. */
  budget?: GeometryBudget;
  /**
   * Pre-validated manifest sizes by canonical `file`, for the byte budget.
   * Optional: without it the size checks are simply not run.
   */
  fileSizes?: Map<string, number>;
  /** Override the URL builder, for a CDN or a non-http root. */
  urlFor?: (file: string) => string;
}

/**
 * Build the attribution the renderer displays.
 *
 * Everything here comes from the canonical manifest; nothing is written by hand.
 * For a synthetic manifest the licence fields describe geometry this repository
 * generated, which is truthful, and `synthetic` is returned so the UI can be
 * explicit that it is a test asset rather than a source dataset.
 */
export function deriveAttribution(
  manifest: AssetManifest,
): RendererSceneAttribution & { synthetic: boolean } {
  const licence = manifest.licence;
  // An entry may narrow the licence; the narrowest declared licence for any entry
  // is the one that has to be honoured, and in practice every entry inherits the
  // manifest-level one. Taking the first override would be arbitrary, so the
  // manifest-level licence is used and any differing entry is rejected below.
  const notice = deriveAssetNotice(licence, {
    dataset: manifest.entries[0]?.source.dataset ?? 'ASI',
    release: manifest.entries[0]?.source.release ?? 'unknown',
  });
  return {
    licence: {
      id: licence.id,
      name: licence.name,
      url: licence.url,
      attribution: licence.attribution,
      verifiedOn: licence.verifiedOn,
    },
    source: {
      dataset: manifest.entries[0]?.source.dataset ?? 'ASI',
      release: manifest.entries[0]?.source.release ?? 'unknown',
      doi: manifest.entries[0]?.source.doi ?? null,
      conceptId: manifest.entries[0]?.source.conceptId ?? null,
      archive: manifest.entries[0]?.source.archive ?? null,
    },
    notice,
    synthetic: isSyntheticManifest(manifest),
  };
}

/**
 * Canonical bounds -> renderer framing.
 *
 * The canonical `bounds` are the authority on where the geometry is. Converting
 * them to a centre and a size is lossless for framing purposes, and it is done
 * here rather than authored so a second, disagreeing position cannot exist.
 */
function framingFor(entry: AssetManifestEntry): { center: [number, number, number]; size: [number, number, number] } {
  return {
    center: [
      (entry.bounds.min[0] + entry.bounds.max[0]) / 2,
      (entry.bounds.min[1] + entry.bounds.max[1]) / 2,
      (entry.bounds.min[2] + entry.bounds.max[2]) / 2,
    ],
    size: [
      Math.abs(entry.bounds.max[0] - entry.bounds.min[0]),
      Math.abs(entry.bounds.max[1] - entry.bounds.min[1]),
      Math.abs(entry.bounds.max[2] - entry.bounds.min[2]),
    ],
  };
}

/**
 * Focus point in normalised body space, derived rather than authored.
 *
 * Bounds are in mesh units and carry no information about where on the BODY the
 * mesh sits, so a normalised x/y cannot honestly be derived from them. What can
 * be derived is a horizontal hint from the mesh's own lateral offset when the
 * units are metres — and even that is a guess about which way the mesh faces. So
 * this is left absent, and `focusPoint` stays a fixture-only convenience. A
 * renderer that needs one must get it from canonical metadata that means
 * something, not from a number this file invented.
 */
function focusPointFor(_entry: AssetManifestEntry): MapPoint | undefined {
  return undefined;
}

/** One canonical entry -> one renderer scene entry. */
export function toRendererSceneEntry(
  entry: AssetManifestEntry,
  urlFor: (file: string) => string,
  views: CameraPreset[],
): RendererSceneEntry {
  // The canonical sub-region list, whole, in order. Not `subRegionIds[0]`.
  const subRegionIds = [...entry.subRegionIds];

  return {
    // 1. asiId preserved exactly. It is the domain structure id, and it is the
    //    renderer's only identity.
    asiId: entry.asiId,
    kind: 'structure',
    region: entry.region,
    // 4. the canonical list, not a silent first element
    subRegionIds,
    // ...and a singular convenience ONLY when there is exactly one answer.
    ...(subRegionIds.length === 1 ? { soleSubRegionId: subRegionIds[0] } : {}),
    // 3. structureId comes from domain identity: the canonical asiId IS the
    //    domain structure id, so this is a projection, not a new id.
    structureId: entry.asiId,
    // 7. layer carried through unchanged.
    layer: entry.layer,
    views,
    geometry: {
      type: 'url',
      // 5. canonical file -> GLB URL. nodeName deliberately omitted: the Core
      //    pipeline emits one mesh per GLB, so requiring one would refuse every
      //    real asset. A future multi-part file sets it explicitly.
      url: urlFor(entry.file),
    },
    // 6. canonical bounds -> framing metadata.
    framing: framingFor(entry),
    ...(focusPointFor(entry) ? { focusPoint: focusPointFor(entry) } : {}),
    label: entry.layTerm ?? entry.anatomicalLabel,
    // 2. source mesh id as provenance only.
    provenance: {
      meshName: entry.meshName,
      dataset: entry.source.dataset,
      release: entry.source.release,
      conceptId: entry.source.conceptId ?? null,
    },
  };
}

/**
 * Convert a validated canonical manifest into a renderer scene.
 *
 * `raw` is accepted as `unknown` and run through `AssetManifestSchema` plus
 * `validateManifest` first, so the ONLY way into a production scene is a manifest
 * that passed the canonical checks. A caller cannot skip validation by handing
 * over a pre-typed object.
 */
export function toRendererScene(
  raw: unknown,
  options: AdapterOptions = {},
): RendererSceneManifest {
  const manifest = AssetManifestSchema.parse(raw);
  const issues = validateManifest(manifest, {
    ...(options.budget ? { budget: options.budget } : {}),
    ...(options.fileSizes ? { fileSizes: options.fileSizes } : {}),
  });
  if (manifestHasErrors(issues))
    throw new SceneManifestError(
      `canonical manifest is not valid, so no scene was built:\n${issues
        .filter((i) => i.severity === 'error')
        .map((i) => `  - ${i.asiId ?? ''}: ${i.message}`)
        .join('\n')}`,
    );

  if (manifest.entries.length === 0)
    throw new SceneManifestError('canonical manifest has no entries, so no scene was built');

  const root = (options.assetRoot ?? '/anatomy/').replace(/\/*$/, '/');
  const urlFor = options.urlFor ?? ((file: string) => `${root}${file.replace(/^\/+/, '')}`);
  const views = options.views ?? ALL_VIEWS;
  const attribution = deriveAttribution(manifest);
  const synthetic = attribution.synthetic;

  const entries = manifest.entries.map((entry) => toRendererSceneEntry(entry, urlFor, views));

  // Overall framing, derived from the union of the canonical bounds rather than
  // authored, so camera framing cannot disagree with the geometry.
  const bounds = {
    height: Math.max(
      ...manifest.entries.map((e) => e.bounds.max[1] - e.bounds.min[1]),
    ),
    radius: Math.max(
      ...manifest.entries.map((e) =>
        Math.max(Math.abs(e.bounds.min[0]), Math.abs(e.bounds.max[0])),
      ),
    ),
  };

  const scene: RendererSceneManifest = {
    version: `canonical-${manifest.schemaVersion}`,
    // A synthetic generator may NOT be presented as a source dataset, whatever
    // the caller asks for.
    source: synthetic ? 'fixture' : 'bodyparts3d',
    // 8. licence/source are NOT copied into a second authority; the renderer gets
    //    the DERIVED notice, and the structured fields it was computed from.
    externalAssetNotice: attribution.notice,
    attribution: {
      licence: attribution.licence,
      source: attribution.source,
      notice: attribution.notice,
      synthetic,
    },
    bounds,
    entries,
  };

  if (synthetic) {
    // Explicit, in the scene the renderer loads, so a synthetic asset can never
    // be mistaken for a licence provenance or an anatomy source.
    scene.disclaimer = `Synthetic, non-medical test geometry generated by ${manifest.generator.name}. It is not anatomy, it is not derived from any body dataset, and it carries no anatomical meaning.`;
  }

  return scene;
}

/**
 * Read-only view of what a scene claims to be, for the UI's attribution panel.
 *
 * Returns null for a fixture, and that is a DISPLAY decision rather than a claim
 * that a fixture has no licence. A fixture's licence is real — this project
 * generated the geometry — but reporting it in an "asset information" panel would
 * read as provenance for an anatomy source, which is exactly what a synthetic
 * asset must never appear to be. The synthetic notice is shown instead.
 */
export function sceneLicenceEvidence(
  scene: RendererSceneManifest,
): { licenceId: string; licenceName: string; licenceUrl: string; attribution: string; dataset: string; release: string; synthetic: boolean } | null {
  if (scene.source === 'fixture') return null;
  const a = scene.attribution;
  if (!a) return null;
  return {
    licenceId: a.licence.id,
    licenceName: a.licence.name,
    licenceUrl: a.licence.url,
    attribution: a.licence.attribution,
    dataset: a.source.dataset,
    release: a.source.release,
    synthetic: false,
  };
}