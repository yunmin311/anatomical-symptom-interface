/**
 * The URL geometry path, in a real browser, with no injected transport.
 *
 * The node tests hand the adapter GLB bytes. This one does not: it mounts the
 * real adapter in the running app, the production GLTFLoader does a real HTTP
 * fetch of a real GLB over the dev server, and a real WebGL context draws it.
 * That is the only way to catch what an injected transport hides by definition —
 * a fetch the server 404s, an asset the bundler will not serve, a material whose
 * shader does not compile, a bounds measurement that only holds for stubbed
 * transforms.
 *
 * The fixture is two non-medical quads under a Group
 * (public/fixtures/non-medical-two-quads.glb). It is not anatomy.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const url = process.env.ASI_WEB_URL || 'http://127.0.0.1:5189';
const GLB = '/fixtures/non-medical-two-quads.glb';
const out = process.env.ASI_SCREENSHOTS || '/tmp/asi-url-glb';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const problems = [];
let n = 0;
const ok = (m) => console.log('     ' + m);
const bad = (m) => {
  problems.push(m);
  console.log('     FAIL ' + m);
};
async function check(name, fn) {
  await fn();
  console.log(`PASS ${++n}: ${name}`);
}

/**
 * Mount the production adapter against a manifest whose entry uses `url`
 * geometry, inside the live page, with the default loader.
 */
/**
 * Mount the production adapter inside the page, using the default loader.
 *
 * Defined as source text because it has to run in the browser's realm, where it
 * can `import()` the app's own modules. `options.url` is passed in rather than
 * closed over, since a free variable would not exist in that realm.
 */
const MOUNT_SOURCE = `
async function mount(options) {
  const { Three3dAnatomyAdapter } = await import('/src/anatomy/three3d.ts');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:480px;z-index:9999';
  document.body.appendChild(host);
  const manifest = {
    version: 'browser-url-test',
    source: 'fixture',
    disclaimer: 'Test fixture geometry. Not anatomy.',
    externalAssetNotice: 'Two non-medical quads in a Group. Not anatomy.',
    bounds: { height: 2, radius: 1 },
    entries: [
      {
        asiId: 'asi:shoulder.deltoid',
        kind: 'structure',
        region: 'shoulder',
        subRegionIds: ['shoulder.anterior', 'shoulder.lateral'],
        structureId: 'shoulder.deltoid',
        layer: options.layer || 'muscle',
        views: ['anterior', 'posterior', 'lateral_left', 'lateral_right'],
        geometry: { type: 'url', url: options.url, nodeName: options.nodeName },
      },
    ],
  };
  const adapter = new Three3dAnatomyAdapter({ manifest });
  await adapter.mount(host);
  return { adapter, host };
}
return mount;
`;

/** Define the helper once in the page, so each check can just call it. */
async function installHelper() {
  await page.evaluate((src) => {
    // eslint-disable-next-line no-new-func
    window.__mountUrl = new Function(src)();
  }, MOUNT_SOURCE);
}

const mountArgs = (over = {}) => JSON.parse(JSON.stringify({ url: GLB, ...over }));

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#root', { timeout: 20_000 });
  // The dev server rewrites modules on first request, which can trigger a
  // full-reload and destroy the execution context mid-evaluate. Waiting for the
  // app's own modules to have loaded makes the context stable for the rest.
  await page.evaluate(async () => {
    await import('/src/anatomy/three3d.ts');
    await import('/src/anatomy/workspace.ts');
    await import('/src/anatomy/svg2d.ts');
  });
  await installHelper();

  await check('the dev server actually serves the GLB with a glTF content type', async () => {
    const res = await page.evaluate(async (p) => {
      const r = await fetch(p);
      const b = await r.arrayBuffer();
      const magic = new TextDecoder().decode(new Uint8Array(b, 0, 4));
      return {
        status: r.status,
        type: r.headers.get('content-type'),
        bytes: b.byteLength,
        magic,
        version: new DataView(b).getUint32(4, true),
      };
    }, GLB);
    console.log('     fetch:', JSON.stringify(res));
    if (res.status !== 200) return bad(`GLB fetch returned ${res.status}`);
    if (res.magic !== 'glTF' || res.version !== 2) return bad('served bytes are not a glTF 2.0 binary');
    if (res.bytes < 1000) return bad(`served GLB is only ${res.bytes} bytes`);
    if (!/gltf|octet-stream/.test(res.type ?? '')) return bad(`odd content-type: ${res.type}`);
    ok(`${res.bytes} bytes served as ${res.type}`);
  });

  await check('mount() waits for a real fetch and adopts a real loaded scene graph', async () => {
    const probe = await page.evaluate(async (args) => {
      const { adapter, host } = await window.__mountUrl(args);
      const scene = adapter.scene;
      const objects = adapter.objects;
      const root = objects.get('asi:shoulder.deltoid');
      let meshCount = 0;
      let depth = 0;
      root?.traverse((o) => {
        if (o.isMesh) meshCount += 1;
        if (o === root) return;
        let d = 0;
        for (let n = o; n && n !== root; n = n.parent) d += 1;
        depth = Math.max(depth, d + 1);
      });
      // WebGL is real: the canvas has a live context and non-zero size.
      const canvas = host.querySelector('canvas');
      const gl = canvas ? canvas.getContext('webgl2') || canvas.getContext('webgl') : null;
      const result = {
        rootIsGroup: Boolean(root && root.isGroup),
        rootName: root?.name ?? null,
        meshCount,
        depth,
        canvas: Boolean(canvas),
        canvasSize: canvas ? [canvas.width, canvas.height] : null,
        glLive: Boolean(gl),
        renderer: gl ? gl.getParameter(gl.RENDERER) : null,
        inScene: Boolean(scene && root && root.parent === scene),
      };
      adapter.dispose();
      host.remove();
      return result;
    }, mountArgs());
    console.log('     probe:', JSON.stringify(probe));
    if (!probe.rootIsGroup) return bad('the GLB Group root was not adopted');
    // three names the loaded root after the glTF scene, so the adopted graph is
    // scene -> fixture_root -> [fixture_lower, fixture_upper]: three levels, two
    // of them Groups, which is the nesting this whole path exists to handle.
    if (probe.rootName !== 'fixture_scene') return bad(`unexpected root name: ${probe.rootName}`);
    if (probe.depth !== 3) return bad(`expected the meshes 3 levels below the root, got ${probe.depth}`);
    if (probe.meshCount !== 2) return bad(`expected 2 descendant meshes, got ${probe.meshCount}`);
    if (!probe.inScene) return bad('the loaded root is not parented to the scene');
    if (!probe.canvas || !probe.glLive) return bad('no live WebGL context behind the loaded asset');
    ok(`Group + 2 meshes, WebGL live (${probe.renderer})`);
  });

  await check('a descendant mesh picks back to the manifest asiId, over real WebGL', async () => {
    const probe = await page.evaluate(async (args) => {
      const { adapter, host } = await window.__mountUrl(args);
      adapter.focusCamera('anterior', { immediate: true });
      const camera = adapter.camera;
      camera.updateMatrixWorld(true);
      const root = adapter.objects.get('asi:shoulder.deltoid');
      const rect = host.getBoundingClientRect();
      const picks = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.computeBoundingBox();
        const centre = o.geometry.boundingBox.getCenter(o.position.clone());
        const world = centre.clone();
        o.localToWorld(world);
        const ndc = world.project(camera);
        picks.push(
          adapter.pick(
            rect.left + ((ndc.x + 1) / 2) * rect.width,
            rect.top + ((1 - ndc.y) / 2) * rect.height,
          ),
        );
      });
      adapter.dispose();
      host.remove();
      return picks;
    }, mountArgs());
    console.log('     picks:', JSON.stringify(probe));
    const hit = probe.find((p) => p && p.asiId === 'asi:shoulder.deltoid');
    if (!hit) return bad('no descendant mesh resolved to the manifest asiId');
    if (hit.structureId !== 'shoulder.deltoid') return bad(`wrong structureId: ${hit.structureId}`);
    if ('object' in hit || 'mesh' in hit || 'uuid' in hit) return bad('PickResult leaked a handle');
    ok('descendant raycast resolved to the owning asiId');
  });

  await check('depth and highlight reach the real loaded materials', async () => {
    const probe = await page.evaluate(async (args) => {
      const { adapter, host } = await window.__mountUrl(args);
      const root = adapter.objects.get('asi:shoulder.deltoid');
      const meshes = [];
      root.traverse((o) => {
        if (o.isMesh) meshes.push(o);
      });
      const colour = () => `#${meshes[0].material.color.getHexString()}`;
      const allShare = () => new Set(meshes.map((m) => m.material)).size === 1;
      const idle = colour();
      adapter.apply({ type: 'setDepth', depth: 'deep' });
      const deep = colour();
      const deepShared = allShare();
      adapter.apply({ type: 'setDepth', depth: 'superficial' });
      const superficial = colour();
      adapter.apply({ type: 'setHighlighted', structureIds: ['shoulder.deltoid'] });
      const candidate = colour();
      adapter.apply({ type: 'setSelected', structureIds: ['shoulder.deltoid'] });
      const selected = colour();
      adapter.apply({ type: 'setSelected', structureIds: [] });
      const cleared = colour();
      adapter.dispose();
      host.remove();
      return { idle, deep, superficial, candidate, selected, cleared, deepShared, meshCount: meshes.length };
    }, mountArgs());
    console.log('     colours:', JSON.stringify(probe));
    if (probe.meshCount !== 2) return bad(`expected 2 meshes, got ${probe.meshCount}`);
    // Every descendant must take the entry's material, not keep its own.
    if (!probe.deepShared) return bad('descendant meshes do not share the entry material');
    // A muscle-layer entry stays visible at every depth, so only the
    // presentation transitions are expected to differ.
    if (probe.candidate === probe.superficial) return bad('candidate did not change the material');
    if (probe.selected === probe.candidate) return bad('selected did not change the material');
    if (probe.cleared !== probe.superficial) return bad('deselect did not restore the idle material');
    ok('candidate -> selected -> cleared all reached the loaded material');
  });

  await check('camera framing is derived from the loaded bounds, not fixture constants', async () => {
    // Measure the loaded graph twice over: three's own Box3, and a fixed small
    // node instead of the Group. If framing used the node alone, or a manifest
    // constant, the two distances would not differ the way they do here.
    const probe = await page.evaluate(async (args) => {
      const { adapter, host } = await window.__mountUrl(args);
      const three = await import('/node_modules/three/build/three.module.js');
      adapter.focusCamera('anterior', { immediate: true });
      const camera = adapter.camera;
      const root = adapter.objects.get('asi:shoulder.deltoid');

      const boundsOf = (node) => {
        adapter.scene.updateMatrixWorld(true);
        const box = new three.Box3().setFromObject(node);
        const sphere = box.getBoundingSphere(new three.Sphere());
        const centre = box.getCenter(new three.Vector3());
        const distance = camera.position.distanceTo(centre);
        return {
          size: box.getSize(new three.Vector3()).toArray().map((n) => Number(n.toFixed(3))),
          radius: Number(sphere.radius.toFixed(3)),
          distance: Number(distance.toFixed(3)),
          outside: distance > sphere.radius,
        };
      };

      const whole = boundsOf(root);
      const singleNode = boundsOf(root.getObjectByName('fixture_lower'));
      adapter.dispose();
      host.remove();
      return { whole, singleNode };
    }, mountArgs());
    console.log('     framing:', JSON.stringify(probe));
    // The fixture's real union extent is 2.25 x 1.5 x 0.75. No manifest
    // constant contains that, so a hardcoded framing distance cannot produce it.
    if (Math.abs(probe.whole.size[0] - 2.25) > 0.05)
      return bad(`unexpected loaded extent ${probe.whole.size}`);
    if (!probe.whole.outside) return bad('camera is inside the loaded geometry');
    ok(`framed at ${probe.whole.distance} from a loaded radius of ${probe.whole.radius}`);
  });

  /**
   * Framing must follow the entry that is actually bound.
   *
   * Two mounts from the SAME file: one binds the whole graph, one binds a single
   * small node. The loaded extents differ, so the framing distances must differ.
   * A camera distance derived from a manifest constant or a hardcoded primitive
   * radius would be identical for both, which is exactly what this rules out.
   */
  await check('framing one node differs from framing the whole loaded graph', async () => {
    const frame = async (options) =>
      page.evaluate(async (args) => {
        const { adapter, host } = await window.__mountUrl(args);
        const three = await import('/node_modules/three/build/three.module.js');
        adapter.focusCamera('anterior', { immediate: true });
        adapter.scene.updateMatrixWorld(true);
        const root = adapter.objects.get('asi:shoulder.deltoid');
        const box = new three.Box3().setFromObject(root);
        const sphere = box.getBoundingSphere(new three.Sphere());
        const distance = adapter.camera.position.distanceTo(sphere.center);
        const size = box.getSize(new three.Vector3()).toArray().map((n) => Number(n.toFixed(3)));
        adapter.dispose();
        host.remove();
        return { size, radius: Number(sphere.radius.toFixed(3)), distance: Number(distance.toFixed(3)) };
      }, options);

    const whole = await frame(mountArgs());
    const single = await frame(mountArgs({ nodeName: 'fixture_lower' }));
    console.log('     whole graph:', JSON.stringify(whole));
    console.log('     single node:', JSON.stringify(single));
    // The lower quad alone is 1 x 1 x 0; the whole graph is 2.25 x 1.5 x 0.75.
    if (Math.abs(single.size[0] - 1) > 0.05) return bad(`node extent looks wrong: ${single.size}`);
    if (Math.abs(whole.size[0] - 2.25) > 0.05) return bad(`graph extent looks wrong: ${whole.size}`);
    if (Math.abs(whole.distance - single.distance) < 0.05)
      return bad(
        `framing ignored the loaded extent: graph ${whole.distance} vs node ${single.distance}`,
      );
    ok(`graph ${whole.distance} vs node ${single.distance}`);
  });

  await check('a 404 asset falls back to 2D instead of showing a blank 3D view', async () => {
    const probe = await page.evaluate(async () => {
      const { AnatomyWorkspace } = await import('/src/anatomy/workspace.ts');
      const { Svg2dAnatomyAdapter } = await import('/src/anatomy/svg2d.ts');
      const host = document.createElement('div');
      document.body.appendChild(host);
      const workspace = new AnatomyWorkspace(new Svg2dAnatomyAdapter(), {
        manifest: {
          version: 'missing-asset-test',
          source: 'fixture',
          disclaimer: 'Test fixture. Not anatomy.',
          externalAssetNotice: 'Deliberately missing asset.',
          bounds: { height: 2, radius: 1 },
          entries: [
            {
              asiId: 'asi:shoulder.deltoid',
              kind: 'structure',
              region: 'shoulder',
              subRegionIds: ['shoulder.anterior', 'shoulder.lateral'],
              structureId: 'shoulder.deltoid',
              layer: 'muscle',
              views: ['anterior'],
              geometry: { type: 'url', url: '/fixtures/does-not-exist.glb' },
            },
          ],
        },
      });
      const status = await workspace.start(host);
      const result = {
        mode: status.mode,
        ready: status.ready,
        reason: status.fallbackReason,
        message: status.message,
        canvases: host.querySelectorAll('canvas').length,
      };
      workspace.dispose();
      host.remove();
      return result;
    });
    console.log('     fallback:', JSON.stringify(probe));
    if (probe.mode !== '2d') return bad(`mode is ${probe.mode}, expected 2d`);
    if (!probe.reason) return bad('no fallback reason recorded');
    if (!probe.message) return bad('no message explaining the fallback');
    if (probe.canvases !== 0) return bad(`a failed 3D attempt left ${probe.canvases} canvas in the host`);
    ok(`fell back with reason "${probe.reason}"`);
  });

  await check('dispose mid-fetch leaves no canvas, scene object or frame', async () => {
    const probe = await page.evaluate(async () => {
      const { Three3dAnatomyAdapter } = await import('/src/anatomy/three3d.ts');
      const host = document.createElement('div');
      document.body.appendChild(host);
      const manifest = {
        version: 'dispose-race',
        source: 'fixture',
        disclaimer: 'Test fixture. Not anatomy.',
        externalAssetNotice: 'Non-medical fixture.',
        bounds: { height: 2, radius: 1 },
        entries: [
          {
            asiId: 'asi:shoulder.deltoid',
            kind: 'structure',
            region: 'shoulder',
            subRegionIds: ['shoulder.anterior', 'shoulder.lateral'],
            structureId: 'shoulder.deltoid',
            layer: 'muscle',
            views: ['anterior'],
            geometry: { type: 'url', url: '/fixtures/non-medical-two-quads.glb' },
          },
        ],
      };
      const adapter = new Three3dAnatomyAdapter({
        manifest,
        // Slow transport, so dispose is guaranteed to land mid-load.
        loadGlb: async (u) => {
          await new Promise((r) => setTimeout(r, 400));
          const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
          const gltf = await new GLTFLoader().loadAsync(u);
          return { scene: gltf.scene };
        },
      });
      const mounting = adapter.mount(host);
      await new Promise((r) => setTimeout(r, 60));
      // React unmounts here, while the fetch is still in flight.
      adapter.dispose();
      let rejected = false;
      try {
        await mounting;
      } catch {
        rejected = true;
      }
      // A later tick would let any late callback run and re-attach anything.
      await new Promise((r) => setTimeout(r, 600));
      const result = {
        rejected,
        live: adapter.isLive(),
        canvases: host.querySelectorAll('canvas').length,
        objects: adapter.objects.size,
        cache: adapter.glbCache.size,
        frame: adapter.frame,
      };
      host.remove();
      return result;
    });
    console.log('     dispose race:', JSON.stringify(probe));
    if (!probe.rejected) return bad('mount() resolved after dispose');
    if (probe.live) return bad('viewer still reports itself live after dispose');
    if (probe.canvases !== 0) return bad(`a canvas survived dispose (${probe.canvases})`);
    if (probe.objects !== 0) return bad(`${probe.objects} scene objects were adopted after dispose`);
    if (probe.cache !== 0) return bad('a resolved asset stayed in the cache after dispose');
    if (probe.frame) return bad('an animation frame survived dispose');
    ok('no canvas, object, cache entry or frame survived');
  });

  await check('screenshot: URL geometry rendering', async () => {
    await page.evaluate(async (args) => {
      const { adapter, host } = await window.__mountUrl(args);
      adapter.apply({ type: 'setDepth', depth: 'deep' });
      adapter.apply({ type: 'setHighlighted', structureIds: ['shoulder.deltoid'] });
      window.__keep = { adapter, host };
    }, mountArgs());
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/url-geometry-loaded.png`, fullPage: false });
    await page.evaluate(() => {
      window.__keep?.adapter.dispose();
      window.__keep?.host.remove();
      window.__keep = undefined;
    });
  });

  await check('no page errors during the URL geometry run', async () => {
    if (errors.length) bad(`page errors: ${errors.join(' | ')}`);
    else ok('no page errors');
  });
} catch (cause) {
  bad(`threw: ${cause && cause.message ? cause.message : cause}`);
}

console.log(`\n${problems.length ? `PROBLEMS: ${problems.length}` : 'all URL geometry checks passed'}`);
await browser.close();
process.exit(problems.length ? 1 : 0);