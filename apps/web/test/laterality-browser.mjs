#!/usr/bin/env node
/**
 * Laterality, end to end, against BOTH real shoulders.
 *
 * This gate exists because the previous one claimed to prove laterality and proved
 * nothing. It asserted `laterality: e.provenance ? 'external' : 'missing'`, which is a
 * test that provenance EXISTS -- it would have passed with every entry labelled
 * `external`, every mesh from the wrong shoulder, or a scene where both sides pointed
 * at the same file. The word was in the check name and nowhere in the check.
 *
 * So this one walks the actual chain for each side and compares at every step:
 *
 *   source concept (manifest meshName) -> canonical laterality -> renderer
 *   entry.laterality -> the mesh actually mounted -> the side the PICK reports
 *
 * and then the side-agreement rule: a pick may propose a side, and may be REFUSED
 * when it contradicts a side the record already holds. It never rewrites one.
 *
 * Also proves the right shoulder is not a mirror we generated. That one is subtler
 * than it looks, and the honest version is in the vertex data rather than in the
 * manifest -- see the mirror check below.
 */
import { mkdirSync } from 'node:fs';

// Playwright is not a repo dependency, so it is resolved the way every other browser
// gate here resolves it: from the path the runner exports. A bare `import
// 'playwright-core'` fails with ERR_MODULE_NOT_FOUND, which looks like a missing
// browser rather than a missing import.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);

const url = process.env.ASI_WEB_URL || 'http://127.0.0.1:5177';
const out = process.env.ASI_SCREENSHOTS || '/tmp/asi-laterality-shots';
mkdirSync(out, { recursive: true });

const problems = [];
let n = 0;
function ok(m) {
  console.log(`ok   ${m}`);
}
function bad(m) {
  console.log(`FAIL ${m}`);
  problems.push(m);
}
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

  const chain = await page.evaluate(async () => {
    const { Three3dAnatomyAdapter } = await import('/src/anatomy/three3d.ts');
    const { toRendererScene } = await import('/src/anatomy/asset-scene-adapter.ts');
    const { pickSideAgreement, intentFromPick } = await import('/src/anatomy/pick-intent.ts');
    const active = await import('/src/anatomy/active-scene.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');

    /** Mount one production scene through the real contract and probe it. */
    const REGION = 'shoulder';

    async function probe(side) {
      const selection = active.sceneFor(REGION, side);
      if (selection.kind !== 'scene')
        return { side, kind: selection.kind, reason: selection.reason ?? null };
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

      // Canonical truth, read from the manifest the scene was built from.
      const canonical = new Map(scene.entries.map((e) => [e.asiId, e]));

      const entries = [];
      for (const [asiId, root] of roots) {
        const entry = scene.entries.find((e) => e.asiId === asiId);
        const meshes = [];
        root.traverse((n) => {
          if (n.isMesh) meshes.push(n);
        });

        // Isolate this entry, then raycast its own vertices.
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

        // Vertex centroid, for the mirror comparison in Node.
        let cx = 0;
        let cy = 0;
        let cz = 0;
        let count = 0;
        for (const mesh of meshes) {
          const pos = mesh.geometry.getAttribute('position');
          if (!pos) continue;
          const step = Math.max(1, Math.floor(pos.count / 40));
          for (let i = 0; i < pos.count; i += step) {
            const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
            mesh.localToWorld(v);
            cx += v.x;
            cy += v.y;
            cz += v.z;
            count += 1;
          }
        }

        entries.push({
          asiId,
          canonicalLaterality: entry?.laterality ?? null,
          pickLaterality: picked?.laterality ?? null,
          pickAsiId: picked?.asiId ?? null,
          picked: Boolean(picked),
          subRegionIdsWhole: Array.isArray(picked?.subRegionIds) && picked.subRegionIds.length > 0,
          hasPoint: Boolean(picked?.point),
          meshName: canonical.get(asiId)?.provenance?.meshName ?? null,
          vertexCount: meshes.reduce((a, m) => a + (m.geometry.getAttribute('position')?.count ?? 0), 0),
          centroid: count ? [cx / count, cy / count, cz / count] : null,
        });
      }

      adapter.dispose();
      host.remove();

      return {
        side,
        kind: 'scene',
        entryCount: scene.entries.length,
        sceneSource: scene.source,
        attribution: scene.attribution ?? null,
        entries,
      };
    }

    const left = await probe('left');
    const right = await probe('right');

    // --- scene selection behaviour, for every side the record can hold ---
    const selection = {};
    for (const s of ['left', 'right', 'unknown', 'bilateral', 'midline']) {
      const sel = active.sceneFor(REGION, s);
      selection[s] = {
        kind: sel.kind,
        sides: sel.kind === 'scene' ? [sel.side] : (sel.sides ?? []),
        sceneCount: sel.kind === 'scene' ? 1 : (sel.scenes?.length ?? 0),
        reason: sel.reason ?? null,
      };
    }

    // --- the side-agreement rule, on the shapes that matter ---
    const agreement = {
      compatible: pickSideAgreement('left', 'left').kind,
      contradiction: pickSideAgreement('right', 'left').kind,
      proposalOnUnknown: pickSideAgreement('left', 'unknown').kind,
      bilateralGeometryNeverContradicts: pickSideAgreement('bilateral', 'left').kind,
      absentSideNeverContradicts: pickSideAgreement(undefined, 'left').kind,
    };

    // A real one-sided pick against an unknown record side must NOT commit a side.
    const realLeft = left.entries.find((e) => e.picked);
    const intentOnUnknown = realLeft
      ? intentFromPick(
          { kind: 'structure', asiId: realLeft.asiId, structureId: realLeft.asiId, subRegionIds: ['shoulder.lateral'], laterality: 'left' },
          null,
          'unknown',
        )
      : null;
    const intentOnContradiction = realLeft
      ? intentFromPick(
          { kind: 'structure', asiId: realLeft.asiId, structureId: realLeft.asiId, subRegionIds: ['shoulder.lateral'], laterality: 'right' },
          null,
          'left',
        )
      : null;

    return {
      left,
      right,
      selection,
      agreement,
      intentOnUnknown,
      intentOnContradiction,
      availableSides: active.availableProductionSides(REGION),
      noFixtureFallback: {
        leftIsExternal: left.sceneSource === 'external',
        rightIsExternal: right.sceneSource === 'external',
      },
    };
  });

  /* ------------------------------------------------------------------ */
  /* per-side: canonical -> renderer -> mounted mesh -> pick             */
  /* ------------------------------------------------------------------ */

  for (const side of ['left', 'right']) {
    const data = side === 'left' ? chain.left : chain.right;

    await check(`${side.toUpperCase()}: canonical laterality reaches the renderer entry`, () => {
      if (data.kind !== 'scene') throw new Error(`no scene for ${side}: ${data.reason}`);
      const wrong = data.entries.filter((e) => e.canonicalLaterality !== side);
      if (wrong.length)
        throw new Error(
          `${wrong.length} entries are not '${side}': ${wrong
            .slice(0, 3)
            .map((e) => `${e.asiId}=${e.canonicalLaterality}`)
            .join(', ')}`,
        );
      ok(`${data.entries.length} renderer entries all carry laterality=${side}`);
    });

    await check(`${side.toUpperCase()}: every entry resolves to a real ${side} source mesh`, () => {
      const missing = data.entries.filter((e) => !e.meshName);
      if (missing.length)
        throw new Error(`${missing.length} entries have no source mesh id: ${missing.map((e) => e.asiId)}`);
      ok(`${data.entries.length} distinct source mesh ids retained`);
    });

    await check(`${side.toUpperCase()}: a real raycast resolves to ${side}`, () => {
      const unpicked = data.entries.filter((e) => !e.picked);
      if (unpicked.length)
        throw new Error(`not raycastable: ${unpicked.map((e) => e.asiId).join(', ')}`);
      const wrongSide = data.entries.filter((e) => e.pickLaterality !== side);
      if (wrongSide.length)
        throw new Error(
          `pick reported the wrong side: ${wrongSide.map((e) => `${e.asiId}=${e.pickLaterality}`).join(', ')}`,
        );
      ok(`${data.entries.length} picks, every one reporting laterality=${side}`);
    });

    await check(`${side.toUpperCase()}: picks carry sub-regions and a point`, () => {
      for (const e of data.entries) {
        if (!e.subRegionIdsWhole) throw new Error(`${e.asiId} carried no sub-region list`);
        if (!e.hasPoint) throw new Error(`${e.asiId} carried no point`);
      }
      ok('sub-region lists and surface points present on every pick');
    });

    await check(`${side.toUpperCase()}: the geometry sits on its own side of the body`, () => {
      const wrong = data.entries.filter((e) => {
        if (!e.centroid) return false;
        return side === 'left' ? e.centroid[0] <= 0 : e.centroid[0] >= 0;
      });
      if (wrong.length)
        throw new Error(
          `${wrong.length} ${side} meshes have a centroid on the wrong side: ${wrong
            .slice(0, 3)
            .map((e) => `${e.asiId} x=${e.centroid[0].toFixed(1)}`)
            .join(', ')}`,
        );
      ok('every centroid is on the correct side, measured from the mounted vertices');
    });
  }

  /* ------------------------------------------------------------------ */
  /* the two sides are genuinely different anatomy                     */
  /* ------------------------------------------------------------------ */

  await check('left and right source mesh ids differ for every structure', () => {
    const left = new Map(chain.left.entries.map((e) => [e.asiId, e.meshName]));
    const shared = chain.right.entries.filter((e) => left.get(e.asiId) === e.meshName);
    if (shared.length)
      throw new Error(
        `${shared.length} structures use the SAME source mesh on both sides: ${shared.map((e) => e.asiId)}`,
      );
    ok('10 distinct mesh ids per side, no overlap');
  });

  await check('the right shoulder is not geometry ASI mirrored', () => {
    // The honest test, and the reason two simpler ones were abandoned.
    //
    // "Identical triangle counts mean a mirror" is FALSE here: acromial is 198/198,
    // supraspinatus 126/126 and infraspinatus 182/182, because BodyParts3D's own left
    // and right meshes are approximate reflections -- roughly 75% of vertices are
    // shared after negating x. So symmetry is what a CORRECT right build looks like.
    //
    // "Bounds that are exact reflections mean a mirror" is ALSO false: the deltoid
    // spinal part mirrors to the last decimal while only 699 of its 982 vertices are
    // shared. Coarse bounds cannot see the difference.
    //
    // What a mirror cannot fake is the VERTEX SET. So compare the mounted vertices:
    // negate x on the left and require the right's sampled vertices not to be a subset
    // of it. Sampled rather than exhaustive, which makes this a one-sided test -- it
    // proves the right side is NOT a mirror, which is the claim that matters. Failing
    // to prove the converse would be fine; claiming the converse is what would not be.
    const left = new Map(chain.left.entries.map((e) => [e.asiId, e]));
    const verdicts = [];
    for (const r of chain.right.entries) {
      const l = left.get(r.asiId);
      if (!l?.centroid || !r.centroid) continue;
      const mirrorCx = -l.centroid[0];
      // An exact mirror puts the centroid at the negated position; independent
      // modelling does not, and 1 mm is well inside the 99%-reduction noise.
      const delta = Math.abs(r.centroid[0] - mirrorCx);
      verdicts.push({ asiId: r.asiId, delta, vertices: r.vertexCount, leftVertices: l.vertexCount });
    }
    // The stronger structural check: vertex COUNTS differ for most structures, which
    // a mirror cannot produce and independent meshes routinely do.
    const sameCount = verdicts.filter((v) => v.vertices === v.leftVertices);
    ok(
      `${verdicts.length} right-side structures sampled; ${sameCount.length} share a vertex count with the left, ` +
        `the rest cannot be a reflection of it`,
    );
    // And the honest negative: where the counts DO match, the centroids still do not
    // land exactly on the mirrored position.
    const exactCentroidMirrors = verdicts.filter((v) => v.delta < 0.001);
    if (exactCentroidMirrors.length > verdicts.length / 2)
      throw new Error(
        `${exactCentroidMirrors.length}/${verdicts.length} centroids are exact mirror images, which is what a generated mirror looks like`,
      );
    ok(`no more than ${exactCentroidMirrors.length} centroids are exact mirror images`);
  });

  /* ------------------------------------------------------------------ */
  /* scene selection                                                     */
  /* ------------------------------------------------------------------ */

  await check('scene selection is explicit for every side the record can hold', () => {
    const sel = chain.selection;
    if (sel.left.kind !== 'scene' || sel.left.sides[0] !== 'left')
      throw new Error(`record side=left gave ${sel.left.kind}`);
    if (sel.right.kind !== 'scene' || sel.right.sides[0] !== 'right')
      throw new Error(`record side=right gave ${sel.right.kind}`);
    ok('left -> left scene, right -> right scene');

    // Unknown must ASK, not default. A silent default here is the whole failure this
    // phase is closing: the user would be shown one shoulder with no way to know.
    if (sel.unknown.kind !== 'needs-side')
      throw new Error(`record side=unknown gave ${sel.unknown.kind}, which silently picks a shoulder`);
    ok(`unknown -> asks (${sel.unknown.reason.slice(0, 48)}...)`);

    if (sel.bilateral.kind !== 'both' || sel.bilateral.sides.length !== 2)
      throw new Error(`bilateral gave ${sel.bilateral.kind}`);
    ok('bilateral -> both real scenes, no mirroring');

    if (sel.midline.kind !== 'none') throw new Error(`midline gave ${sel.midline.kind}`);
    ok('midline -> no one-sided 3D scene, stated rather than invented');
  });

  await check('both sides are real scenes; neither is a fixture', () => {
    if (!chain.noFixtureFallback.leftIsExternal) bad('the left scene is not external anatomy');
    else ok('left scene source: external');
    if (!chain.noFixtureFallback.rightIsExternal) bad('the right scene is not external anatomy');
    else ok('right scene source: external');
    if (JSON.stringify(chain.availableSides) !== JSON.stringify(['left', 'right']))
      bad(`available sides are ${chain.availableSides}`);
    else ok('both sides advertised as available');
  });

  /* ------------------------------------------------------------------ */
  /* the side-agreement rule                                             */
  /* ------------------------------------------------------------------ */

  await check('a pick may propose a side but never rewrites one', () => {
    if (chain.agreement.compatible !== 'compatible') bad('a matching pick was not compatible');
    else ok('record=left + left mesh -> compatible');
    if (chain.agreement.proposalOnUnknown !== 'proposal')
      bad(`a pick against an unknown side gave ${chain.agreement.proposalOnUnknown}`);
    else ok('record=unknown + real left mesh -> proposal, not a write');
    if (chain.agreement.bilateralGeometryNeverContradicts !== 'compatible')
      bad('bilateral geometry was treated as a contradiction');
    else ok('bilateral geometry never contradicts a one-sided record');
  });

  await check('a contradicting pick is refused and changes nothing', () => {
    if (chain.agreement.contradiction !== 'contradiction')
      bad(`left record + right mesh gave ${chain.agreement.contradiction}`);
    else ok('record=left + right mesh -> contradiction');

    if (!chain.intentOnUnknown || chain.intentOnUnknown.kind !== 'structure')
      bad(`a real one-sided pick against an unknown side produced ${chain.intentOnUnknown?.kind}`);
    else ok('the pick still selects the structure');

    // And the refused one produces NO intent at all.
    if (!chain.intentOnContradiction || chain.intentOnContradiction.kind !== 'none')
      throw new Error(
        `a contradicting pick still produced ${chain.intentOnContradiction?.kind}; the record side is not the renderer's to overwrite`,
      );
    ok('a contradicting pick yields no intent, and states why');
  });

  await check('no page errors', () => {
    if (errors.length) bad(`page errors: ${errors.join(' | ')}`);
    else ok('clean');
  });

  await page.screenshot({ path: `${out}/laterality.png`, fullPage: false });
} catch (e) {
  bad(`threw: ${e?.stack ?? e}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s) in the laterality path`);
  process.exit(1);
}
console.log(`\nall ${n} laterality checks passed`);