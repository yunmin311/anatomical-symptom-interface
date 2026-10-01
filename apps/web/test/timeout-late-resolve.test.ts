/**
 * Timeout THEN late resolve — the case the existing test did not cover.
 *
 * The old test disposed the viewer and THEN resolved the loader. That proves
 * dispose-while-pending releases the asset. It says nothing about the case the
 * leak was actually in, where the viewer had ALREADY given up on the asset
 * before it arrived:
 *
 *   1. mount() starts loading a GLB
 *   2. the deadline passes, withTimeout rejects, the viewer falls back to 2D
 *   3. the workspace disposes the 3D viewer
 *   4. the loader resolves LATER, with a real scene and real geometry buffers
 *
 * Between 2 and 4 the code deleted the url from `glbCache` so the next mount
 * would retry. That delete was the only reference to the in-flight loader
 * promise. dispose() released assets by walking `glbCache`, found nothing, and
 * the scene that arrived at step 4 was allocated, unreachable, and never freed.
 * It stayed that way for the life of the page.
 *
 * So the test asserts on the viewer's OWN resource accounting rather than on
 * what a cache happens to contain, and it covers the retry too, because a retry
 * creates a second live promise and the first one is then genuinely orphaned.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  Three3dAnatomyAdapter,
} from '../src/anatomy/three3d.ts';
import type {
  Three3dOptions,
  GlbLoader,
  RendererResources,
} from '../src/anatomy/three3d.ts';
import { AnatomyWorkspace } from '../src/anatomy/workspace.ts';
import { Svg2dAnatomyAdapter } from '../src/anatomy/svg2d.ts';
import type { RendererSceneEntry, RendererSceneManifest } from '../src/anatomy/scene-manifest.ts';
import { buildFixtureGlb } from './fixtures/make-fixture-glb.mjs';

/* ---------- the same fake DOM the existing url-geometry tests use ---------- */

class FakeElement {
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  clientWidth = 800;
  clientHeight = 600;
  style: Record<string, string> = {};
  private listeners = new Map<string, ((event: unknown) => void)[]>();
  appendChild(child: FakeElement): void {
    child.parentNode = this;
    this.children.push(child);
  }
  removeChild(child: FakeElement): void {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  addEventListener(type: string, fn: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((f) => f !== fn));
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
  }
  setAttribute(): void {}
  focus(): void {}
}

const fakeRendererFactory = () =>
  ({
    domElement: new FakeElement(),
    setSize() {},
    setPixelRatio() {},
    setClearColor() {},
    render() {},
    dispose() {},
    getContext: () => ({}),
  }) as unknown as THREE.WebGLRenderer;

/**
 * A LIVE count of dispose() calls on every geometry in a scene graph.
 *
 * The counter has to be an object the listener mutates, not a number captured at
 * the end of a counting pass. Returning `{ disposed }` as a plain value looks
 * like it works and silently reports zero forever, which for a leak test is the
 * worst possible failure: it passes on a leak and fails on a fix.
 */
function countGeometries(root: THREE.Object3D): { total: number; disposed: number } {
  const counter = { total: 0, disposed: 0 };
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.geometry) return;
    counter.total += 1;
    mesh.geometry.addEventListener('dispose', () => {
      counter.disposed += 1;
    });
  });
  return counter;
}

/**
 * Decode the fixture GLB AND arm the counters, before the loader returns it.
 *
 * The counters must be attached while the scene is still alive and before
 * anything can release it. Arming them after the fact would report zero releases
 * for a leak that happened, which is the one answer a leak test must never give.
 */
function trackedGlb(): {
  load: GlbLoader;
  scenes: Array<{ total: number; disposed: number }>;
} {
  const scenes: Array<{ total: number; disposed: number }> = [];
  const load: GlbLoader = async (url) => {
    const buffer = buildFixtureGlb();
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
      new GLTFLoader().parse(buffer, '', resolve, reject);
    });
    scenes.push(countGeometries(gltf.scene));
    return { scene: gltf.scene };
  };
  return { load, scenes };
}

const SCENE: RendererSceneManifest = {
  version: 'timeout-late-resolve',
  source: 'fixture',
  disclaimer: 'Test fixture. Not anatomy.',
  externalAssetNotice: 'Test fixture geometry. Not anatomy, not derived from a body.',
  attribution: null,
  bounds: { height: 2, radius: 1 },
  entries: [
    {
      asiId: 'asi:shoulder.deltoid',
      kind: 'structure',
      region: 'shoulder',
      subRegionIds: ['shoulder.anterior', 'shoulder.lateral'],
      structureId: 'shoulder.deltoid',
      layer: 'muscle',
      views: ['anterior', 'posterior', 'lateral_left', 'lateral_right'],
      geometry: { type: 'url', url: '/fixtures/late.glb' },
    } as RendererSceneEntry,
  ],
};

function adapterWith(over: Partial<Three3dOptions> = {}): Three3dAnatomyAdapter {
  return new Three3dAnatomyAdapter({
    manifest: SCENE,
    rendererFactory: fakeRendererFactory as unknown as (host: HTMLElement) => THREE.WebGLRenderer,
    ...over,
  });
}

/* ================================================================== */
test('timeout, THEN late resolve: the late scene is released, not just unowned', async () => {
  const tracked = trackedGlb();
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slowLoader: GlbLoader = async (url) => {
    await gate;
    return tracked.load(url);
  };

  const adapter = adapterWith({ loadGlb: slowLoader, assetTimeoutMs: 25 });
  const host = new FakeElement();

  // 1-2. mount misses the deadline and the workspace falls back to 2D. The whole
  // path runs through the workspace rather than by hand, because a hand-written
  // version would not have disposed the viewer the way React unmount does.
  const workspace = new AnatomyWorkspace(new Svg2dAnatomyAdapter(), {
    manifest: SCENE,
    createViewer: async () => adapter,
  });
  const status = await workspace.start(host as unknown as HTMLElement);

  assert.equal(status.mode, '2d', 'a timed-out asset should have fallen back to 2D');
  assert.equal(status.rendered, false);
  assert.ok(status.fallbackReason, 'no fallback reason recorded');

  // 3. The workspace disposed the failed viewer on the way to 2D.
  const afterDispose = adapter.resources();
  assert.deepEqual(afterDispose, {
    outstandingAssets: 0,
    cacheEntries: 0,
    sceneObjects: 0,
    sceneNodes: 0,
    canvasAttached: false,
    frameHandle: 0,
  });

  // 4. The loader answers now — after the deadline, and after dispose. This is
  // the whole point: nobody is awaiting this promise any more.
  release?.();
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(tracked.scenes.length, 1, 'the late loader never produced a scene');
  const counted = tracked.scenes[0]!;
  assert.ok(counted.total >= 2, `expected the fixture's geometries, saw ${counted.total}`);
  assert.equal(
    counted.disposed,
    counted.total,
    `${counted.total - counted.disposed} of ${counted.total} geometries from the late resolve were never released`,
  );
  workspace.dispose();
});

test('a timed-out url leaves the sharing index but KEEPS ownership of the load', async () => {
  const tracked = trackedGlb();
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slowLoader: GlbLoader = async (url) => {
    await gate;
    return tracked.load(url);
  };

  const adapter = adapterWith({ loadGlb: slowLoader, assetTimeoutMs: 25 });
  await assert.rejects(
    () => adapter.mount(new FakeElement() as unknown as HTMLElement),
    /timed out/,
  );

  // Still owned — this is the property the old code lost — but no longer cached.
  // If ownership were keyed by url, deleting the url would have released it.
  const timedOut = adapter.resources();
  assert.equal(timedOut.outstandingAssets, 1, 'the timed-out load stopped being owned');
  assert.equal(timedOut.cacheEntries, 0, 'a timed-out url stayed in the sharing index');

  adapter.dispose();
  release?.();
  await new Promise((r) => setTimeout(r, 80));

  assert.deepEqual(adapter.resources(), {
    outstandingAssets: 0,
    cacheEntries: 0,
    sceneObjects: 0,
    sceneNodes: 0,
    canvasAttached: false,
    frameHandle: 0,
  });
  const counted = tracked.scenes[0]!;
  assert.equal(
    counted.disposed,
    counted.total,
    'a dispose that cleared ownership still left the late geometry behind',
  );
});

test('a retry after a timeout gets a fresh load, and the FIRST late scene is still released', async () => {
  const tracked = trackedGlb();
  let attempt = 0;
  let releaseFirst: (() => void) | null = null;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  // Labelled, because "which scene is which" is exactly what this test is about
  // and positional indexing is how it gets confused: the RETRY answers first, so
  // the adopted scene is pushed before the late one.
  const byLabel = new Map<string, { total: number; disposed: number }>();
  const loader: GlbLoader = async (url) => {
    attempt += 1;
    const label = attempt === 1 ? 'orphan' : 'retry';
    if (attempt === 1) await firstGate;
    const result = await tracked.load(url);
    byLabel.set(label, tracked.scenes[tracked.scenes.length - 1]!);
    return result;
  };

  const adapter = adapterWith({ loadGlb: loader, assetTimeoutMs: 25 });
  await assert.rejects(
    () => adapter.mount(new FakeElement() as unknown as HTMLElement),
    /timed out/,
  );

  // Retry. A new load is written under the same url, so a map keyed by url would
  // have pushed the first load out of reach entirely.
  await adapter.mount(new FakeElement() as unknown as HTMLElement);
  assert.equal(attempt, 2, 'the retry did not start a fresh load');
  const live = adapter.resources();
  assert.equal(live.cacheEntries, 1, 'the retry did not populate the sharing index');
  assert.equal(live.sceneObjects, 1, 'the retry did not adopt its asset');

  // Now the FIRST load answers, long after anyone stopped listening for it.
  releaseFirst?.();
  await new Promise((r) => setTimeout(r, 80));

  const orphan = byLabel.get('orphan')!;
  const onScreen = byLabel.get('retry')!;
  assert.equal(
    orphan.disposed,
    orphan.total,
    'the orphaned first load kept its geometry after a successful retry',
  );
  assert.equal(
    onScreen.disposed,
    0,
    'the adopted retry geometry was released underneath the live scene',
  );

  adapter.dispose();
  assert.equal(adapter.resources().outstandingAssets, 0);
  assert.equal(
    onScreen.disposed,
    onScreen.total,
    'dispose did not release the adopted retry geometry exactly once',
  );
});

test('an adopted asset survives, and is released exactly once at dispose', async () => {
  const tracked = trackedGlb();
  const adapter = adapterWith({ loadGlb: tracked.load });
  await adapter.mount(new FakeElement() as unknown as HTMLElement);

  const counted = tracked.scenes[0]!;
  assert.equal(
    counted.disposed,
    0,
    'an asset adopted into a live scene was released underneath it',
  );
  assert.equal(adapter.resources().sceneObjects, 1);

  adapter.dispose();
  assert.equal(
    counted.disposed,
    counted.total,
    'dispose did not release the adopted asset exactly once',
  );
  assert.equal(adapter.resources().outstandingAssets, 0);
});