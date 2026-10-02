#!/usr/bin/env node
/**
 * Real-geometry proof for EVERY production scene, not just one.
 *
 * The shoulder gates proved the chain once:
 *
 *   canonical manifest -> renderer scene -> real GLB -> real GLTFLoader -> scene graph
 *   -> descendant mesh -> canonical asiId -> structure -> laterality -> pick result
 *
 * That proof is now generalised. A scene is discovered from the app's own scene module
 * rather than named here, so a region cannot be added to production with its geometry
 * unguarded, and the geometry is mounted exactly as the app mounts it -- no injected
 * loader, no stub, no second code path.
 *
 * Synthetic fixtures are deliberately NOT used here and are not replaced by this: the
 * synthetic gates prove picking, layers and fallback against geometry whose gaps are
 * known, and the real gates prove the source bindings. Both are needed; neither
 * substitutes for the other.
 */
import { mkdirSync } from 'node:fs';

// Playwright is not a repo dependency; the gate runner exports the path.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);

const url = process.env.ASI_WEB_URL || 'http://127.0.0.1:5177';
const out = process.env.ASI_SCREENSHOTS || '/tmp/asi-realgeom-shots';
mkdirSync(out, { recursive: true });

const problems = [];
let n = 0;
const ok = (m) => console.log(`ok   ${m}`);
const bad = (m) => {
  console.log(`FAIL ${m}`);
  problems.push(m);
};
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${++n}: ${name}`);
  } catch (e) {
    bad(`${name}: ${e?.message ?? e}`);
    n += 1;
  }
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(url);
  await page.waitForSelector('#root *', { timeout: 30_000 });

  /* ------------------------------------------------------------------ */
  /* mount every scene the app can build, through the real contract      */
  /* ------------------------------------------------------------------ */
  const result = await page.evaluate(async () => {
    const { Three3dAnatomyAdapter } = await import('/src/anatomy/three3d.ts');
    const active = await import('/src/anatomy/active-scene.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { getStructure } = await import('/node_modules/@asi/shared/src/index.ts');

    async function probe(region, side) {
      const selection = active.sceneFor(region, side);
      if (selection.kind !== 'scene')
        return { region, side, kind: selection.kind, reason: selection.reason ?? null };

      const scene = selection.scene;
      const host = document.createElement('div');
      host.style.cssText =
        'position:fixed;left:0;top:0;width:800px;height:600px;z-index:9999';
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'width:800px;height:600px';
      host.appendChild(canvas);
      document.body.appendChild(host);

      const adapter = new Three3dAnatomyAdapter({ manifest: scene });
      await adapter.mount(host);
      const roots = adapter.objects ?? new Map();
      const camera = adapter.camera;
      const canvasEl = adapter.canvas ?? canvas;
      const rect = canvasEl.getBoundingClientRect();

      const picks = [];
      for (const [asiId, root] of roots) {
        const entry = scene.entries.find((e) => e.asiId === asiId);
        const meshes = [];
        root.traverse((n) => {
          if (n.isMesh) meshes.push(n);
        });

        // Isolate this entry, then raycast its own vertices. Isolating is what makes
        // this an identity test rather than a visibility test: a structure sitting
        // behind another one reports the front one, which is correct behaviour.
        const others = [...roots.entries()].filter(([id]) => id !== asiId).map(([, r]) => r);
        const wasVisible = others.map((o) => o.visible);
        others.forEach((o) => {
          o.visible = false;
        });

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
              picked = hit;
              break outer;
            }
          }
        }
        others.forEach((o, i) => {
          o.visible = wasVisible[i];
        });

        let cx = 0;
        let count = 0;
        for (const mesh of meshes) {
          const pos = mesh.geometry.getAttribute('position');
          if (!pos) continue;
          const step = Math.max(1, Math.floor(pos.count / 40));
          for (let i = 0; i < pos.count; i += step) {
            const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
            mesh.localToWorld(v);
            cx += v.x;
            count += 1;
          }
        }

        picks.push({
          asiId,
          inDomain: Boolean(getStructure(asiId)),
          layerMatchesOntology: entry?.layer === getStructure(asiId)?.layer,
          canonicalLaterality: entry?.laterality ?? null,
          pickLaterality: picked?.laterality ?? null,
          picked: Boolean(picked),
          subRegionIdsWhole: Array.isArray(picked?.subRegionIds) && picked.subRegionIds.length > 0,
          hasPoint: Boolean(picked?.point),
          meshName: entry?.provenance?.meshName ?? null,
          conceptId: entry?.provenance?.conceptId ?? null,
          centroidX: count ? cx / count : null,
        });
      }

      const mounted = adapter.resources();
      adapter.dispose();
      host.remove();

      return {
        region,
        side,
        kind: 'scene',
        entryCount: scene.entries.length,
        sceneSource: scene.source,
        // Read the attribution's real shape rather than guessing field names: the
        // licence id lives under `licence.id` and the dataset under `source.dataset`.
        // The earlier version of this gate printed "undefined, [object Object]" and
        // still passed, which is exactly the kind of vacuous assertion this project
        // keeps having to catch.
        attribution: scene.attribution
          ? {
              dataset: scene.attribution.source?.dataset ?? null,
              release: scene.attribution.source?.release ?? null,
              licence: scene.attribution.licence?.id ?? null,
              synthetic: scene.attribution.synthetic,
            }
          : null,
        near: mounted.near ?? adapter.camera?.near ?? null,
        picks,
        released: adapter.resources(),
      };
    }

    const scenes = [];
    for (const region of active.PRODUCTION_REGIONS ?? [])
      for (const side of ['left', 'right'])
        scenes.push(await probe(region, side));

    // Regions with no build must SAY so rather than fall back to something else.
    const absent = [];
    for (const region of ['shoulder', 'neck', 'lower_back', 'knee']) {
      const s = active.sceneFor(region, 'left');
      absent.push({ region, kind: s.kind, reason: s.reason ?? null });
    }

    return {
      scenes,
      absent,
      regions: active.PRODUCTION_REGIONS ?? [],
      hasProductionScenes: {
        shoulder: active.hasProductionScenes('shoulder'),
        neck: active.hasProductionScenes('neck'),
        lower_back: active.hasProductionScenes('lower_back'),
        knee: active.hasProductionScenes('knee'),
      },
    };
  });

  /* ------------------------------------------------------------------ */

  const built = result.scenes.filter((s) => s.kind === 'scene');
  const notBuilt = result.scenes.filter((s) => s.kind !== 'scene');

  await check('production covers the regions it claims to, and no others', () => {
    if (!result.regions.length) throw new Error('no production regions discovered');
    ok(`regions with real geometry: ${result.regions.join(', ')}`);
    if (built.length !== result.regions.length * 2)
      throw new Error(`expected ${result.regions.length * 2} scenes, probed ${built.length}`);
    if (notBuilt.length) throw new Error(`a discovered region produced no scene: ${JSON.stringify(notBuilt)}`);
    // A region in the audit plan that is not built must report `needs-region`, not
    // quietly borrow another region's geometry.
    for (const entry of result.absent) {
      const shouldExist = result.hasProductionScenes[entry.region];
      if (shouldExist && entry.kind !== 'scene')
        throw new Error(`${entry.region} has geometry but sceneFor said ${entry.kind}`);
      if (!shouldExist && entry.kind !== 'needs-region')
        throw new Error(`${entry.region} has no geometry but sceneFor said ${entry.kind}, not needs-region`);
    }
    ok(`unbuilt regions report needs-region: ${result.absent.filter((a) => a.kind === 'needs-region').map((a) => a.region).join(', ')}`);
  });

  for (const scene of built) {
    const tag = `${scene.region}/${scene.side}`;

    await check(`${tag}: real external anatomy, attributed`, () => {
      if (scene.sceneSource !== 'external') throw new Error(`source is ${scene.sceneSource}`);
      if (!scene.attribution) throw new Error('no attribution');
      if (scene.attribution.synthetic) throw new Error('attribution claims synthetic');
      if (!scene.attribution.licence) throw new Error('no licence recorded');
      ok(`${scene.entryCount} entries, ${scene.attribution.dataset}, ${scene.attribution.licence}`);
    });

    await check(`${tag}: canonical laterality reaches the renderer entry`, () => {
      const wrong = scene.picks.filter((p) => p.canonicalLaterality !== scene.side);
      if (wrong.length)
        throw new Error(
          `${wrong.length} entries are not '${scene.side}': ${wrong.map((p) => `${p.asiId}=${p.canonicalLaterality}`).join(', ')}`,
        );
      ok(`${scene.picks.length} renderer entries all carry laterality=${scene.side}`);
    });

    await check(`${tag}: every entry is a real domain structure with real provenance`, () => {
      for (const p of scene.picks) {
        if (!p.inDomain) throw new Error(`${p.asiId} is not in anatomy.ts`);
        if (!p.layerMatchesOntology) throw new Error(`${p.asiId} layer disagrees with anatomy.ts`);
        if (!p.meshName) throw new Error(`${p.asiId} has no source mesh id`);
        if (!p.conceptId) throw new Error(`${p.asiId} has no source concept id`);
      }
      ok(`${scene.picks.length} structures resolve to a domain id and a source concept`);
    });

    await check(`${tag}: a real raycast resolves every structure, on the right side`, () => {
      const unpicked = scene.picks.filter((p) => !p.picked);
      if (unpicked.length)
        throw new Error(`not raycastable: ${unpicked.map((p) => p.asiId).join(', ')}`);
      const wrongSide = scene.picks.filter((p) => p.pickLaterality !== scene.side);
      if (wrongSide.length)
        throw new Error(`picks reported the wrong side: ${wrongSide.map((p) => p.asiId).join(', ')}`);
      ok(`${scene.picks.length} picks, every one reporting laterality=${scene.side}`);
    });

    await check(`${tag}: picks carry sub-regions and a point`, () => {
      for (const p of scene.picks) {
        if (!p.subRegionIdsWhole) throw new Error(`${p.asiId} carried no sub-region list`);
        if (!p.hasPoint) throw new Error(`${p.asiId} carried no point`);
      }
      ok('sub-region lists and surface points present');
    });

    await check(`${tag}: the geometry sits on its own side of the body`, () => {
      const wrong = scene.picks.filter(
        (p) => p.centroidX !== null && (scene.side === 'left' ? p.centroidX <= 0 : p.centroidX >= 0),
      );
      if (wrong.length)
        throw new Error(`${wrong.length} meshes are on the wrong side: ${wrong.map((p) => `${p.asiId} x=${p.centroidX.toFixed(1)}`).join(', ')}`);
      ok('every mounted mesh centroid is on the correct side');
    });

    await check(`${tag}: assets are released on dispose`, () => {
      if (scene.released.outstandingAssets !== 0)
        throw new Error(`${scene.released.outstandingAssets} assets outstanding after dispose`);
      if (scene.released.sceneObjects !== 0)
        throw new Error(`${scene.released.sceneObjects} scene objects survived dispose`);
      if (scene.released.canvasAttached) throw new Error('a canvas survived dispose');
      ok('nothing left mounted');
    });
  }

  await check('no scene can be a fixture, and none can fall back to one', () => {
    const fixtures = built.filter((s) => s.sceneSource === 'fixture');
    if (fixtures.length) throw new Error(`${fixtures.length} production scenes are fixtures`);
    ok(`${built.length} production scenes, all external`);
  });

  await check('no page errors', () => {
    if (errors.length) throw new Error(errors.join(' | '));
    ok('clean');
  });

  await page.screenshot({ path: `${out}/real-geometry-all-regions.png`, fullPage: false });
} catch (e) {
  bad(`threw: ${e?.stack ?? e}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s) in the real-geometry path`);
  process.exit(1);
}
console.log(`\nall ${n} real-geometry checks passed`);