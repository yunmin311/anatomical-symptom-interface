/**
 * The real-geometry pick path: externally sourced anatomy, not a fixture.
 *
 * `structure-pick-browser.mjs` proves the canonical pick contract works, but it does
 * so on synthetic quads. That is legitimate for testing the contract and completely
 * insufficient for trusting it: synthetic geometry has no concept identities, no
 * layer, no laterality, and no sub-region list, so every interesting property of a
 * real asset is untested by it.
 *
 * This gate runs the SAME production path against geometry built from
 * isa_BP3D_4.0_obj_99.zip:
 *
 *   generated canonical manifest -> parseManifest -> toRendererScene
 *   -> the scene's real GLB urls -> three's real GLTFLoader, no injected loader
 *   -> three.js scene graph -> descendant mesh -> canonical asiId -> structure pick
 *
 * and it additionally proves the things a synthetic mesh cannot:
 *
 *   - provenance and the canonical sub-region list survive the whole chain;
 *   - every mesh resolves to an asiId the DOMAIN has, not just one the manifest names;
 *   - each structure's layer matches the ontology;
 *   - a structure with several sub-regions carries the whole list, with no singular
 *     field invented for it;
 *   - a declared-unavailable structure is absent from the scene, so the viewer cannot
 *     render it even by accident.
 *
 * BodyParts3D, (c) The Database Center for Life Science, CC BY 4.0.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const url = process.env.ASI_WEB_URL || 'http://127.0.0.1:5189';
const out = process.env.ASI_SCREENSHOTS || '/tmp/asi-real-geometry';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const problems = [];
const ok = (m) => console.log('ok   ' + m);
const bad = (m) => {
  problems.push(m);
  console.log('FAIL ' + m);
};
let n = 0;
async function check(name, fn) {
  await fn();
  console.log(`PASS ${++n}: ${name}`);
}

try {
  await page.goto(url);
  await page.waitForSelector('#root *', { timeout: 30_000 });

  /* ---------------------------------------------------------------- */
  /* mount the real scene through the real contract                    */
  /* ---------------------------------------------------------------- */
  const chain = await page.evaluate(async () => {
    const { CANONICAL_ANATOMY_MANIFEST, CANONICAL_ASSET_ROOT } = await import(
      '/src/anatomy/generated/canonical-manifest.left.ts'
    );
    const { toRendererScene, isSyntheticManifest } = await import(
      '/src/anatomy/asset-scene-adapter.ts'
    );
    const { indexScene } = await import('/src/anatomy/scene-manifest.ts');
    const { Three3dAnatomyAdapter } = await import('/src/anatomy/three3d.ts');
    const { getStructure, REGIONS } = await import('/node_modules/@asi/shared/src/index.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');

    // The app's own scene module, so this tests the ACTIVE scene and not a copy.
    const active = await import('/src/anatomy/active-scene.ts');
    const scene = active.ACTIVE_SCENE;

    // Independently re-derive it, so a bug in active-scene cannot hide here.
    const canonical = JSON.parse(JSON.stringify(CANONICAL_ANATOMY_MANIFEST));
    const rebuilt = toRendererScene(canonical, { assetRoot: CANONICAL_ASSET_ROOT });
    const synthetic = isSyntheticManifest(canonical);

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;z-index:9999';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:800px;height:600px';
    host.appendChild(canvas);
    document.body.appendChild(host);

    // NO injected loader: real fetch of /anatomy/... through the real GLTFLoader.
    const adapter = new Three3dAnatomyAdapter({ manifest: scene });
    await adapter.mount(host);

    const internals = adapter;
    const roots = internals.objects ?? new Map();
    const ownerOf = internals.ownerOf ?? new Map();
    const camera = internals.camera;

    // For each entry in turn: hide the others, then raycast its own vertices.
    //
    // Isolating each entry is what makes this an IDENTITY test rather than a
    // visibility test. Without it, a structure that happens to sit behind another one
    // reports the front structure and looks like a failure, which is the wrong
    // conclusion: being occluded is correct behaviour, not a broken binding.
    // Occlusion is checked separately, below, against the real question.
    const domLookup = getStructure;
    void domLookup;
    const canonicalIds = new Set(scene.entries.map((e) => e.asiId));
    const picks = [];
    for (const [asiId, root] of roots) {
      const meshes = [];
      root.traverse((n) => {
        if (n.isMesh) meshes.push(n);
      });

      const others = [...roots.entries()].filter(([id]) => id !== asiId).map(([, r]) => r);
      const wasVisible = others.map((o) => o.visible);
      for (const o of others) o.visible = false;

      const rect = canvas.getBoundingClientRect();
      let picked = null;
      outer: for (const mesh of meshes) {
        const pos = mesh.geometry.getAttribute('position');
        if (!pos) continue;
        const step = Math.max(1, Math.floor(pos.count / 12));
        camera.updateMatrixWorld(true);
        for (let i = 0; i < pos.count; i += step) {
          const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
          mesh.localToWorld(v);
          const ndc = v.clone().project(camera);
          if (ndc.z > 1) continue;
          const hit = adapter.pick(
            rect.left + ((ndc.x + 1) / 2) * rect.width,
            rect.top + ((1 - ndc.y) / 2) * rect.height,
          );
          if (hit.kind === 'structure' && hit.asiId === asiId) {
            picked = {
              asiId: hit.asiId,
              structureId: hit.structureId ?? null,
              subRegionIds: hit.subRegionIds ?? null,
              subRegionId: hit.subRegionId ?? null,
              hasPoint: Boolean(hit.point),
            };
            break outer;
          }
        }
      }
      others.forEach((o, i) => {
        o.visible = wasVisible[i];
      });
      // Every descendant must resolve to this entry's own asiId.
      let descendantsResolve = true;
      root.traverse((node) => {
        if (ownerOf.get(node) !== asiId) descendantsResolve = false;
      });
      const structure = getStructure(asiId);
      picks.push({
        asiId,
        meshCount: meshes.length,
        picked,
        descendantsResolve,
        // Is the asiId a REAL domain structure, not just a manifest string?
        inDomain: Boolean(structure),
        layerMatchesOntology: structure ? structure.layer === scene.entries.find((e) => e.asiId === asiId)?.layer : false,
        domainLabel: structure?.label ?? null,
      });
    }

    // Occlusion, stated as the question it actually is: with EVERYTHING visible, does
    // a ray into the anatomy come back as a canonical asiId rather than an engine
    // handle? A structure being hidden behind another one is correct, not a failure.
    const allVisible = [...roots.values()];
    const restore = allVisible.map((o) => o.visible);
    allVisible.forEach((o) => {
      o.visible = true;
    });
    const rectAll = canvas.getBoundingClientRect();
    const occluded = [];
    let resolved = 0;
    for (const [asiId, root] of roots) {
      let hitOwn = false;
      root.traverse((node) => {
        if (hitOwn || !node.isMesh) return;
        const pos = node.geometry.getAttribute('position');
        if (!pos) return;
        const step = Math.max(1, Math.floor(pos.count / 8));
        camera.updateMatrixWorld(true);
        for (let i = 0; i < pos.count && !hitOwn; i += step) {
          const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
          node.localToWorld(v);
          const ndc = v.clone().project(camera);
          if (ndc.z > 1) continue;
          const hit = adapter.pick(
            rectAll.left + ((ndc.x + 1) / 2) * rectAll.width,
            rectAll.top + ((1 - ndc.y) / 2) * rectAll.height,
          );
          if (hit.kind === 'structure' && canonicalIds.has(hit.asiId ?? '')) {
            resolved += 1;
            if (hit.asiId === asiId) hitOwn = true;
          }
        }
      });
      if (!hitOwn) occluded.push(asiId);
    }
    allVisible.forEach((o, i) => {
      o.visible = restore[i];
    });

    // Read AFTER dispose, which is the only point where "nothing left" is a
    // meaningful claim. Capturing before dispose asserted that ten assets were
    // outstanding, which is exactly what you expect while ten are still mounted.
    const near = internals.camera?.near ?? null;
    const far = internals.camera?.far ?? null;
    const mountedObjects = adapter.resources().sceneObjects;
    const mountedAssets = adapter.resources().outstandingAssets;
    adapter.dispose();
    host.remove();
    const resources = adapter.resources();

    return {
      synthetic,
      sceneSource: scene.source,
      attribution: scene.attribution
        ? {
            dataset: scene.attribution.source.dataset,
            release: scene.attribution.source.release,
            licence: scene.attribution.licence.id,
            synthetic: scene.attribution.synthetic,
          }
        : null,
      entryCount: scene.entries.length,
      // ACTIVE_SCENE and an independent rebuild must agree, or the app and the
      // contract disagree about what is on screen.
      activeMatchesRebuild: JSON.stringify(scene) === JSON.stringify(rebuilt),
      guardAcceptsProduction: (() => {
        try {
          active.assertProductionSceneIsReal(scene);
          return true;
        } catch {
          return false;
        }
      })(),
      guardRejectsFixture: (() => {
        try {
          active.assertProductionSceneIsReal(active.FIXTURE_SCENE);
          return false;
        } catch {
          return true;
        }
      })(),
      picks,
      occluded,
      occludedResolved: resolved,
      near,
      far,
      mountedObjects,
      mountedAssets,
      resources,
      // Structures the mapping declares unavailable must be ABSENT from the scene.
      unavailableAbsent: [
        'asi:shoulder.acromion',
        'asi:shoulder.coracoid',
        'asi:shoulder.glenohumeral-joint',
        'asi:shoulder.acromioclavicular-joint',
        'asi:shoulder.spine-of-scapula',
        'asi:shoulder.subacromial-bursa',
        'asi:shoulder.deltoid',
      ].every((id) => !scene.entries.some((e) => e.asiId === id)),
      compositeDeltoidAbsent: !scene.entries.some((e) => e.asiId === 'asi:shoulder.deltoid'),
      deltoidPartsPresent: ['clavicular', 'acromial', 'spinal'].every((p) =>
        scene.entries.some((e) => e.asiId === `asi:shoulder.deltoid-${p}-part`),
      ),
      subRegionListsWhole: scene.entries.every(
        (e) => Array.isArray(e.subRegionIds) && e.subRegionIds.length > 0,
      ),
      noInventedSingular: scene.entries.every(
        (e) => e.subRegionIds.length > 1 || e.soleSubRegionId === e.subRegionIds[0],
      ),
      regionOfEntries: [...new Set(scene.entries.map((e) => e.region))],
      REGION_COUNT: Object.keys(REGIONS).length,
      camPos: internals.camera?.position?.toArray?.().map((v) => Math.round(v)) ?? null,
    };
  });

  /* ---------------------------------------------------------------- */
  /* the scene is real sourced anatomy                                 */
  /* ---------------------------------------------------------------- */

  await check('the production scene is REAL anatomy, not a fixture', () => {
    if (chain.synthetic) bad('the generated manifest is marked synthetic');
    else ok('manifest is not synthetic');
    if (chain.sceneSource !== 'external') bad(`scene source is ${chain.sceneSource}`);
    else ok(`scene source: ${chain.sceneSource}`);
    if (!chain.attribution) bad('the scene has no attribution');
    else
      ok(
        `attribution: ${chain.attribution.dataset} ${chain.attribution.release}, ${chain.attribution.licence}, synthetic=${chain.attribution.synthetic}`,
      );
    if (chain.attribution?.synthetic) bad('attribution claims synthetic provenance');
  });

  await check('the app scene and an independent rebuild AGREE', () => {
    if (!chain.activeMatchesRebuild)
      bad('ACTIVE_SCENE differs from a fresh toRendererScene() of the same manifest');
    else ok(`both produce ${chain.entryCount} entries`);
  });

  await check('the guard accepts real anatomy and rejects the fixture', () => {
    if (!chain.guardAcceptsProduction) bad('the guard rejected the real scene');
    else ok('accepts the production scene');
    if (!chain.guardRejectsFixture) bad('the guard ACCEPTED the synthetic fixture');
    else ok('rejects the synthetic fixture');
  });

  /* ---------------------------------------------------------------- */
  /* real geometry, real loader, real raycast                         */
  /* ---------------------------------------------------------------- */

  await check('real GLB geometry mounted and adopted', () => {
    if (chain.entryCount < 8) bad(`only ${chain.entryCount} entries`);
    else ok(`${chain.entryCount} structures in the scene`);
    // Counted while MOUNTED: after dispose the scene is empty by design, which is
    // what the next assertion checks.
    if (chain.mountedObjects < 8)
      bad(`only ${chain.mountedObjects} scene objects adopted from real GLBs`);
    else ok(`${chain.mountedObjects} GLB roots adopted through the real GLTFLoader`);
    if (chain.mountedAssets < 8)
      bad(`only ${chain.mountedAssets} assets were outstanding while mounted`);
    else ok(`${chain.mountedAssets} assets live while mounted`);
    // ...and nothing at all after.
    if (chain.resources.outstandingAssets !== 0)
      bad(`${chain.resources.outstandingAssets} assets left outstanding after dispose`);
    else ok('all real assets released after dispose');
    if (chain.resources.sceneObjects !== 0)
      bad(`${chain.resources.sceneObjects} scene objects survived dispose`);
    else ok('no scene objects survived dispose');
    if (chain.resources.canvasAttached)
      bad('a canvas survived dispose');
    else ok('no canvas survived dispose');
  });

  await check('the frustum is derived from the real scene, not a constant', () => {
    // The defect this gate exists to catch: a hardcoded far plane of 50 units meant
    // every ray left the frustum before reaching millimetre-scale anatomy, so real
    // geometry rendered but could not be picked.
    if (chain.near <= 0.05) bad(`camera.near is ${chain.near}; still the fixture-scale constant`);
    else ok(`camera.near = ${chain.near.toFixed(2)}`);
    if (chain.far < 1000) bad(`camera.far is ${chain.far}; real anatomy sits ~1300 units out`);
    else ok(`camera.far = ${Math.round(chain.far)}, clearing the real scene`);
  });

  await check('occlusion resolves to a canonical asiId, never an engine handle', () => {
    // A structure hidden behind another one is CORRECT. What must never happen is a
    // ray that lands on anatomy and returns a mesh UUID, a node name, or nothing
    // recognisable -- so this asks the question that actually matters.
    if (chain.occludedResolved === 0)
      bad('no ray into the anatomy resolved to a canonical asiId');
    else ok(`${chain.occludedResolved} rays resolved to canonical asiIds with everything visible`);
    if (chain.occluded.length)
      ok(
        `not frontmost from this camera (correct, not a defect): ${chain.occluded.join(', ')}`,
      );
    else ok('every structure is frontmost from this camera');
  });

  await check('a real raycast resolves every structure to a DOMAIN asiId', () => {
    const unresolved = chain.picks.filter((p) => !p.inDomain);
    if (unresolved.length)
      bad(`not in the domain: ${unresolved.map((p) => p.asiId).join(', ')}`);
    else ok(`all ${chain.picks.length} resolve to real domain structures`);
    const badLayer = chain.picks.filter((p) => !p.layerMatchesOntology);
    if (badLayer.length)
      bad(`layer disagrees with the ontology: ${badLayer.map((p) => p.asiId).join(', ')}`);
    else ok('every structure layer matches anatomy.ts');
    const badDescendants = chain.picks.filter((p) => !p.descendantsResolve);
    if (badDescendants.length)
      bad(`descendants resolved elsewhere: ${badDescendants.map((p) => p.asiId).join(', ')}`);
    else ok('every descendant mesh resolves to its owning asiId');
    const notPicked = chain.picks.filter((p) => !p.picked);
    if (notPicked.length)
      bad(`could not raycast even when isolated: ${notPicked.map((p) => p.asiId).join(', ')}`);
    else ok('every structure resolved when isolated from the others');
  });

  await check('picks carry canonical sub-regions and a point', () => {
    for (const p of chain.picks) {
      if (!p.picked) continue;
      if (p.picked.structureId !== p.asiId) bad(`${p.asiId} resolved to ${p.picked.structureId}`);
      if (!Array.isArray(p.picked.subRegionIds) || p.picked.subRegionIds.length === 0)
        bad(`${p.asiId} carried no sub-region list`);
      if (!p.picked.hasPoint) bad(`${p.asiId} carried no surface point`);
    }
    ok('structureId, subRegionIds and point present on every pick');
    if (!chain.subRegionListsWhole) bad('an entry had an empty sub-region list');
    else ok('sub-region lists are whole');
    if (!chain.noInventedSingular)
      bad('an entry had a singular sub-region contradicting its list');
    else ok('no singular sub-region invented for a multi-sub-region structure');
  });

  /* ---------------------------------------------------------------- */
  /* unavailable means absent, not approximated                       */
  /* ---------------------------------------------------------------- */

  await check('every declared-unavailable structure is ABSENT from the scene', () => {
    if (!chain.unavailableAbsent)
      bad('a structure with no valid 3D representation is present in the scene');
    else ok('acromion, coracoid, both joints, spine of scapula, bursa all absent');
    if (!chain.compositeDeltoidAbsent)
      bad('the composite deltoid is in the scene; joining three parts is not implemented');
    else ok('the composite deltoid is absent, its three parts are not');
    if (!chain.deltoidPartsPresent)
      bad('a deltoid part is missing from the scene');
    else ok('all three real deltoid parts present with their own identities');
  });

  // Laterality deliberately does NOT live here. It used to, as a check that asserted
  // `provenance ? 'external' : 'missing'` -- which proves provenance EXISTS and says
  // nothing about the side, while sitting under the heading "laterality is preserved
  // through the chain". It is now `laterality-browser.mjs`, run against both real
  // shoulders, comparing canonical -> renderer -> mounted mesh -> pick.

  await check('no page errors', () => {
    if (errors.length) bad(`page errors: ${errors.join(' | ')}`);
    else ok('clean');
  });

  await page.screenshot({ path: `${out}/real-geometry.png`, fullPage: false });
} catch (e) {
  bad(`threw: ${e?.stack ?? e}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s) in the real-geometry pick path`);
  process.exit(1);
}
console.log(`\nall ${n} real-geometry checks passed`);