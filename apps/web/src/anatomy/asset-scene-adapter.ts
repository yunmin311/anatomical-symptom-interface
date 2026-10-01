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
 * The generator-name prefix that marks a manifest as synthetic.
 *
 * Exported so THREE parties can agree on it: the adapter, the embed script that
 * decides whether a manifest may become the production scene, and the tests. When it
 * lived only in the adapter, the build script could not ask the question and had to
 * guess.
 *
 * The marker lives on `generator` rather than a bespoke flag because the top level of
 * the canonical schema is intentionally not `.strict()`, so a hand-added field would
 * simply be stripped: a synthetic manifest that silently lost its own "synthetic"
 * marker is exactly the confusion this prevents. The prefix is checked, not the whole
 * string, so a generator can still version itself.
 */
export const SYNTHETIC_GENERATOR_PREFIX = 'asi-synthetic';
/**
 * Is this manifest synthetic test geometry rather than sourced anatomy?
 *
 * Read from `generator.name`, so the marker travels WITH the data instead of living
 * in a loader's head: a manifest that silently lost its own "synthetic" marker is
 * exactly the confusion this prevents.
 */
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
 * The licence that actually governs one entry.
 *
 * The canonical schema makes `entry.licence` REQUIRED, so an entry is not merely
 * permitted to narrow the manifest-level licence — it states one. The top-level
 * `manifest.licence` is the default the generator fills each entry from, and the
 * documentation says it "applies unless an entry overrides it". Both readings lead
 * to the same operational answer, and it is not `manifest.licence`: the value that
 * governs an entry is the one ON that entry.
 *
 * Reading `manifest.licence` instead would be the dangerous choice precisely when it
 * differs, because the whole point of an override is that the entry's licence is
 * not the default. It would display a licence the entry is not actually under.
 *
 * This is deliberately NOT a schema change. The canonical manifest is right to
 * allow per-entry overrides and to require a value on every entry; what is wrong
 * is a renderer that silently drops some of them.
 */
export function effectiveLicence(entry: AssetManifestEntry): AssetManifestEntry['licence'] {
  return entry.licence;
}

/**
 * Fields that must agree across every entry for one scene to carry one attribution.
 *
 * `conceptId` is DELIBERATELY ABSENT: it identifies a concept inside the release, so
 * two structures in the same file have different ones by design and requiring them
 * to match would refuse every real manifest.
 *
 * Everything listed here is either part of the licence the user must be shown or a
 * release-level fact the citation depends on. `archive` and `doi` are included
 * because they appear in the provenance the panel prints; a scene whose entries
 * disagree about which archive they came from cannot honestly be cited once.
 */
const HOMOGENEOUS_FIELDS = [
  'licence.id',
  'licence.name',
  'licence.url',
  'licence.attribution',
  'licence.verifiedOn',
  'source.dataset',
  'source.release',
  'source.archive',
  'source.doi',
] as const;

function fieldOf(entry: AssetManifestEntry, field: (typeof HOMOGENEOUS_FIELDS)[number]): string {
  if (field.startsWith('licence.')) {
    return String(effectiveLicence(entry)[field.slice('licence.'.length) as 'id'] ?? '');
  }
  return String(entry.source[field.slice('source.'.length) as 'dataset'] ?? '');
}

/**
 * Refuse a manifest whose entries do not share one attribution.
 *
 * A `RendererSceneManifest` has ONE `attribution`, because the panel can only show
 * one and because "these assets" is what a user is being asked to trust. A manifest
 * that mixes datasets, releases or licences cannot be represented by that, and the
 * alternatives are both worse than failing:
 *
 *  - Take the first entry's provenance (what this did): every other entry is then
 *    displayed under a licence or a dataset it is not under. For a CC BY asset shown
 *    beside an MIT one, or a commercial dataset shown as BodyParts3D, that is a
 *    licence misstatement — not a cosmetic bug.
 *  - Union them into one string: a fabricated citation naming sources and terms
 *    that were never issued together.
 *
 * So it throws. The canonical schema still ALLOWS per-entry overrides, because a
 * future multi-dataset manifest is legitimate; the limit is that ONE scene carries
 * ONE attribution. Mixed datasets become multiple scenes or explicit attribution
 * groups, which is a renderer-contract change to be designed rather than guessed at
 * here.
 */
export function assertProvenanceHomogeneous(manifest: AssetManifest): void {
  const [first, ...rest] = manifest.entries;
  if (!first) return;

  const offenders: string[] = [];
  for (const entry of rest) {
    for (const field of HOMOGENEOUS_FIELDS) {
      const a = fieldOf(first, field);
      const b = fieldOf(entry, field);
      // Empty-vs-empty is agreement; a value against an absent one is not, because
      // the panel would print one and the other entry would print nothing.
      if (a !== b)
        offenders.push(
          `${field}: ${first.asiId} says ${JSON.stringify(a)}, ${entry.asiId} says ${JSON.stringify(b)}`,
        );
    }
  }

  if (offenders.length)
    throw new SceneManifestError(
      `a renderer scene carries ONE attribution, so every entry must agree on licence and source provenance.\n` +
        `  These entries disagree:\n${offenders.map((o) => `    - ${o}`).join('\n')}\n` +
        `  Split a mixed manifest into multiple scenes or explicit attribution groups rather than ` +
        `displaying one entry's licence for another.`,
    );
}

/**
 * Build the attribution the renderer displays.
 *
 * Everything here comes from the canonical manifest; nothing is written by hand, and
 * nothing is taken from `entries[0]` as a representative. The caller must have run
 * `assertProvenanceHomogeneous`, so every entry agrees and the first entry is a
 * genuine value rather than a sample — the distinction matters, because "they all
 * agree" and "I only read one" produce identical output until they do not.
 *
 * For a synthetic manifest the licence describes geometry this repository
 * generated, which is truthful, and `synthetic` is set so the UI can be explicit
 * that this is a test asset rather than a source dataset.
 */
export function deriveAttribution(
  manifest: AssetManifest,
): RendererSceneAttribution & { synthetic: boolean } {
  assertProvenanceHomogeneous(manifest);

  // Safe to read entry 0 AFTER the homogeneity check: every entry agrees.
  const reference = manifest.entries[0]!;
  const licence = effectiveLicence(reference);
  const source = reference.source;

  return {
    licence: {
      id: licence.id,
      name: licence.name,
      url: licence.url,
      attribution: licence.attribution,
      verifiedOn: licence.verifiedOn,
    },
    source: {
      dataset: source.dataset,
      release: source.release,
      doi: source.doi ?? null,
      archive: source.archive ?? null,
      // NO conceptId. It is a per-structure fact and this is a scene-level one; see
      // RendererSceneAttribution. It travels on the entry's `provenance` instead.
    },
    notice: deriveAssetNotice(licence, source),
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
    // Dataset-agnostic. `bodyparts3d` used to be the non-synthetic value, which meant
    // EVERY external manifest was labelled BodyParts3D — a Z-Anatomy scene, one of
    // our own, or a mixed one. The renderer must not name a supplier it was not
    // told about; the real name is `attribution.source.dataset`.
    source: synthetic ? 'fixture' : 'external',
    // 8. licence/source are NOT copied into a second authority; the renderer gets
    //    the DERIVED notice, and the structured fields it was computed from.
    //    Deriving it is also what ENFORCES homogeneity: a mixed manifest throws
    //    above rather than being reported under entries[0]'s provenance.
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
