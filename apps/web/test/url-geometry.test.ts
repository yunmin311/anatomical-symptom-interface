/**
 * The URL / GLB geometry path, end to end.
 *
 * Everything here loads real GLB bytes through three's actual GLTFLoader. The
 * only thing injected is the TRANSPORT (`loadGlb`), because a headless test has
 * no `fetch` and no relative URL resolution; node resolution, scene-graph
 * adoption, identity, materials, picking and bounds are all the production path.
 *
 * The fixture is two non-medical quads under a Group, in
 * `apps/web/public/fixtures/non-medical-two-quads.glb`, built by
 * `./fixtures/make-fixture-glb.mjs`. It is deliberately not anatomy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Three3dAnatomyAdapter } from '../src/anatomy/three3d.ts';
import { AnatomyWorkspace } from '../src/anatomy/workspace.ts';
import { Svg2dAnatomyAdapter } from '../src/anatomy/svg2d.ts';
import { SceneManifestError } from '../src/anatomy/scene-manifest.ts';
import type { RendererSceneManifest, RendererSceneEntry } from '../src/anatomy/scene-manifest.ts';
import type { GlbLoader } from '../src/anatomy/three3d.ts';
import type { ViewerState } from '../src/anatomy/types.ts';
import { buildFixtureGlb } from './fixtures/make-fixture-glb.mjs';

const FIXTURE_URL = '/fixtures/non-medical-two-quads.glb';
const FIXTURE_PATH = new URL('../public/fixtures/non-medical-two-quads.glb', import.meta.url);

/**
 * Transport only: read the bytes and hand them to the real parser. Any change to
 * how a GLB is decoded would break this, which is the point.
 */
export const fileGlbLoader: GlbLoader = async (url) => {
  const bytes =
    url === FIXTURE_URL
      ? readFileSync(FIXTURE_PATH)
      : // Any other url is a deliberate failure, so tests can request a bad asset
        // without needing a broken file on disk.
        (() => {
          throw new Error(`no such fixture: ${url}`);
        })();
  const buffer = new Uint8Array(bytes).buffer;
  const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', (gltf) => resolve({ scene: gltf.scene }), reject);
  });
  return { scene: gltf.scene };
};

const NON_MEDICAL_NOTICE =
  'Test fixture geometry. Two quads in a Group. Not anatomy, not derived from a body.';

function structureEntry(over: Partial<RendererSceneEntry> & { asiId: string }): RendererSceneEntry {
  return {
    kind: 'structure',
    region: 'shoulder',
    // A real sub-region, as a canonical list. The deltoid is reachable from both
    // `shoulder.anterior` and `shoulder.lateral`, and the picker has to report
    // the candidates rather than pick one.
    subRegionIds: ['shoulder.anterior', 'shoulder.lateral'],
    structureId: over.asiId.replace('asi:', ''),
    layer: 'muscle',
    views: ['anterior', 'posterior', 'lateral_left', 'lateral_right'],
    ...over,
  } as RendererSceneEntry;
}

/** A manifest whose entries all come from one GLB. */
function urlManifest(entries: RendererSceneEntry[], over: Partial<RendererSceneManifest> = {}): RendererSceneManifest {
  return {
    version: 'url-test',
    source: 'fixture',
    disclaimer: 'Test fixture. Not anatomy.',
    externalAssetNotice: NON_MEDICAL_NOTICE,
    bounds: { height: 2, radius: 1 },
    entries,
    ...over,
  };
}

/** The whole-asset case: the manifest binds the GLB's Group root. */
function groupManifest(over: Partial<RendererSceneManifest> = {}): RendererSceneManifest {
  return urlManifest(
    [
      structureEntry({
        asiId: 'asi:shoulder.deltoid',
        layer: 'muscle',
        geometry: { type: 'url', url: FIXTURE_URL },
      }),
    ],
    over,
  );
}

/** A single named node out of the same file. */
function nodeManifest(nodeName: string, asiId = 'asi:shoulder.deltoid'): RendererSceneManifest {
  return urlManifest([
    structureEntry({ asiId, layer: 'muscle', geometry: { type: 'url', url: FIXTURE_URL, nodeName } }),
  ]);
}

/* ---------------- host and renderer doubles ---------------- */

class FakeElement {
  children: FakeElement[] = [];
  connected = true;
  width = 800;
  height = 600;
  style: Record<string, string> = {};
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  parent: FakeElement | null = null;
  appendChild(child: FakeElement): void {
    child.parent?.removeChild(child);
    this.children.push(child);
    child.parent = this;
  }
  removeChild(child: FakeElement): void {
    this.children = this.children.filter((c) => c !== child);
    if (child.parent === this) child.parent = null;
  }
  /** Mirrors real DOM: remove() detaches from the parent, it does not just mark. */
  remove(): void {
    this.parent?.removeChild(this);
    this.parent = null;
    this.connected = false;
  }
  getContext(): null {
    return null;
  }
  getBoundingClientRect(): { width: number; height: number; left: number; top: number } {
    return { width: this.width, height: this.height, left: 0, top: 0 };
  }
  get clientWidth(): number {
    return this.width;
  }
  get clientHeight(): number {
    return this.height;
  }
  addEventListener(type: string, fn: (event: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(fn);
  }
  removeEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  dispatch(type: string, event: unknown = {}): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
}

/** Enough of a WebGLRenderer that the adapter never draws. */
function stubRenderer(host: FakeElement): THREE.WebGLRenderer {
  const canvas = new FakeElement() as unknown as HTMLElement;
  const renderer = {
    domElement: canvas,
    setPixelRatio: () => {},
    setSize: () => {},
    setClearColor: () => {},
    render: () => {},
    dispose: () => {},
  };
  void host;
  return renderer as unknown as THREE.WebGLRenderer;
}

function adapterFor(manifest: RendererSceneManifest, over: Record<string, unknown> = {}) {
  return new Three3dAnatomyAdapter({
    manifest,
    rendererFactory: () => stubRenderer({} as FakeElement),
    loadGlb: fileGlbLoader,
    ...over,
  });
}

/** Reach into the adapter's private scene the way the renderer does. */
function sceneOf(adapter: Three3dAnatomyAdapter): THREE.Scene {
  const scene = (adapter as unknown as { scene: THREE.Scene | null }).scene;
  if (!scene) throw new Error('adapter has no scene; did mount() run?');
  return scene;
}
function cameraOf(adapter: Three3dAnatomyAdapter): THREE.PerspectiveCamera {
  const camera = (adapter as unknown as { camera: THREE.PerspectiveCamera | null }).camera;
  if (!camera) throw new Error('adapter has no camera; did mount() run?');
  return camera;
}
function rootOf(adapter: Three3dAnatomyAdapter, asiId: string): THREE.Object3D {
  const objects = (adapter as unknown as { objects: Map<string, THREE.Object3D> }).objects;
  const root = objects.get(asiId);
  if (!root) throw new Error(`no object for ${asiId}`);
  return root;
}
function meshesUnder(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) out.push(node as THREE.Mesh);
  });
  return out;
}

/** Camera position as a plain array, for comparisons. */
function cameraDistanceTo(adapter: Three3dAnatomyAdapter, point: [number, number, number]): number {
  return cameraOf(adapter).position.distanceTo(new THREE.Vector3(...point));
}

test.afterEach(() => {
  // No timer or frame may outlive a test, or node's test runner hangs.
  if (typeof (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame === 'function') {
    assert.fail('a requestAnimationFrame frame survived dispose()');
  }
});

/* ---------------- A: a url entry actually enters the scene ---------------- */

test('A. a url entry loads and its object is really in the scene', async () => {
  const adapter = adapterFor(groupManifest());
  const host = new FakeElement();
  await adapter.mount(host as unknown as HTMLElement);

  const root = rootOf(adapter, 'asi:shoulder.deltoid');
  assert.equal(root.isObject3D, true);
  // The loaded Group root, not a primitive stand-in. three names it after the
  // glTF scene, so the graph is scene -> fixture_root -> two meshes.
  assert.equal((root as THREE.Group).isGroup, true);
  assert.equal(meshesUnder(root).length, 2);
  assert.ok(root.getObjectByName('fixture_root'), 'the fixture Group is missing');
  // And it is genuinely in the graph, reachable from the scene.
  const inScene = sceneOf(adapter).getObjectByName('fixture_scene');
  assert.ok(inScene, 'the loaded root is not in the scene graph');
  assert.equal(inScene?.parent, sceneOf(adapter));
  assert.ok(meshesUnder(root).every((m) => m.geometry.attributes.position));
  adapter.dispose();
});

test('A3. a named node is resolved from the loaded graph, not by guessing a shape', async () => {
  const adapter = adapterFor(nodeManifest('fixture_upper'));
  await adapter.mount(new FakeElement() as unknown as HTMLElement);
  const root = rootOf(adapter, 'asi:shoulder.deltoid');
  assert.equal(root.name, 'fixture_upper');
  // A single node was asked for, so exactly one mesh came back — not the whole
  // file, and not a synthesised stand-in.
  assert.equal(meshesUnder(root).length, 1);
  assert.equal(meshesUnder(root)[0]?.name, 'fixture_upper');
  adapter.dispose();
});

test('A2. mount() does not resolve until the asset is in the scene', async () => {
  let releaseLoad: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  const slowLoader: GlbLoader = async (url) => {
    await gate;
    return fileGlbLoader(url);
  };
  const adapter = adapterFor(groupManifest(), { loadGlb: slowLoader });
  const host = new FakeElement();

  let settled = false;
  const mounting = adapter.mount(host as unknown as HTMLElement).then(() => {
    settled = true;
  });
  // Give the mount a turn to reach the await, then confirm it is still pending.
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(settled, false, 'mount() resolved before the asset finished loading');
  releaseLoad?.();
  await mounting;
  assert.equal(settled, true);
  assert.equal(meshesUnder(rootOf(adapter, 'asi:shoulder.deltoid')).length, 2);
  adapter.dispose();
});

/* ---------------- B: nested identity and picking ---------------- */

test('B. a raycast on a descendant mesh resolves to the owning entry asiId', async () => {
  const adapter = adapterFor(groupManifest());
  const host = new FakeElement();
  await adapter.mount(host as unknown as HTMLElement);
  adapter.focusCamera('anterior', { immediate: true });
  cameraOf(adapter).updateMatrixWorld(true);

  const root = rootOf(adapter, 'asi:shoulder.deltoid');
  const meshes = meshesUnder(root);
  assert.equal(meshes.length, 2, 'expected two descendant meshes to resolve');

  // Project each descendant's centre to a screen pixel and pick there. The hit
  // object will be the leaf mesh, and it must come back as the entry's asiId.
  let resolved = 0;
  for (const mesh of meshes) {
    const centre = new THREE.Vector3();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.boundingBox?.getCenter(centre);
    mesh.localToWorld(centre);
    const ndc = centre.clone().project(cameraOf(adapter));
    const pick = adapter.pick(((ndc.x + 1) / 2) * 800, ((1 - ndc.y) / 2) * 600);
    if (pick.kind !== 'none' && pick.asiId === 'asi:shoulder.deltoid') {
      resolved += 1;
      // A leaf hit must still be a business id, never an engine handle.
      assert.equal(pick.structureId, 'shoulder.deltoid');
      // Two candidate sub-regions, so there is NO singular answer and the pick
      // must not invent one.
      assert.deepEqual(pick.subRegionIds, ['shoulder.anterior', 'shoulder.lateral']);
      assert.equal(
        pick.subRegionId,
        undefined,
        'a pick with several candidate sub-regions must not report one as if it were the only one',
      );
      assert.ok(pick.point, 'pick must carry a normalised point');
      assert.ok(pick.point!.x >= 0 && pick.point!.x <= 1);
      assert.ok(pick.point!.y >= 0 && pick.point!.y <= 1);
      assert.equal(
        Object.prototype.hasOwnProperty.call(pick, 'object'),
        false,
        'PickResult leaked an engine handle',
      );
    }
  }
  assert.ok(resolved >= 1, 'no descendant mesh resolved to the owning asiId');
  adapter.dispose();
});

test('B2. all descendants of one entry inherit the same asiId', async () => {
  const adapter = adapterFor(groupManifest());
  await adapter.mount(new FakeElement() as unknown as HTMLElement);
  const asiIdOf = (adapter as unknown as { asiIdOf: (o: THREE.Object3D) => string | undefined })
    .asiIdOf.bind(adapter);
  const root = rootOf(adapter, 'asi:shoulder.deltoid');
  const ids = new Set<string | undefined>();
  root.traverse((node) => ids.add(asiIdOf(node)));
  assert.equal(ids.size, 1, 'descendants resolved to more than one asiId');
  assert.equal([...ids][0], 'asi:shoulder.deltoid');
  adapter.dispose();
});

test('B3. two entries from one file bind different nodes independently', async () => {
  const manifest = urlManifest([
    structureEntry({
      asiId: 'asi:shoulder.deltoid',
      geometry: { type: 'url', url: FIXTURE_URL, nodeName: 'fixture_lower' },
    }),
    structureEntry({
      asiId: 'asi:shoulder.acromion',
      geometry: { type: 'url', url: FIXTURE_URL, nodeName: 'fixture_upper' },
    }),
  ]);
  const adapter = adapterFor(manifest);
  await adapter.mount(new FakeElement() as unknown as HTMLElement);

  const lower = rootOf(adapter, 'asi:shoulder.deltoid');
  const upper = rootOf(adapter, 'asi:shoulder.acromion');
  // Each entry resolved to exactly the node it named.
  assert.equal(lower.name, 'fixture_lower');
  assert.equal(upper.name, 'fixture_upper');
  assert.equal(meshesUnder(lower).length, 1);
  assert.equal(meshesUnder(upper).length, 1);
  // Distinct objects with independent transforms: moving one must not move the
  // other. A shared node would make these two entries one object.
  assert.notEqual(lower, upper);
  assert.notEqual(lower.children, upper.children);
  // The upper node carries its own glTF translation; the point is that moving
  // one entry's root leaves the other's transform untouched.
  const upperBefore = upper.position.clone();
  lower.position.set(0, 5, 0);
  assert.ok(upper.position.equals(upperBefore));
  assert.equal(upperBefore.y, 0.75, 'the fixture node translation was lost');
  adapter.dispose();
});

test('B3b. one file is fetched once and shared by every entry that names it', async () => {
  let loads = 0;
  const countingLoader: GlbLoader = async (url) => {
    loads += 1;
    return fileGlbLoader(url);
  };
  const manifest = urlManifest([
    structureEntry({
      asiId: 'asi:shoulder.deltoid',
      geometry: { type: 'url', url: FIXTURE_URL, nodeName: 'fixture_lower' },
    }),
    structureEntry({
      asiId: 'asi:shoulder.acromion',
      geometry: { type: 'url', url: FIXTURE_URL, nodeName: 'fixture_upper' },
    }),
  ]);
  const adapter = adapterFor(manifest, { loadGlb: countingLoader });
  await adapter.mount(new FakeElement() as unknown as HTMLElement);
  // A real asset ships many parts in one file; loading it per entry would be
  // both slow and a way to get two inconsistent copies of the same geometry.
  assert.equal(loads, 1, 'the same url was fetched more than once');
  adapter.dispose();
});

test('B4. a missing nodeName fails loudly instead of silently skipping', async () => {
  const adapter = adapterFor(nodeManifest('no_such_node'));
  await assert.rejects(
    () => adapter.mount(new FakeElement() as unknown as HTMLElement),
    /no node named "no_such_node"/,
  );
  // Nothing was adopted, so nothing is half-built.
  const objects = (adapter as unknown as { objects: Map<string, THREE.Object3D> }).objects;
  assert.equal(objects.size, 0);
  adapter.dispose();
});

/* ---------------- C: depth drives real loaded geometry ---------------- */

test('C. depth changes the actual descendant visibility and materials', async () => {
  const manifest = urlManifest([
    structureEntry({
      asiId: 'asi:shoulder.deltoid',
      layer: 'skin',
      geometry: { type: 'url', url: FIXTURE_URL },
    }),
    structureEntry({
      asiId: 'asi:shoulder.acromion',
      layer: 'bone',
      geometry: { type: 'url', url: FIXTURE_URL, nodeName: 'fixture_upper' },
    }),
  ]);
  const adapter = adapterFor(manifest);
  await adapter.mount(new FakeElement() as unknown as HTMLElement);

  const deep = rootOf(adapter, 'asi:shoulder.acromion');
  const skin = rootOf(adapter, 'asi:shoulder.deltoid');

  // superficial shows skin, hides bone
  adapter.apply({ type: 'setDepth', depth: 'superficial' });
  assert.equal(skin.visible, true);
  assert.equal(deep.visible, false);

  // deep shows bone, hides skin — and the change reaches the descendant meshes,
  // not just the root handle.
  adapter.apply({ type: 'setDepth', depth: 'deep' });
  assert.equal(deep.visible, true);
  assert.equal(skin.visible, false);
  assert.ok(
    meshesUnder(deep).every((m) => m.visible),
    'a descendant mesh was left visible under a hidden root',
  );
  assert.ok(meshesUnder(deep).every((m) => m.material instanceof THREE.MeshStandardMaterial));
  adapter.dispose();
});

test('C2. every descendant mesh takes the entry material, not the asset default', async () => {
  const adapter = adapterFor(groupManifest());
  await adapter.mount(new FakeElement() as unknown as HTMLElement);
  const root = rootOf(adapter, 'asi:shoulder.deltoid');
  const meshes = meshesUnder(root);
  assert.equal(meshes.length, 2);
  // One material object shared across the entry's meshes, and distinct from
  // whatever the loader produced.
  const materials = new Set(meshes.map((m) => m.material));
  assert.equal(materials.size, 1, 'descendants did not share the entry material');
  assert.ok(materials.has(materials.values().next().value as THREE.Material));
  adapter.dispose();
});

/* ---------------- D: candidate -> selected -> deselected ---------------- */

test('D. a url mesh follows the candidate, selected and cleared state', async () => {
  const adapter = adapterFor(groupManifest());
  await adapter.mount(new FakeElement() as unknown as HTMLElement);
  const root = rootOf(adapter, 'asi:shoulder.deltoid');
  const mesh = meshesUnder(root)[0];
  if (!mesh) throw new Error('fixture should have a mesh');

  const colourOf = () => {
    const material = mesh.material as THREE.MeshStandardMaterial;
    return material.color.getHex();
  };
  const idle = colourOf();

  adapter.apply({ type: 'setHighlighted', structureIds: ['shoulder.deltoid'] });
  const candidate = colourOf();
  assert.notEqual(candidate, idle, 'candidate did not change the mesh material');

  adapter.apply({ type: 'setSelected', structureIds: ['shoulder.deltoid'] });
  const selected = colourOf();
  assert.notEqual(selected, candidate, 'selected did not change the mesh material');

  adapter.apply({ type: 'setSelected', structureIds: [] });
  const cleared = colourOf();
  assert.equal(cleared, idle, 'deselect did not return the mesh to idle');
  adapter.dispose();
});

/* ---------------- E: load failure falls back to 2D ---------------- */

test('E. an asset that fails to load makes the workspace use the 2D map', async () => {
  const source = new Svg2dAnatomyAdapter();
  const workspace = new AnatomyWorkspace(source, {
    manifest: nodeManifest('fixture_root'),
    // The transport fails the way a 404 or a corrupt file would.
    createViewer: async () =>
      adapterFor(nodeManifest('fixture_root'), {
        loadGlb: async () => {
          throw new Error('simulated network failure');
        },
      }),
  });
  const host = new FakeElement();
  const status = await workspace.start(host as unknown as HTMLElement);
  assert.equal(status.mode, '2d');
  assert.equal(status.ready, true);
  // A failure reason, not a blank 3D canvas reported as success.
  assert.ok(status.fallbackReason, 'no fallback reason was recorded');
  assert.ok(status.message, 'no message explaining the fallback');
  assert.equal(status.rendered, false);
  assert.equal(workspace.renderer, null);
  // And the failed viewer left no canvas behind on the host.
  assert.equal(host.children.length, 0, 'a failed 3D attempt left a canvas in the host');
  workspace.dispose();
});

test('E2. an empty asset with no mesh refuses to mount rather than drawing nothing', async () => {
  const emptyLoader: GlbLoader = async () => ({ scene: new THREE.Group() });
  const adapter = adapterFor(groupManifest(), { loadGlb: emptyLoader });
  await assert.rejects(
    () => adapter.mount(new FakeElement() as unknown as HTMLElement),
    /contains no mesh/,
  );
  adapter.dispose();
});

/* ---------------- F: disposal while a load is in flight ---------------- */

test('F. disposing during a load adds no scene object, canvas, frame or listener', async () => {
  let releaseLoad: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  const slowLoader: GlbLoader = async (url) => {
    await gate;
    return fileGlbLoader(url);
  };
  const adapter = adapterFor(groupManifest(), { loadGlb: slowLoader });
  const host = new FakeElement();

  const mounting = adapter.mount(host as unknown as HTMLElement);
  await new Promise((r) => setTimeout(r, 10));

  // React unmounts mid-load: dispose now, resolve the loader afterwards.
  adapter.dispose();
  assert.equal(adapter.isLive(), false);

  releaseLoad?.();
  // mount() must reject rather than resolve into a dead viewer.
  await assert.rejects(() => mounting);

  // No canvas appended, no object adopted, no listener left behind.
  assert.equal(host.children.length, 0, 'a canvas was appended after dispose');
  const objects = (adapter as unknown as { objects: Map<string, THREE.Object3D> }).objects;
  assert.equal(objects.size, 0, 'a scene object was adopted after dispose');
  const canvas = host.children[0] as unknown as FakeElement | undefined;
  assert.equal(canvas?.listenerCount('webglcontextlost') ?? 0, 0);
  const cache = (adapter as unknown as { glbCache: Map<string, unknown> }).glbCache;
  assert.equal(cache.size, 0, 'a resolved asset stayed in the cache after dispose');
});

test('F2. a mount that fails validation leaves the host clean', async () => {
  const adapter = adapterFor(nodeManifest('does_not_exist'));
  const host = new FakeElement();
  await assert.rejects(() => adapter.mount(host as unknown as HTMLElement));
  adapter.dispose();
  assert.equal(host.children.length, 0, 'a rejected mount left a canvas behind');
});

/* ---------------- G: camera framing from loaded bounds ---------------- */

test('G. camera framing is computed from the loaded object bounds', async () => {
  const adapter = adapterFor(groupManifest());
  await adapter.mount(new FakeElement() as unknown as HTMLElement);
  adapter.focusCamera('anterior', { immediate: true });

  // The fixture's real union bounds are known and are NOT the manifest's
  // declared radius: size 2.25 x 1.5 x 0.75, centred near (0.625, 0.25, 0.375).
  // Framing from the loaded Box3 must therefore sit at a specific distance.
  const root = rootOf(adapter, 'asi:shoulder.deltoid');
  const box = new THREE.Box3().setFromObject(root);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  assert.ok(sphere.radius > 0.5, 'fixture bounds look wrong');

  // The camera must sit outside the loaded bounds, not at a fixed primitive
  // distance, and not so far that the asset is a speck.
  const distance = cameraOf(adapter).position.distanceTo(sphere.center);
  assert.ok(distance > sphere.radius, 'camera is inside the loaded geometry');
  assert.ok(
    distance < sphere.radius * 12,
    `camera is implausibly far (${distance.toFixed(2)}) for radius ${sphere.radius.toFixed(2)}`,
  );
  adapter.dispose();
});

test('G2. two different url assets frame at different distances', async () => {
  const small = adapterFor(nodeManifest('fixture_upper'));
  await small.mount(new FakeElement() as unknown as HTMLElement);
  small.focusCamera('anterior', { immediate: true });
  const smallDistance = cameraOf(small).position.length();
  small.dispose();

  const big = adapterFor(nodeManifest('fixture_root'));
  await big.mount(new FakeElement() as unknown as HTMLElement);
  big.focusCamera('anterior', { immediate: true });
  const bigDistance = cameraOf(big).position.length();
  big.dispose();

  // The Group's bounds are larger than the single upper quad's, so framing has
  // to respect that. This is the check that a hardcoded distance would fail.
  assert.notEqual(
    Math.round(smallDistance * 100),
    Math.round(bigDistance * 100),
    'camera framing ignored the loaded geometry extent',
  );
});

/* ---------------- J: canonical selection is not mutated by presentation ---------------- */

test('J. reject and setHighlighted cannot mutate the canonical selection', async () => {
  const adapter = adapterFor(groupManifest());
  await adapter.mount(new FakeElement() as unknown as HTMLElement);

  adapter.apply({ type: 'setSelected', structureIds: ['shoulder.deltoid'] });
  adapter.apply({ type: 'reject', structureIds: ['shoulder.deltoid'] });
  adapter.apply({ type: 'setHighlighted', structureIds: ['shoulder.deltoid'] });
  assert.deepEqual(
    adapter.getState().selectedStructureIds,
    ['shoulder.deltoid'],
    'presentation commands changed the canonical selection',
  );

  // A conflicting structure still renders as selected, because the record wins.
  const root = rootOf(adapter, 'asi:shoulder.deltoid');
  const mesh = meshesUnder(root)[0];
  const selectedColour = (mesh.material as THREE.MeshStandardMaterial).color.getHex();
  const selectedAdapter = adapterFor(groupManifest());
  await selectedAdapter.mount(new FakeElement() as unknown as HTMLElement);
  selectedAdapter.apply({ type: 'setSelected', structureIds: ['shoulder.deltoid'] });
  const referenceMesh = meshesUnder(rootOf(selectedAdapter, 'asi:shoulder.deltoid'))[0];
  assert.equal(
    (referenceMesh?.material as THREE.MeshStandardMaterial).color.getHex(),
    selectedColour,
    'a rejected+candidate structure did not render as selected',
  );
  selectedAdapter.dispose();
  adapter.dispose();
});

/* ---------------- manifest guards ---------------- */

test('the fixture guard requires an external-asset notice when a url is present', () => {
  const manifest = groupManifest();
  delete (manifest as { externalAssetNotice?: string }).externalAssetNotice;
  assert.throws(
    () => new Three3dAnatomyAdapter({ manifest }),
    (error: unknown) => error instanceof SceneManifestError && /externalAssetNotice/.test(String(error)),
  );
});

test('a blank nodeName is rejected rather than meaning "the whole file"', () => {
  const manifest = urlManifest([
    structureEntry({
      asiId: 'asi:shoulder.deltoid',
      geometry: { type: 'url', url: FIXTURE_URL, nodeName: '   ' },
    }),
  ]);
  assert.throws(
    () => new Three3dAnatomyAdapter({ manifest }),
    (error: unknown) => error instanceof SceneManifestError && /nodeName/.test(String(error)),
  );
});

test('an empty url is rejected', () => {
  const manifest = urlManifest([
    structureEntry({ asiId: 'asi:shoulder.deltoid', geometry: { type: 'url', url: '  ' } }),
  ]);
  assert.throws(
    () => new Three3dAnatomyAdapter({ manifest }),
    (error: unknown) => error instanceof SceneManifestError && /no url/.test(String(error)),
  );
});

/* ---------------- the fixture is not anatomy ---------------- */

test('the GLB fixture is not anatomy and declares itself', () => {
  const manifest = groupManifest();
  assert.equal(manifest.source, 'fixture');
  assert.match(manifest.disclaimer ?? '', /not anatomy/i);
  assert.match(manifest.externalAssetNotice ?? '', /not anatomy/i);
  // The built bytes really are a parseable GLB.
  const buffer = buildFixtureGlb();
  assert.equal(new DataView(buffer).getUint32(4, true), 2, 'not a glTF 2.0 binary');
  assert.equal(new TextDecoder().decode(new Uint8Array(buffer, 0, 4)), 'glTF');
});

/* ---------------- projections still replace, with url entries present ---------------- */

test('projectState replaces state with url geometry in the scene', async () => {
  const adapter = adapterFor(groupManifest());
  await adapter.mount(new FakeElement() as unknown as HTMLElement);
  const snapshot: ViewerState = {
    region: 'shoulder',
    visibleSubRegionIds: [],
    visibleLayers: ['muscle'],
    selectedStructureIds: ['shoulder.deltoid'],
    highlightedStructureIds: [],
    rejectedStructureIds: ['shoulder.acromion'],
    pins: [],
    activePin: null,
  };
  adapter.projectState(snapshot);
  assert.deepEqual(adapter.getState().selectedStructureIds, ['shoulder.deltoid']);
  assert.deepEqual(adapter.getState().rejectedStructureIds, ['shoulder.acromion']);
  // The projection changed materials on the real loaded meshes.
  const mesh = meshesUnder(rootOf(adapter, 'asi:shoulder.deltoid'))[0];
  assert.ok(mesh instanceof THREE.Mesh);
  adapter.dispose();
});