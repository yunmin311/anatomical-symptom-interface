/**
 * Anatomy asset manifest contract.
 *
 * The manifest is what makes the 3D layer a rendering change rather than a data
 * migration, so the properties that guarantee that are tested here rather than
 * assumed. The two that matter most:
 *
 *   1. A mesh name is never an identity. `asiId` is ours and must resolve to a
 *      real structure; the source `meshName` is provenance. If that ever inverts,
 *      an upstream rename silently repoints a user's saved visual selection at a
 *      different structure, and the record starts claiming the user pointed at
 *      something they did not.
 *   2. A manifest cannot smuggle in clinical meaning. An asset is geometry. It
 *      carries no selection state, no severity and no diagnosis, and the
 *      `selectedByUser` flag stays the domain's to compute.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AssetManifestSchema,
  DEFAULT_GEOMETRY_BUDGET,
  parseManifest,
  validateManifest,
} from '../src/anatomy-manifest.ts';
import type { AssetManifest, AssetManifestEntry } from '../src/anatomy-manifest.ts';
import { ALL_STRUCTURES, getStructure } from '../src/anatomy.ts';

const LICENCE = {
  id: 'CC-BY-4.0',
  name: 'Creative Commons Attribution 4.0 International',
  url: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html',
  attribution: 'BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International',
  verifiedOn: '2025-02-27',
};

const entry = (over: Partial<AssetManifestEntry> = {}): AssetManifestEntry => ({
  asiId: 'asi:shoulder.supraspinatus-tendon',
  meshName: 'Supraspinatus_tendon_L',
  region: 'shoulder',
  subRegionIds: ['shoulder.lateral'],
  layer: 'tendon',
  anatomicalLabel: 'Supraspinatus tendon',
  layTerm: 'the tendon that runs over the top of the shoulder joint',
  laterality: 'left',
  fma: { conceptId: '29823', status: 'unverified', note: 'bp3d 4.3i concept list' },
  source: {
    dataset: 'BodyParts3D',
    release: '4.0',
    conceptId: 'FMA:29823',
    archive: 'isa_BP3D_4.0_obj_99.zip',
    doi: '10.18908/lsdba.nbdc00837-000',
    retrievedAt: '2026-09-30',
  },
  licence: LICENCE,
  geometry: { triangles: 4200, sourceTriangles: 180000, reduction: 0.023, units: 'unitless' },
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  file: 'shoulder/asi-shoulder-supraspinatus-tendon.glb',
  ...over,
});

const manifest = (entries: AssetManifestEntry[], over: Partial<AssetManifest> = {}): AssetManifest => ({
  schemaVersion: 1,
  regions: ['shoulder'],
  licence: LICENCE,
  generator: { name: 'asi-anatomy-pipeline', version: '1.0.0' },
  entries,
  ...over,
});

const errors = (m: AssetManifest) => validateManifest(m).filter((i) => i.severity === 'error');

/* ================================================================== */

test('a well-formed shoulder manifest validates', () => {
  const issues = validateManifest(manifest([entry()]));
  assert.deepEqual(errors(manifest([entry()])), [], 'a valid manifest reported errors');
  // An unverified FMA binding is expected for generated output, not an error.
  assert.ok(issues.some((i) => i.severity === 'warning' && /FMA/.test(i.message)));
});

test('parseManifest accepts the same document and rejects a broken one', () => {
  const good = parseManifest(manifest([entry()]));
  assert.equal(good.entries.length, 1);
  assert.throws(() => parseManifest(manifest([entry({ region: 'knee' })])));
});

/* ---------------- identity is ours, not the source's ---------------- */

test('an asiId that does not exist in the domain is an error', () => {
  const m = manifest([entry({ asiId: 'asi:shoulder.not-a-real-structure' })]);
  assert.match(errors(m)[0]!.message, /does not exist in the domain/);
});

test('a source mesh name is never accepted as an id', () => {
  const m = manifest([entry({ asiId: 'Supraspinatus_tendon_L' })]);
  assert.match(errors(m)[0]!.message, /does not exist in the domain/);
  // And the schema itself refuses a non-asi id, before cross-checks run.
  assert.equal(AssetManifestSchema.safeParse(manifest([entry({ asiId: 'Supraspinatus_tendon_L' })])).success, false);
});

test('two meshes cannot claim the same asiId', () => {
  const m = manifest([
    entry(),
    entry({ meshName: 'A_different_mesh' }),
  ]);
  assert.match(errors(m).map((e) => e.message).join(' '), /duplicate asiId/);
});

test('two meshes cannot share a source mesh name', () => {
  // Two canonical ids naming the same source mesh is how one anatomical element
  // becomes two identities, so it is an error whether they are plain entries or a
  // plain entry plus a composite component.
  const m = manifest([
    entry(),
    entry({ asiId: 'asi:shoulder.infraspinatus', layer: 'muscle', subRegionIds: ['shoulder.posterior'] }),
  ]);
  assert.match(errors(m).map((e) => e.message).join(' '), /mesh is used more than once/);
});

test('renaming a mesh in the source does not change the asiId', () => {
  // The whole point of carrying meshName as provenance: an upstream rename moves
  // meshName, and the product identity must not move with it.
  const before = entry();
  const after = entry({ meshName: 'Supraspinatus_tendon_left_v2' });
  assert.equal(before.asiId, after.asiId);
  assert.notEqual(before.meshName, after.meshName);
  assert.deepEqual(errors(manifest([after])), []);
});

/* ---------------- must agree with the domain ---------------- */

test('a layer that disagrees with anatomy.ts is an error', () => {
  const real = getStructure('asi:shoulder.supraspinatus-tendon')!;
  assert.equal(real.layer, 'tendon');
  const m = manifest([entry({ layer: 'muscle' })]);
  assert.match(errors(m)[0]!.message, /layer disagrees with the domain/);
});

test('an asiId that is not a member of the declared region is an error', () => {
  // ONTOLOGY membership, not id prefixes. It used to be a prefix test, and it was
  // wrong twice over: it rejected four correct lower-back entries (the region is
  // `lower_back` while its structures are prefixed `asi:lower-back.`), and it could not
  // express the real case of a structure that legitimately belongs to two regions.
  const m = manifest([entry({ region: 'knee' })]);
  const msgs = errors(m).map((e) => e.message).join(' ');
  assert.match(msgs, /is not a member of the declared region knee/);
  assert.match(msgs, /it belongs to shoulder/, 'the error should say where it does belong');
});

test('a structure may be an entry for any region it belongs to', () => {
  // The upper trapezius is the worked example: ONE canonical id, listed in the shoulder
  // sub-regions AND the neck sub-regions, with one mesh and one provenance. A neck
  // manifest carrying it must validate, which the old prefix rule could not do -- it
  // would have read `asi:shoulder.` and rejected a correct entry.
  //
  // It appears ONCE per manifest. Two regions means two manifests, each with one
  // entry; a single manifest listing it twice is the duplicate-as-two-truths error the
  // alias work exists to prevent, and it is checked below.
  const neckEntry = entry({
    asiId: 'asi:shoulder.trapezius-upper',
    region: 'neck',
    subRegionIds: ['neck.posterior'],
    layer: 'muscle',
    file: 'neck/asi-shoulder-trapezius-upper.glb',
  });
  assert.deepEqual(
    errors(manifest([neckEntry], { regions: ['neck'] })),
    [],
  );

  const twice = manifest([neckEntry, { ...neckEntry, file: 'neck/other.glb' }]);
  assert.match(errors(twice).map((e) => e.message).join(' '), /duplicate asiId/);
});

test('an unknown sub-region is an error', () => {
  const m = manifest([entry({ subRegionIds: ['shoulder.nowhere'] })]);
  assert.match(errors(m)[0]!.message, /unknown sub-region shoulder\.nowhere/);
});

test('a structure selectable from two sub-regions lists both', () => {
  // asi:shoulder.deltoid really is in both anterior and lateral. The schema
  // allows a list precisely because the domain needs it to.
  const deltoid = getStructure('asi:shoulder.deltoid')!;
  assert.equal(deltoid.layer, 'muscle');
  const m = manifest([entry({
    asiId: 'asi:shoulder.deltoid',
    meshName: 'Deltoid_L',
    layer: 'muscle',
    anatomicalLabel: 'Deltoid',
    subRegionIds: ['shoulder.anterior', 'shoulder.lateral'],
  })]);
  assert.deepEqual(errors(m), []);
});

test('an entry whose region is not listed in manifest.regions is an error', () => {
  const m = manifest([entry()], { regions: ['knee'] });
  assert.match(errors(m).map((e) => e.message).join(' '), /not listed in manifest\.regions/);
});

/* ---------------- licence is not optional ---------------- */

test('an entry with no attribution is rejected by the schema', () => {
  const noAttr = { ...LICENCE, attribution: '' };
  assert.equal(
    AssetManifestSchema.safeParse(manifest([entry({ licence: noAttr })])).success,
    false,
    'a mesh with no attribution line must not validate',
  );
});

test('a manifest with no licence url is rejected', () => {
  assert.equal(
    AssetManifestSchema.safeParse(manifest([entry({ licence: { ...LICENCE, url: 'not a url' } })])).success,
    false,
  );
});

test('the source release and dataset are required, so a mesh can be traced back', () => {
  assert.equal(AssetManifestSchema.safeParse(manifest([entry({ source: { dataset: '', release: '', doi: null, archive: null, conceptId: null, retrievedAt: null } })])).success, false);
  assert.equal(AssetManifestSchema.safeParse(manifest([entry({ source: { dataset: 'BodyParts3D', release: '', doi: null, archive: null, conceptId: null, retrievedAt: null } })])).success, false);
});

/* ---------------- geometry budget ---------------- */

test('a mesh over the per-mesh triangle budget is an error', () => {
  const m = manifest([entry({ geometry: { triangles: 500_000, sourceTriangles: 900_000, reduction: 0.5, units: 'unitless' } })]);
  assert.match(errors(m).map((e) => e.message).join(' '), /over the per-mesh budget/);
});

test('the manifest total triangle budget is enforced across entries', () => {
  const many = ALL_STRUCTURES.slice(0, 12).map((s) => entry({
    asiId: s.id,
    meshName: `mesh_${s.id}`,
    layer: s.layer,
    region: s.id.startsWith('asi:shoulder.') ? 'shoulder' : s.id.startsWith('asi:neck.') ? 'neck' : s.id.startsWith('asi:lower-back.') ? 'lower_back' : 'knee',
    subRegionIds: ['shoulder.lateral'],
    geometry: { triangles: 80_000, sourceTriangles: 400_000, reduction: 0.2, units: 'unitless' },
  }));
  const m = manifest(many, { regions: ['shoulder', 'neck', 'lower_back', 'knee'] });
  const msgs = errors(m).map((e) => e.message).join(' ');
  // Individually under the per-mesh cap, collectively over the total.
  assert.match(msgs, /over the budget of/);
});

test('a tight budget reports the mesh that broke it', () => {
  const m = manifest([entry()]);
  const issues = validateManifest(m, { budget: { maxTotalTriangles: 10, maxTrianglesPerMesh: 10 } });
  assert.ok(issues.some((i) => i.severity === 'error' && /over the per-mesh budget/.test(i.message)));
});

test('a manifest file size budget is enforced when sizes are supplied', () => {
  const m = manifest([entry()]);
  const file = entry().file;
  assert.ok(file, 'the plain fixture entry must name a file');
  const good = validateManifest(m, { fileSizes: new Map([[file, 1024]]) });
  assert.deepEqual(good.filter((i) => i.severity === 'error'), []);
  const over = validateManifest(m, { budget: { ...DEFAULT_GEOMETRY_BUDGET, maxTotalBytes: 10 }, fileSizes: new Map([[file, 9999]]) });
  assert.ok(over.some((i) => i.severity === 'error' && /bytes, over the budget/.test(i.message)));
});

test('a manifest referencing a mesh file that is not there is an error', () => {
  const m = manifest([entry()]);
  const issues = validateManifest(m, { fileSizes: new Map() });
  assert.ok(issues.some((i) => i.severity === 'error' && /mesh file not found/.test(i.message)));
});

/* ---------------- an asset carries no clinical meaning ---------------- */

test('an entry cannot carry a selectedByUser claim', () => {
  // The derived selection flag belongs to the domain. If an asset could assert
  // it, a user's record would show a selection they never made.
  const smuggled = { ...entry(), selectedByUser: true } as unknown;
  assert.equal(AssetManifestSchema.safeParse(manifest([smuggled as AssetManifestEntry])).success, false);
});

test('an entry cannot carry a diagnosis or severity', () => {
  for (const field of ['diagnosis', 'severity', 'condition', 'finding']) {
    const smuggled = { ...entry(), [field]: 'rotator cuff tear' } as unknown;
    assert.equal(
      AssetManifestSchema.safeParse(manifest([smuggled as AssetManifestEntry])).success,
      false,
      `an asset must not be able to carry ${field}`,
    );
  }
});

/* ---------------- parseManifest reports every problem ---------------- */

test('parseManifest names every broken entry, not just the first', () => {
  const m = manifest([
    entry({ asiId: 'asi:shoulder.nope' }),
    entry({ asiId: 'asi:shoulder.infraspinatus', meshName: 'Infra_L', layer: 'tendon', subRegionIds: ['shoulder.lateral'] }),
  ]);
  assert.throws(() => parseManifest(m), (e: Error) => {
    const msg = e.message;
    assert.match(msg, /nope/);
    assert.match(msg, /layer disagrees/);
    return true;
  });
});
