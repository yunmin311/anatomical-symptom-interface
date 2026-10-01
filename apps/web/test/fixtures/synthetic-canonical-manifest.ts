/**
 * A SYNTHETIC canonical asset manifest, for the integration proof only.
 *
 * This file exists because the real BodyParts3D archive has not been supplied
 * yet, and "we will find out when we have the asset" is how an integration is
 * assumed rather than demonstrated. It exercises the PRODUCTION path end to end
 * with geometry this repository generated itself:
 *
 *   canonical AssetManifest -> validateManifest -> asset-scene-adapter
 *   -> RendererSceneManifest -> GLB URL -> GLTFLoader -> three.js
 *   -> descendant mesh -> asiId -> structure selection
 *
 * Everything about it is labelled honestly, which is the point:
 *
 *  - The GEOMETRY is two flat quads. It is not anatomy, not derived from any body
 *    and carries no anatomical meaning. The GLB's own glTF `generator` field says
 *    so too.
 *  - The ENTRIES name real domain structures, because `validateManifest` requires
 *    every `asiId` to resolve to one and the layer to agree with the ontology.
 *    That is a schema requirement, not a claim that this quad is a deltoid.
 *  - The LICENCE describes geometry this repository generated, and the dataset is
 *    named "ASI synthetic integration fixture". It is not presented as any
 *    third-party provenance, and `isSyntheticManifest` keys off the generator
 *    name so a scene built from it can never claim to be a source dataset.
 *
 * `generator.name` starts with `asi-synthetic` on purpose: that prefix is what
 * the adapter reads to decide a manifest is dev/test-only, so the marker travels
 * with the data instead of living in the loader's head.
 *
 * It lives under `test/` and is imported by nothing in `src/`, which is what
 * makes "fixtures are dev/test only" structural rather than a convention.
 */
import type { AssetManifest } from '@asi/shared';

/**
 * Bounds of the whole fixture file, in its own units.
 *
 * Lower quad: half-extent 0.5 at the origin. Upper quad: half-extent 0.25,
 * translated by [1.5, 0.75, 0], and its vertices sit at z = 0.75 ± 0.25. So the
 * union is x -0.5..1.75, y -0.5..1.0, z 0..1.0.
 *
 * Both entries reference the whole file, so both carry the whole file's bounds.
 * Bounds are per-entry in the canonical schema because the Core pipeline emits
 * one mesh per GLB; that is the shape a real manifest will have.
 */
const FIXTURE_BOUNDS = {
  min: [-0.5, -0.5, 0] as [number, number, number],
  max: [1.75, 1.0, 1.0] as [number, number, number],
};

/** Two triangles per quad, two quads. */
const FIXTURE_TRIANGLES = 4;

const LICENCE = {
  // We generated this geometry, so a public-domain dedication is the honest
  // statement about it. It is not a licence inherited from a body dataset.
  id: 'CC0-1.0',
  name: 'CC0 1.0 Universal (public domain dedication)',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  attribution:
    'Anatomical Symptom Interface synthetic test geometry. Non-medical; not derived from any body dataset.',
  verifiedOn: '2026-10-01',
};

const SOURCE = {
  dataset: 'ASI synthetic integration fixture',
  release: '1.0.0',
  doi: null,
  conceptId: null,
  archive: null,
  retrievedAt: '2026-10-01',
};

/**
 * The integration-proof manifest.
 *
 * `asi:shoulder.deltoid` is the important entry: in the ontology it lives in
 * BOTH `shoulder.anterior` and `shoulder.lateral`, so its `subRegionIds` has two
 * members and there is no single correct sub-region. Anything in the pipeline
 * that quietly takes the first one will show up as a wrong `soleSubRegionId`
 * rather than as an obvious crash.
 *
 * `asi:shoulder.acromion` is the contrasting case: exactly one sub-region, so
 * the singular convenience is genuinely unambiguous and is expected to exist.
 */
export const SYNTHETIC_CANONICAL_MANIFEST: AssetManifest = {
  schemaVersion: 1,
  regions: ['shoulder'],
  licence: LICENCE,
  generator: {
    name: 'asi-synthetic-integration-fixture',
    version: '1.0.0',
  },
  entries: [
    {
      asiId: 'asi:shoulder.deltoid',
      meshName: 'synthetic_quad_deltoid_standin',
      region: 'shoulder',
      subRegionIds: ['shoulder.anterior', 'shoulder.lateral'],
      layer: 'muscle',
      anatomicalLabel: 'Deltoid',
      layTerm: 'the rounded muscle on the outside',
      laterality: 'bilateral',
      fma: {
        status: 'unverified',
        note: 'synthetic integration fixture; no FMA concept id, and none was checked',
      },
      source: { ...SOURCE, conceptId: 'synthetic_deltoid' },
      licence: LICENCE,
      geometry: {
        triangles: FIXTURE_TRIANGLES,
        sourceTriangles: FIXTURE_TRIANGLES,
        reduction: null,
        units: 'unitless',
      },
      bounds: FIXTURE_BOUNDS,
      file: 'non-medical-two-quads.glb',
    },
    {
      asiId: 'asi:shoulder.acromion',
      meshName: 'synthetic_quad_acromion_standin',
      region: 'shoulder',
      subRegionIds: ['shoulder.lateral'],
      layer: 'bone',
      anatomicalLabel: 'Acromion',
      layTerm: 'the bony shelf on top of the shoulder',
      laterality: 'bilateral',
      fma: {
        status: 'unverified',
        note: 'synthetic integration fixture; no FMA concept id, and none was checked',
      },
      source: { ...SOURCE, conceptId: 'synthetic_acromion' },
      licence: LICENCE,
      geometry: {
        triangles: FIXTURE_TRIANGLES,
        sourceTriangles: FIXTURE_TRIANGLES,
        reduction: null,
        units: 'unitless',
      },
      bounds: FIXTURE_BOUNDS,
      file: 'non-medical-two-quads.glb',
    },
  ],
};

/** The asset root the fixture GLB is published under, for the adapter. */
export const SYNTHETIC_ASSET_ROOT = '/fixtures/';