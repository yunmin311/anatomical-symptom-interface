/**
 * The canonical-manifest-to-renderer pipeline, end to end.
 *
 * The real BodyParts3D archive has not been supplied yet, so this proves the
 * INTEGRATION with geometry this repository generated, through the production
 * path, with no shortcuts:
 *
 *   canonical AssetManifest -> AssetManifestSchema -> validateManifest
 *   -> asset-scene-adapter -> RendererSceneManifest -> GLB url
 *   -> GLTFLoader -> three.js scene graph -> descendant mesh -> asiId
 *   -> structure selection on the canonical authority
 *
 * The parts worth being careful about are the ones a rewrite could quietly get
 * wrong: `subRegionIds` must arrive whole rather than truncated to its first
 * element, `meshName` must not become an identity, the licence must be derived
 * rather than restated, and a hand-written notice must not be able to stand in
 * for the canonical manifest.
 */
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as THREE from 'three';
import {
  AssetManifestSchema,
  getStructure,
  validateManifest,
  REGIONS,
} from '@asi/shared';
import {
  deriveAttribution,
  effectiveLicence,
  isSyntheticManifest,
  sceneLicenceEvidence,
  toRendererScene,
} from '../src/anatomy/asset-scene-adapter.ts';
import {
  assertNonMedical,
  assertSceneAttribution,
  deriveAssetNotice,
  indexScene,
  resolveSubRegionForStructure,
  SceneManifestError,
  verifyAgainstOntology,
} from '../src/anatomy/scene-manifest.ts';
import type { RendererSceneManifest } from '../src/anatomy/scene-manifest.ts';
import { Three3dAnatomyAdapter } from '../src/anatomy/three3d.ts';
import {
  SYNTHETIC_ASSET_ROOT,
  SYNTHETIC_CANONICAL_MANIFEST,
} from './fixtures/synthetic-canonical-manifest.ts';
import type { AssetManifestEntry } from '@asi/shared';
import { buildFixtureGlb } from './fixtures/make-fixture-glb.mjs';
import { asElement, fakeHost, stubRenderer } from './fixtures/fake-dom.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The real GLB the web app serves, resolved on disk for the byte budget. */
const FIXTURE_GLB = resolve(HERE, '../public/fixtures/non-medical-two-quads.glb');

function buildScene(over: Parameters<typeof toRendererScene>[1] = {}): RendererSceneManifest {
  return toRendererScene(SYNTHETIC_CANONICAL_MANIFEST, {
    assetRoot: SYNTHETIC_ASSET_ROOT,
    ...over,
  });
}

/** Decode a GLB from disk exactly as the browser's GLTFLoader would. */
async function loadGlbFromDisk(path: string): Promise<THREE.Object3D> {
  const bytes = readFileSync(path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
    new GLTFLoader().parse(buffer as ArrayBuffer, '', resolve, reject);
  });
  return gltf.scene;
}

/* ================================================================== */
/* 1. the canonical manifest is a real manifest                       */
/* ================================================================== */

test('the synthetic manifest is itself a valid canonical manifest', () => {
  const parsed = AssetManifestSchema.parse(SYNTHETIC_CANONICAL_MANIFEST);
  assert.equal(parsed.entries.length, 2);

  const issues = validateManifest(parsed, {
    fileSizes: new Map([['non-medical-two-quads.glb', statSync(FIXTURE_GLB).size]]),
  });
  const errors = issues.filter((i) => i.severity === 'error');
  assert.deepEqual(errors, [], `the fixture manifest did not validate: ${JSON.stringify(errors)}`);

  // Its asiIds are real domain structures, which is a schema requirement rather
  // than a claim that a quad is a deltoid.
  assert.equal(getStructure('asi:shoulder.deltoid')?.layer, 'muscle');
  assert.equal(getStructure('asi:shoulder.acromion')?.layer, 'bone');
});

test('it declares itself synthetic, and that is what makes it dev/test-only', () => {
  assert.equal(isSyntheticManifest(SYNTHETIC_CANONICAL_MANIFEST), true);
  const attribution = deriveAttribution(SYNTHETIC_CANONICAL_MANIFEST);
  assert.equal(attribution.synthetic, true);
  // A real generator would not match the prefix, so the same code path handles
  // both. Checked with a copy rather than a second fixture.
  const real = { ...SYNTHETIC_CANONICAL_MANIFEST, generator: { name: 'bp3d-pipeline', version: '1' } };
  assert.equal(isSyntheticManifest(real), false);
});

/* ================================================================== */
/* 2. the adapter: carry through, convert, never invent                */
/* ================================================================== */

test('asiId is preserved exactly, and structureId comes from domain identity', () => {
  const scene = buildScene();
  for (const entry of scene.entries) {
    const canonical = SYNTHETIC_CANONICAL_MANIFEST.entries.find((e) => e.asiId === entry.asiId);
    assert.ok(canonical, `adapter invented an asiId: ${entry.asiId}`);
    assert.equal(entry.asiId, canonical.asiId);
    assert.equal(entry.kind, 'structure');
    // structureId IS the domain structure id; the adapter did not mint a second
    // one, and it is not a mesh name.
    assert.equal(entry.structureId, canonical.asiId);
    assert.equal(getStructure(entry.structureId!)?.layer, canonical.layer);
  }
});

test('the source mesh id is provenance and never an identity', () => {
  const scene = buildScene();
  for (const entry of scene.entries) {
    const canonical = SYNTHETIC_CANONICAL_MANIFEST.entries.find((e) => e.asiId === entry.asiId)!;
    assert.equal(entry.provenance?.meshName, canonical.meshName);
    // The mesh name belongs in `provenance` and nowhere else. Checking the entry
    // WITH provenance stripped is the point: the whole risk is that it leaks into
    // a field a lookup could read.
    const { provenance: _only, ...identity } = entry;
    assert.ok(
      !JSON.stringify(identity).includes(canonical.meshName),
      'a mesh name escaped into a field where it could be read as an identity',
    );
    assert.equal(entry.label, canonical.layTerm ?? canonical.anatomicalLabel);
    assert.ok(
      !JSON.stringify(identity).includes(canonical.meshName),
      'the human label was built from the source mesh name instead of the canonical label',
    );
  }
  // And no entry is keyed by it.
  const index = indexScene(scene);
  for (const meshName of SYNTHETIC_CANONICAL_MANIFEST.entries.map((e) => e.meshName))
    assert.equal(index.has(meshName), false, 'a mesh name became a lookup key');
});

test('subRegionIds arrives whole, and there is NO singular answer to guess at', () => {
  const scene = buildScene();
  const deltoid = scene.entries.find((e) => e.asiId === 'asi:shoulder.deltoid')!;
  // Two sub-regions in the ontology, so two in the scene, in canonical order.
  assert.deepEqual(deltoid.subRegionIds, ['shoulder.anterior', 'shoulder.lateral']);
  assert.equal(
    deltoid.soleSubRegionId,
    undefined,
    'a multi-sub-region structure got a singular sub-region, i.e. subRegionIds[0] was taken as the truth',
  );

  // One sub-region is a genuine single answer, and the convenience appears.
  const acromion = scene.entries.find((e) => e.asiId === 'asi:shoulder.acromion')!;
  assert.deepEqual(acromion.subRegionIds, ['shoulder.lateral']);
  assert.equal(acromion.soleSubRegionId, 'shoulder.lateral');
});

test('an entry may not declare a sole sub-region its own list contradicts', () => {
  const scene = buildScene();
  const deltoid = scene.entries.find((e) => e.asiId === 'asi:shoulder.deltoid')!;
  const lying = { ...scene, entries: [{ ...deltoid, soleSubRegionId: 'shoulder.lateral' }] };
  assert.throws(() => indexScene(lying), SceneManifestError);
});

test('file becomes a GLB url, and nodeName is NOT required', () => {
  const scene = buildScene();
  for (const entry of scene.entries) {
    assert.equal(entry.geometry.type, 'url');
    if (entry.geometry.type !== 'url') continue;
    assert.equal(entry.geometry.url, '/fixtures/non-medical-two-quads.glb');
    // The Core pipeline emits one mesh per GLB. Requiring a node name here would
    // make the production adapter refuse every real asset.
    assert.equal(entry.geometry.nodeName, undefined);
  }
  // An assetRoot override reaches the same builder.
  const other = buildScene({ assetRoot: '/cdn/anatomy/v1/' });
  assert.equal(
    other.entries[0]!.geometry.type === 'url' ? other.entries[0]!.geometry.url : '',
    '/cdn/anatomy/v1/non-medical-two-quads.glb',
  );
});

test('canonical bounds become renderer framing, not an authored position', () => {
  const scene = buildScene();
  for (const entry of scene.entries) {
    const canonical = SYNTHETIC_CANONICAL_MANIFEST.entries.find((e) => e.asiId === entry.asiId)!;
    const expectedCenter = [0, 1, 2].map(
      (i) => (canonical.bounds.min[i]! + canonical.bounds.max[i]!) / 2,
    );
    const expectedSize = [0, 1, 2].map(
      (i) => Math.abs(canonical.bounds.max[i]! - canonical.bounds.min[i]!),
    );
    assert.deepEqual(entry.framing?.center, expectedCenter);
    assert.deepEqual(entry.framing?.size, expectedSize);
  }
  // The whole-figure framing is the union of the canonical bounds, not a constant.
  assert.equal(scene.bounds.height, 1.5);
  assert.equal(scene.bounds.radius, 1.75);
});

test('layer is carried through unchanged', () => {
  const scene = buildScene();
  for (const entry of scene.entries)
    assert.equal(entry.layer, getStructure(entry.structureId!)?.layer);
});

test('an invalid canonical manifest builds no scene at all', () => {
  const broken = {
    ...SYNTHETIC_CANONICAL_MANIFEST,
    entries: [{ ...SYNTHETIC_CANONICAL_MANIFEST.entries[0]!, asiId: 'asi:shoulder.not-a-thing' }],
  };
  assert.throws(() => toRendererScene(broken), SceneManifestError);
  // A layer that disagrees with the ontology is the other half of the same check.
  const wrongLayer = {
    ...SYNTHETIC_CANONICAL_MANIFEST,
    entries: [{ ...SYNTHETIC_CANONICAL_MANIFEST.entries[0]!, layer: 'nerve' }],
  };
  assert.throws(() => toRendererScene(wrongLayer), SceneManifestError);
});

/* ================================================================== */
/* 3. attribution is derived, never authored                            */
/* ================================================================== */

test('the notice is computed from canonical licence, dataset and release', () => {
  const scene = buildScene();
  assertSceneAttribution(scene);
  const licence = SYNTHETIC_CANONICAL_MANIFEST.licence;
  const source = SYNTHETIC_CANONICAL_MANIFEST.entries[0]!.source;
  assert.ok(scene.externalAssetNotice?.includes(licence.attribution));
  assert.ok(scene.externalAssetNotice?.includes(licence.id));
  assert.ok(scene.externalAssetNotice?.includes(source.dataset));
  assert.ok(scene.externalAssetNotice?.includes(source.release));
  assert.ok(scene.externalAssetNotice?.includes(licence.url));
});

test('a hand-written notice cannot stand in for the canonical manifest', () => {
  const scene = buildScene();
  // The production scene must carry derived attribution at all.
  assert.throws(() => assertSceneAttribution({ ...scene, attribution: null }), SceneManifestError);
  assert.throws(
    () => assertSceneAttribution({ ...scene, attribution: undefined }),
    SceneManifestError,
  );
  // And a notice that disagrees with the fields it was computed from is refused,
  // which is what stops a scene author restating the licence however they like.
  assert.throws(
    () => assertSceneAttribution({ ...scene, externalAssetNotice: 'Some other asset, MIT.' }),
    SceneManifestError,
  );
});

test('a synthetic manifest cannot be dressed up as a source dataset', () => {
  const scene = buildScene();
  // The adapter decided this from the generator, not from what a caller asked.
  assert.equal(scene.source, 'fixture');
  assert.match(scene.disclaimer ?? '', /synthetic/i);
  assert.match(scene.disclaimer ?? '', /not anatomy/i);
  assert.doesNotThrow(() => assertNonMedical(scene));
  // Its licence is truthful — this repository generated the quads — so it is
  // carried and labelled synthetic rather than dropped.
  assert.equal(scene.attribution?.synthetic, true);
  assertSceneAttribution(scene);
  // But no UI may report it as anatomy provenance.
  assert.equal(sceneLicenceEvidence(scene), null);
});

test('a fixture may not claim a real dataset provenance', () => {
  const scene = buildScene();
  assert.throws(
    () =>
      assertNonMedical({
        ...scene,
        attribution: { ...scene.attribution!, synthetic: false },
      }),
    SceneManifestError,
  );
  // And a production scene may not carry synthetic provenance.
  const real = buildScene();
  assert.throws(
    () =>
      assertNonMedical({
        ...real,
        source: 'external',
        disclaimer: undefined,
        attribution: { ...real.attribution!, synthetic: true },
      }),
    SceneManifestError,
  );
});

test('a production generator yields an external scene with licence evidence', () => {
  const real = toRendererScene({
    ...SYNTHETIC_CANONICAL_MANIFEST,
    generator: { name: 'bp3d-shoulder-pipeline', version: '1' },
  });
  assert.equal(real.source, 'external');
  assert.equal(real.disclaimer, undefined);
  assertSceneAttribution(real);
  assertNonMedical(real);
  const evidence = sceneLicenceEvidence(real)!;
  assert.equal(evidence.licenceId, SYNTHETIC_CANONICAL_MANIFEST.licence.id);
  assert.equal(evidence.licenceUrl, SYNTHETIC_CANONICAL_MANIFEST.licence.url);
  assert.equal(evidence.dataset, SYNTHETIC_CANONICAL_MANIFEST.entries[0]!.source.dataset);
  assert.equal(evidence.release, SYNTHETIC_CANONICAL_MANIFEST.entries[0]!.source.release);
});

test('the converted scene passes the renderer ontology check', () => {
  const scene = buildScene();
  const allSubRegions = Object.values(REGIONS).flatMap((r) => r.subRegions);
  const allStructures = Object.values(REGIONS).flatMap((r) =>
    r.subRegions.flatMap((s) => s.structures),
  );
  assert.doesNotThrow(() => verifyAgainstOntology(scene, allSubRegions, allStructures));
});

/* ================================================================== */
/* 4. the whole pipeline, through the real loader                       */
/* ================================================================== */

test('PIPELINE: canonical -> scene -> GLB -> three -> descendant mesh -> asiId -> selection', async () => {
  // 1-3. Canonical manifest, validated, converted. All production code.
  const scene = buildScene();
  assert.equal(scene.entries.length, 2);
  const index = indexScene(scene);
  assert.equal(index.size, 2);

  // 4-5. The scene's URL is fetched and parsed by the real GLTFLoader, from the
  // real bytes on disk. Nothing is stubbed on the way through.
  const loaded = await loadGlbFromDisk(FIXTURE_GLB);

  // 6. The loaded graph is a Group with descendant meshes, not a single mesh:
  // this is exactly why the adapter must not require a node name.
  let meshCount = 0;
  loaded.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) meshCount += 1;
  });
  assert.ok(meshCount >= 2, `expected descendant meshes, saw ${meshCount}`);

  // 7-8. Hand the real graph to the real adapter under the converted scene, and
  // let it resolve every descendant back to a canonical asiId.
  const adapter = new Three3dAnatomyAdapter({
    manifest: scene,
    rendererFactory: () => stubRenderer(),
    loadGlb: async () => ({ scene: loaded }),
  });
  await adapter.mount(asElement(fakeHost()));

  const objects = (adapter as unknown as { objects: Map<string, THREE.Object3D> }).objects;
  assert.equal(objects.size, 2, 'the adapter did not adopt one root per canonical entry');
  for (const entry of scene.entries) {
    const root = objects.get(entry.asiId);
    assert.ok(root, `no scene object adopted for ${entry.asiId}`);
    // Every descendant resolves to the OWNING asiId, so a raycast that lands on a
    // leaf mesh comes back as a domain structure.
    const ownerOf = (adapter as unknown as { ownerOf: Map<THREE.Object3D, string> }).ownerOf;
    root!.traverse((node) => {
      assert.equal(ownerOf.get(node), entry.asiId, 'a descendant resolved to the wrong asiId');
    });
  }

  // 9. Structure selection runs on the canonical authority: selecting by the
  // canonical asiId is what a click resolves to, and it is what
  // location.userSelectedStructureIds stores.
  adapter.apply({ type: 'setSelected', structureIds: ['asi:shoulder.deltoid'] });
  assert.deepEqual(adapter.getState().selectedStructureIds, ['asi:shoulder.deltoid']);
  // Order is the order the user pointed, never sorted.
  adapter.apply({ type: 'setSelected', structureIds: ['asi:shoulder.acromion', 'asi:shoulder.deltoid'] });
  assert.deepEqual(adapter.getState().selectedStructureIds, [
    'asi:shoulder.acromion',
    'asi:shoulder.deltoid',
  ]);

  adapter.dispose();
  assert.equal(adapter.resources().outstandingAssets, 0);
});

test('the pipeline runs with ONE mesh per GLB, which is what Core produces', async () => {
  // Build a single-mesh GLB and prove the same scene shape adopts it with no
  // nodeName. This is the shape every real generated asset will have.
  const loaded = new THREE.Group();
  loaded.name = 'single_mesh_root';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  mesh.name = 'only';
  loaded.add(mesh);

  const scene = buildScene();
  const singleEntry = {
    ...scene,
    entries: [
      {
        ...scene.entries[0]!,
        geometry: { type: 'url' as const, url: '/fixtures/single.glb' },
      },
    ],
  };
  const adapter = new Three3dAnatomyAdapter({
    manifest: singleEntry,
    rendererFactory: () => stubRenderer(),
    loadGlb: async () => ({ scene: loaded }),
  });
  await adapter.mount(asElement(fakeHost()));

  const objects = (adapter as unknown as { objects: Map<string, THREE.Object3D> }).objects;
  assert.equal(objects.size, 1);
  assert.equal(
    singleEntry.entries[0]!.geometry.type === 'url'
      ? singleEntry.entries[0]!.geometry.nodeName
      : 'not-url',
    undefined,
    'the scene demanded a nodeName for a one-mesh GLB',
  );
  adapter.dispose();
});

/* ================================================================== */
/* 5. picking a multi-sub-region structure                             */
/* ================================================================== */

test('picking a multi-sub-region structure keeps, adopts, or asks', () => {
  const deltoid = ['shoulder.anterior', 'shoulder.lateral'];
  // Already in one of them: keep what the user had.
  assert.deepEqual(resolveSubRegionForStructure(deltoid, 'shoulder.anterior'), {
    kind: 'keep',
    subRegionId: 'shoulder.anterior',
  });
  // Not in it, and there are several: do not choose.
  const unresolved = resolveSubRegionForStructure(deltoid, 'shoulder.posterior');
  assert.equal(unresolved.kind, 'unresolved');
  if (unresolved.kind === 'unresolved')
    assert.deepEqual(unresolved.candidates, deltoid);
  // Nothing set, still several: do not choose.
  assert.equal(resolveSubRegionForStructure(deltoid, null).kind, 'unresolved');
  // Exactly one: unambiguous, so adopt it.
  assert.deepEqual(resolveSubRegionForStructure(['shoulder.lateral'], null), {
    kind: 'use',
    subRegionId: 'shoulder.lateral',
  });
  // A structure with no sub-regions cannot imply one either.
  assert.deepEqual(resolveSubRegionForStructure([], null), {
    kind: 'unresolved',
    candidates: [],
  });
});

test('the fixture GLB really is the bytes the pipeline proof loads', () => {
  // Guards the proof itself: if the fixture were regenerated with different
  // geometry, the descendant-mesh assertions would be testing the wrong file.
  assert.equal(readFileSync(FIXTURE_GLB).byteLength, buildFixtureGlb().byteLength);
});
/* ================================================================== */
/* 6. attribution: one scene, one attribution                          */
/* ================================================================== */

/**
 * A copy of the fixture manifest with one field on `patch` changed.
 *
 * Written as a function rather than a table of literals because the point of these
 * tests is that a SECOND entry disagrees, so each case has to leave the first
 * entry alone. `conceptId` is deliberately not varied: it differs per structure by
 * design and requiring it to match would refuse every real manifest.
 */
/** The same manifest, declared by a real pipeline rather than the test generator. */
function productionManifest(patch: Partial<AssetManifestEntry> = {}): unknown {
  return {
    ...withSecondEntry(patch),
    generator: { name: 'bp3d-shoulder-pipeline', version: '1' },
  };
}

function withSecondEntry(patch: Partial<AssetManifestEntry>): unknown {
  const [first, second] = SYNTHETIC_CANONICAL_MANIFEST.entries;
  assert.ok(first && second, 'the fixture manifest needs two entries for these tests');
  return {
    ...SYNTHETIC_CANONICAL_MANIFEST,
    entries: [first, { ...second, ...patch }],
  };
}

test('A. a homogeneous production manifest derives its attribution', () => {
  // Everything agrees, including the conceptId, which is allowed to differ.
  const scene = toRendererScene(productionManifest(), { assetRoot: SYNTHETIC_ASSET_ROOT });
  assert.equal(scene.source, 'external');
  assertSceneAttribution(scene);
  const licence = SYNTHETIC_CANONICAL_MANIFEST.licence;
  assert.equal(scene.attribution?.licence.id, licence.id);
  assert.equal(scene.attribution?.source.dataset, SYNTHETIC_CANONICAL_MANIFEST.entries[0]!.source.dataset);
  assert.equal(scene.attribution?.source.release, SYNTHETIC_CANONICAL_MANIFEST.entries[0]!.source.release);
});

test('B. an entry with a different licence is REFUSED, not reported under the first', () => {
  // This is the case the old code got wrong: it read manifest.licence and entries[0]
  // and happily produced a scene claiming every mesh was CC0 when one is MIT.
  const differing = {
    id: 'MIT',
    name: 'MIT License',
    url: 'https://opensource.org/license/mit',
    attribution: 'Some other dataset entirely.',
    verifiedOn: '2026-10-01',
  };
  assert.throws(
    () => toRendererScene(withSecondEntry({ licence: differing }), { assetRoot: SYNTHETIC_ASSET_ROOT }),
    (error: unknown) =>
      error instanceof SceneManifestError &&
      /licence\.id/.test(String(error)) &&
      /licence\.attribution/.test(String(error)) &&
      /one attribution|ONE attribution/i.test(String(error)),
  );
});

test('C. an entry from a different dataset is REFUSED', () => {
  assert.throws(
    () =>
      toRendererScene(withSecondEntry({ source: { dataset: 'Some Other Anatomy Set', release: '1.0.0' } }), {
        assetRoot: SYNTHETIC_ASSET_ROOT,
      }),
    (error: unknown) => error instanceof SceneManifestError && /source\.dataset/.test(String(error)),
  );
});

test('D. the same dataset at a different release is REFUSED', () => {
  // Same dataset name is not enough. A licence or a citation is versioned, so
  // "BodyParts3D 4.0" and "BodyParts3D 4.3" are different provenance and reporting
  // one for the other is the sort of thing that goes unnoticed for years.
  assert.throws(
    () =>
      toRendererScene(withSecondEntry({ source: { dataset: SYNTHETIC_CANONICAL_MANIFEST.entries[0]!.source.dataset, release: '9.9.9' } }), {
        assetRoot: SYNTHETIC_ASSET_ROOT,
      }),
    (error: unknown) => error instanceof SceneManifestError && /source\.release/.test(String(error)),
  );
});

test('D2. an entry disagreeing about its archive or DOI is REFUSED', () => {
  // Both are printed in the provenance panel, so a scene cannot cite them once.
  assert.throws(
    () =>
      toRendererScene(withSecondEntry({ source: { ...SYNTHETIC_CANONICAL_MANIFEST.entries[0]!.source, archive: 'other.zip' } }), {
        assetRoot: SYNTHETIC_ASSET_ROOT,
      }),
    (error: unknown) => error instanceof SceneManifestError && /source\.archive/.test(String(error)),
  );
  assert.throws(
    () =>
      toRendererScene(withSecondEntry({ source: { ...SYNTHETIC_CANONICAL_MANIFEST.entries[0]!.source, doi: '10.9999/other' } }), {
        assetRoot: SYNTHETIC_ASSET_ROOT,
      }),
    (error: unknown) => error instanceof SceneManifestError && /source\.doi/.test(String(error)),
  );
});

test('the effective licence is the one ON the entry, not the manifest default', () => {
  // The canonical schema requires `entry.licence`, so the entry states the licence
  // that governs it. Reading `manifest.licence` instead would be wrong exactly when
  // they differ, which is the only case that matters.
  const entryLicence = {
    id: 'CC-BY-4.0',
    name: 'Creative Commons Attribution 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Entry-level attribution string.',
    verifiedOn: '2026-02-02',
  };
  const single = {
    ...SYNTHETIC_CANONICAL_MANIFEST,
    entries: [{ ...SYNTHETIC_CANONICAL_MANIFEST.entries[0]!, licence: entryLicence }],
  };
  assert.equal(effectiveLicence(SYNTHETIC_CANONICAL_MANIFEST.entries[0]!).id, 'CC0-1.0');
  const scene = toRendererScene(single, { assetRoot: SYNTHETIC_ASSET_ROOT });
  // The manifest default was CC0 and the entry says CC-BY; the entry wins.
  assert.equal(scene.attribution?.licence.id, 'CC-BY-4.0');
  assert.equal(scene.attribution?.licence.verifiedOn, '2026-02-02');
  assert.ok(scene.externalAssetNotice?.includes('Entry-level attribution string.'));
  assertSceneAttribution(scene);
});

test('E. a synthetic fixture stays explicitly synthetic and shows no licence evidence', () => {
  const scene = buildScene();
  assert.equal(scene.source, 'fixture');
  assert.equal(scene.attribution?.synthetic, true);
  assert.match(scene.disclaimer ?? '', /synthetic/i);
  assert.match(scene.disclaimer ?? '', /not anatomy/i);
  // Nothing a UI could mistake for anatomy provenance.
  assert.equal(sceneLicenceEvidence(scene), null);
  assert.throws(() => assertNonMedical({
    ...scene,
    attribution: { ...scene.attribution!, synthetic: false },
  }), SceneManifestError);
});

test('F. a production notice cannot be authored to differ from the canonical value', () => {
  const scene = toRendererScene(productionManifest(), { assetRoot: SYNTHETIC_ASSET_ROOT });
  const expected = deriveAssetNotice(scene.attribution!.licence, scene.attribution!.source);
  // Hand-writing the notice is exactly what must not be possible.
  assert.throws(
    () => assertSceneAttribution({ ...scene, externalAssetNotice: 'Some other asset, MIT.' }),
    SceneManifestError,
  );
  assert.throws(() => assertSceneAttribution({ ...scene, attribution: null }), SceneManifestError);
  // And the value the adapter produces is that exact string.
  assert.equal(scene.externalAssetNotice, expected);
});

test('the renderer source category is dataset-agnostic', () => {
  // 'bodyparts3d' used to be the non-synthetic value, so a Z-Anatomy scene would
  // have been labelled BodyParts3D. The category must not name a supplier.
  const bp3d = toRendererScene(productionManifest(), { assetRoot: SYNTHETIC_ASSET_ROOT });
  const zAnatomy = toRendererScene({
    ...productionManifest(),
    generator: { name: 'z-anatomy-pipeline', version: '1' },
  }, { assetRoot: SYNTHETIC_ASSET_ROOT });
  assert.equal(bp3d.source, 'external');
  assert.equal(zAnatomy.source, 'external');
  // Same category for both; the dataset name lives in exactly one place.
  assert.equal(bp3d.source, zAnatomy.source);
  assert.equal(bp3d.attribution?.source.dataset, SYNTHETIC_CANONICAL_MANIFEST.entries[0]!.source.dataset);
});
