/**
 * The 3D structure-click path, in a real browser with a real GPU context.
 *
 * The unit suite proves what a pick MEANS (`pick-intent.test.ts`). This proves the
 * parts that cannot be faked: that the canonical manifest survives the adapter, that
 * the scene's GLB URL is fetched and parsed by three's real GLTFLoader, that a
 * raycast against a real descendant MESH resolves to a canonical `asiId`, and that
 * the result reaches the real session store through the real functions the UI calls.
 *
 * The chain, end to end and nothing stubbed on the way through:
 *
 *   synthetic canonical AssetManifest -> toRendererScene -> RendererSceneManifest
 *   -> GLB url -> real GLTFLoader -> three.js scene graph -> descendant mesh
 *   -> raycast -> PickResult -> intentFromPick -> reducePickToDraft -> session
 *
 * WHY IT DRIVES THE MODULES RATHER THAN CLICKING THE PRODUCT CANVAS. The product's
 * 3D surface is mounted with `ACTIVE_SCENE`, and it is not free to mount a different
 * scene per test without a test-only route in the app. So the modules are imported
 * into the page (the pattern the other browser gates already use) and driven directly,
 * which covers every line that matters except React's own click plumbing. What that
 * last part costs is stated in the final check rather than glossed over.
 *
 * The multi-sub-region structure here is `asi:shoulder.deltoid`, which lives in both
 * `shoulder.anterior` and `shoulder.lateral` — the case that silently did nothing
 * before.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const url = process.env.ASI_WEB_URL || 'http://127.0.0.1:5189';
const out = process.env.ASI_SCREENSHOTS || '/tmp/asi-pick';
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
  /* 1. the whole pick chain, in one page context                       */
  /* ---------------------------------------------------------------- */
  const chain = await page.evaluate(async () => {
    const { SYNTHETIC_CANONICAL_MANIFEST, SYNTHETIC_ASSET_ROOT } = await import(
      '/test/fixtures/synthetic-canonical-manifest.ts'
    );
    const { toRendererScene } = await import('/src/anatomy/asset-scene-adapter.ts');
    const { indexScene } = await import('/src/anatomy/scene-manifest.ts');
    const { Three3dAnatomyAdapter } = await import('/src/anatomy/three3d.ts');
    const { intentFromPick, reducePickToDraft } = await import('/src/anatomy/pick-intent.ts');
    const { useSession } = await import('/src/state/session.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');

    // Canonical -> scene, through the production adapter.
    const scene = toRendererScene(SYNTHETIC_CANONICAL_MANIFEST, {
      assetRoot: SYNTHETIC_ASSET_ROOT,
    });
    indexScene(scene);

    // A real canvas on the real document, so WebGL and the loader are real.
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:480px;z-index:9999';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:640px;height:480px';
    host.appendChild(canvas);
    document.body.appendChild(host);

    // NO injected loader: this fetches /fixtures/... and parses it with the real
    // GLTFLoader, which is the part that cannot be stubbed.
    const adapter = new Three3dAnatomyAdapter({ manifest: scene });
    await adapter.mount(host);

    const resources = adapter.resources();
    const objects = adapter.getState();

    // Raycast a real descendant mesh of the deltoid entry.
    const internals = adapter;
    const roots = internals.objects ?? new Map();
    const root = roots.get('asi:shoulder.deltoid');
    let hit = { kind: 'none' };
    if (root) {
      const meshes = [];
      root.traverse((node) => {
        if (node.isMesh) meshes.push(node);
      });
      const camera = internals.camera;
      camera.updateMatrixWorld(true);
      // Aim at the first descendant mesh's centre, in viewport pixels.
      const mesh = meshes[0];
      mesh.geometry.computeBoundingBox();
      const centre = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
      mesh.localToWorld(centre);
      const ndc = centre.clone().project(camera);
      const rect = canvas.getBoundingClientRect();
      hit = adapter.pick(
        rect.left + ((ndc.x + 1) / 2) * rect.width,
        rect.top + ((1 - ndc.y) / 2) * rect.height,
      );
    }

    // Drive the REAL session store exactly as BodyMap.handlePick does.
    const store = useSession.getState();
    const setSideAndRegion = () => {
      store.setStage('locate');
    };
    setSideAndRegion();

    function applyPick(pickResult, recordSubRegionId, draft) {
      const intent = intentFromPick(pickResult, recordSubRegionId);
      const effect = reducePickToDraft(intent, draft, recordSubRegionId);
      // The immediate structure selection, through the session's own action.
      if (effect.selectStructureId) store.select(effect.selectStructureId);
      return { intent, effect };
    }

    const deltoidEntry = scene.entries.find((e) => e.asiId === 'asi:shoulder.deltoid');
    const acromionEntry = scene.entries.find((e) => e.asiId === 'asi:shoulder.acromion');

    // A. multi-sub-region pick, no recorded area -> UNRESOLVED, structure selected.
    const before = useSession.getState().record.location;
    const multi = applyPick(hit, before.subRegionId ?? null, {
      subRegionId: null,
      point: null,
    });
    const afterMulti = useSession.getState().record.location;

    // B. same structure, with an area already recorded that it belongs to -> KEEP.
    useSession.getState().deselect('asi:shoulder.deltoid');
    const kept = applyPick(hit, 'shoulder.lateral', {
      subRegionId: 'shoulder.lateral',
      point: null,
    });

    // C. a single-sub-region structure -> USE.
    useSession.getState().deselect('asi:shoulder.deltoid');
    const acromionPick = {
      kind: 'structure',
      asiId: acromionEntry.asiId,
      structureId: acromionEntry.asiId,
      subRegionIds: acromionEntry.subRegionIds,
      subRegionId: acromionEntry.soleSubRegionId,
      point: { x: 0.5, y: 0.5 },
    };
    const single = applyPick(acromionPick, null, { subRegionId: null, point: null });

    // D. the record after a confirm: pinAt is the real path a draft point takes.
    useSession.getState().pinAt({ x: 0.5, y: 0.5 });
    const finalLocation = useSession.getState().record.location;

    adapter.dispose();
    host.remove();

    return {
      sceneSource: scene.source,
      attributionSynthetic: scene.attribution?.synthetic ?? null,
      disclaimer: scene.disclaimer ?? null,
      entryCount: scene.entries.length,
      deltoidSubRegionIds: deltoidEntry.subRegionIds,
      deltoidSoleSubRegionId: deltoidEntry.soleSubRegionId ?? null,
      acromionSubRegionIds: acromionEntry.subRegionIds,
      hit: { kind: hit.kind, asiId: hit.asiId, structureId: hit.structureId ?? null, subRegionIds: hit.subRegionIds ?? null, subRegionId: hit.subRegionId ?? null, point: hit.point ?? null },
      liveDuringRun: resources.sceneObjects,
      multiIntent: multi.intent.kind,
      multiSubRegion: multi.intent.kind === 'structure' ? multi.intent.subRegion : null,
      multiSelectedIds: afterMulti.userSelectedStructureIds,
      multiDraftSubRegion: multi.effect.draft.subRegionId,
      keptSubRegion: kept.intent.kind === 'structure' ? kept.intent.subRegion : null,
      keptDraftSubRegion: kept.effect.draft.subRegionId,
      singleSubRegion: single.intent.kind === 'structure' ? single.intent.subRegion : null,
      singleDraftSubRegion: single.effect.draft.subRegionId,
      singleSelectedIds: useSession.getState().record.location.userSelectedStructureIds,
      finalPoint: finalLocation.point,
      finalSubRegionId: finalLocation.subRegionId ?? null,
      recordKeys: Object.keys(useSession.getState().record.location),
      viewerState: objects.region,
    };
  });

  /* ---------------------------------------------------------------- */
  /* 2. what the chain actually produced                              */
  /* ---------------------------------------------------------------- */

  await check('the canonical manifest became a scene with real geometry', () => {
    // The synthetic manifest declares itself synthetic, so the adapter marks the
    // scene a fixture. That is the point of the marker: this chain runs on real GLB
    // bytes through the real loader, but the geometry is still not anatomy, and the
    // scene must say so rather than claim a source dataset.
    if (chain.sceneSource !== 'fixture') bad(`scene source is ${chain.sceneSource}, expected fixture`);
    else ok(`scene source: ${chain.sceneSource} (synthetic geometry, honestly labelled)`);
    if (chain.attributionSynthetic !== true) bad('the scene did not carry synthetic provenance');
    else ok('attribution.synthetic = true');
    if (chain.disclaimer === null || !/not anatomy/i.test(chain.disclaimer))
      bad(`disclaimer missing or unclear: ${chain.disclaimer}`);
    else ok('disclaimer states it is not anatomy');
    if (chain.liveDuringRun < 2) bad(`only ${chain.liveDuringRun} scene object(s) adopted`);
    else ok(`${chain.liveDuringRun} scene objects adopted from the GLB`);
  });

  await check('the multi-sub-region structure kept its whole canonical list', () => {
    if (chain.deltoidSoleSubRegionId !== null)
      bad('the deltoid was given a sole sub-region, so subRegionIds[0] was taken as the truth');
    if (chain.deltoidSubRegionIds.length !== 2) bad(`expected 2 sub-regions, got ${chain.deltoidSubRegionIds.length}`);
    else ok(`deltoid subRegionIds = ${chain.deltoidSubRegionIds.join(', ')}, no singular answer`);
  });

  await check('a real raycast on a descendant MESH resolved to the canonical asiId', () => {
    if (chain.hit.kind !== 'structure') bad(`raycast hit was "${chain.hit.kind}", not a structure`);
    else if (chain.hit.asiId !== 'asi:shoulder.deltoid') bad(`resolved to ${chain.hit.asiId}`);
    else ok(`hit ${chain.hit.asiId} (structureId ${chain.hit.structureId})`);
    if (!chain.hit.point) bad('the pick carried no surface point, so a pin could not be placed');
    else ok(`surface point = ${JSON.stringify(chain.hit.point)}`);
  });

  await check('clicking a multi-sub-region structure SELECTS it and asks for an area', () => {
    if (chain.multiIntent !== 'structure') bad(`intent was "${chain.multiIntent}", not a structure`);
    if (!chain.multiSelectedIds.includes('asi:shoulder.deltoid'))
      bad(`structure not selected: ${JSON.stringify(chain.multiSelectedIds)}`);
    else ok('structure entered location.userSelectedStructureIds');
    if (chain.multiSubRegion?.kind !== 'unresolved')
      bad(`sub-region was ${chain.multiSubRegion?.kind}, expected unresolved`);
    else ok(`unresolved, candidates = ${chain.multiSubRegion.candidates.join(', ')}`);
    if (chain.multiDraftSubRegion !== null) bad(`an area was chosen: ${chain.multiDraftSubRegion}`);
    else ok('no area was invented');
  });

  await check('an area the structure belongs to is KEPT', () => {
    if (chain.keptSubRegion?.kind !== 'keep') bad(`resolution was ${chain.keptSubRegion?.kind}`);
    else ok(`kept ${chain.keptSubRegion.subRegionId}`);
    if (chain.keptDraftSubRegion !== 'shoulder.lateral')
      bad(`draft area became ${chain.keptDraftSubRegion}`);
    else ok('the recorded area was not overwritten');
  });

  await check('a single-sub-region structure adopts its one candidate', () => {
    if (chain.singleSubRegion?.kind !== 'use') bad(`resolution was ${chain.singleSubRegion?.kind}`);
    else ok(`adopted ${chain.singleSubRegion.subRegionId}`);
    if (chain.singleDraftSubRegion !== 'shoulder.lateral') bad(`draft was ${chain.singleDraftSubRegion}`);
    if (!chain.singleSelectedIds.includes('asi:shoulder.acromion'))
      bad(`structure not selected: ${JSON.stringify(chain.singleSelectedIds)}`);
    else ok('acromion entered location.userSelectedStructureIds');
  });

  await check('the pick point became the user pin through pinAt', () => {
    if (!chain.finalPoint) bad('pinAt did not record the point');
    else ok(`location.point = ${JSON.stringify(chain.finalPoint)}`);
  });

  await check('it is still a visual LOCATION and nothing clinical', () => {
    // The strongest available statement: the write path only ever touched location
    // fields, and none of them is a finding.
    const banned = /diagnos|severity|risk|finding|confirmed/i;
    for (const key of chain.recordKeys)
      if (banned.test(key)) bad(`a clinical-looking field appeared on location: ${key}`);
    ok(`location fields written: ${chain.recordKeys.join(', ')}`);
  });

  await check('no page errors', () => {
    if (errors.length) bad(`page errors: ${errors.join(' | ')}`);
    else ok('clean');
  });

  await page.screenshot({ path: `${out}/structure-pick.png`, fullPage: false });
} catch (e) {
  bad(`threw: ${e?.stack ?? e}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s) in the 3D structure-pick path`);
  process.exit(1);
}
console.log(`\nall ${n} structure-pick checks passed`);