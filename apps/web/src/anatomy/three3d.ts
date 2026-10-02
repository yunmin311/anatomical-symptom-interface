/**
 * Three3dAnatomyAdapter — the 3D viewer behind the same contract as the 2D map.
 *
 * ## What this renders
 *
 * Real, externally sourced anatomy. `geometry.type: 'url'` fetches a GLB and adopts
 * the returned scene graph, and the production scenes are built from the canonical
 * manifest, so what appears on screen is BodyParts3D shoulder geometry — currently
 * one scene per side, chosen by the record's `location.side`.
 *
 * The synthetic fixture is still here and is still TEST-ONLY. It is what the picking,
 * layer-visibility and fallback tests mount, because its geometry is known-good and a
 * real asset's gaps would make those tests lie. A fixture must carry a `disclaimer`
 * and must never become the production scene; `assertProductionSceneIsReal` is the
 * guard, and it runs at scene build time rather than being a comment.
 *
 * Two consequences of rendering real anatomy that the code below has to respect:
 *
 *   - the mesh is in the source's own units and coordinate frame, not in the
 *     fixture's. Camera framing is derived from the measured scene rather than
 *     assumed, which is why `retargetCamera` computes its own near and far planes.
 *   - the side of the geometry is STATED by the scene entry, never inferred from the
 *     mesh name or the x coordinate. See `RendererSceneEntry.laterality`.
 *
 * Identity is the load-bearing rule. Engine objects are held in a private
 * `Map<asiId, Object3D>` and never returned, never stored in viewer state and
 * never used as a key the rest of the app can see. `pick()` resolves a raycast
 * back to an `asiId` immediately, so the only thing crossing the boundary is a
 * stable business id. That is what makes a renderer swap, a mesh reload or a
 * re-parented scene unable to invalidate a stored selection.
 */
import * as THREE from 'three';
import {
  REGIONS,
  TISSUE_LAYER_ORDER,
  layerDepthIndex,
} from '@asi/shared';
import type { BodyRegion, Depth, Structure, SubRegion, TissueLayer } from '@asi/shared';
import {
  assertNonMedical,
  entriesFor,
  indexScene,
} from './scene-manifest.ts';
import type { RendererSceneManifest, RendererSceneEntry } from './scene-manifest.ts';
import type {
  CameraPreset,
  MapPoint,
  PickResult,
  RenderedViewer,
  ViewerCapabilities,
  ViewerCommand,
  ViewerState,
} from './types.ts';

export const DEFAULT_VIEW: Record<BodyRegion, CameraPreset> = {
  shoulder: 'anterior',
  neck: 'anterior',
  lower_back: 'posterior',
  knee: 'anterior',
};

/**
 * Camera stations, in manifest units. `lateral_left` puts the camera on the
 * figure's left flank. Whether that corresponds to the PATIENT's left on screen
 * is a mirroring question tracked in DESIGN_HANDOFF, not something this adapter
 * guesses at; what matters here is that each preset is a distinct, testable
 * station.
 */
export const CAMERA_PRESETS: Record<CameraPreset, { position: [number, number, number]; target: [number, number, number] }> = {
  anterior: { position: [0, 0.12, 1.55], target: [0, 0.1, 0] },
  posterior: { position: [0, 0.12, -1.55], target: [0, 0.1, 0] },
  lateral_left: { position: [1.55, 0.12, 0], target: [0, 0.1, 0] },
  lateral_right: { position: [-1.55, 0.12, 0], target: [0, 0.1, 0] },
};

/** Palette, resolved from the design tokens so 3D and 2D cannot drift. */
interface Palette {
  idle: number;
  active: number;
  candidate: number;
  selected: number;
  rejected: number;
  pin: number;
  backdrop: number;
}

/**
 * The 3D backdrop is darker than the page field on purpose. Idle volumes are a
 * pale neutral, and against a pale backdrop they vanish: a viewer that mounts,
 * reports success and shows nothing is the worst possible failure mode, because
 * it looks like the anatomy is simply absent.
 */
const FALLBACK_PALETTE: Palette = {
  idle: 0xb4b3a8,
  active: 0x8d6f81,
  candidate: 0x8a6f42,
  selected: 0x69485f,
  rejected: 0x8e8e86,
  pin: 0x1d1f1e,
  backdrop: 0xdad8d0,
};

function hexToInt(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  return Number.parseInt(full, 16);
}

function readPalette(host: HTMLElement): Palette {
  // A missing style engine (headless tests, SSR) and a host that is not a real
  // Element (a stub, a detached node) must both fall back rather than stop a
  // viewer from mounting; the fallback carries the same values.
  let read: CSSStyleDeclaration | null = null;
  try {
    if (typeof globalThis.getComputedStyle === 'function')
      read = globalThis.getComputedStyle(host);
  } catch {
    read = null;
  }
  const get = (name: string, fallback: number) => {
    if (!read) return fallback;
    try {
      return hexToInt(read.getPropertyValue(name), fallback);
    } catch {
      return fallback;
    }
  };
  return {
    idle: get('--zone-idle', FALLBACK_PALETTE.idle),
    active: get('--accent', FALLBACK_PALETTE.active),
    candidate: get('--candidate', FALLBACK_PALETTE.candidate),
    selected: get('--accent', FALLBACK_PALETTE.selected),
    rejected: get('--muted', FALLBACK_PALETTE.rejected),
    pin: get('--ink', FALLBACK_PALETTE.pin),
    backdrop: FALLBACK_PALETTE.backdrop,
  };
}

export interface Three3dOptions {
  manifest: RendererSceneManifest;
  /**
   * Force failure of mount(). Exists so the fallback path is testable without
   * having to actually break a GPU context.
   */
  failMount?: boolean;
  /** Injected for tests; defaults to the real THREE renderer. */
  rendererFactory?: (host: HTMLElement) => THREE.WebGLRenderer;
  /**
   * Transport for `url` geometry. Injected so a headless test can supply real
   * GLB bytes without a browser `fetch`; everything downstream of this call —
   * node resolution, scene-graph adoption, materials, picking, bounds — is the
   * production path in both cases. Defaults to three's GLTFLoader.
   */
  loadGlb?: GlbLoader;
  /**
   * How long a single asset may take before mount gives up on it. Without a
   * bound, one hung request holds the viewer in "not ready" forever, and the
   * caller's only escape is a reload. A timeout turns that into the ordinary
   * 2D fallback.
   */
  assetTimeoutMs?: number;
  /**
   * Called when the GPU context is lost. The event is fired on the canvas and
   * does not bubble, so the adapter has to own the listener: a listener on the
   * host element would never see it.
   */
  onContextLost?: () => void;
}

/**
 * Loads one GLB and hands back its root scene. Deliberately narrow: the adapter
 * must not depend on three's GLTF types, because those are engine types and
 * engine types are what must not leak past this seam.
 */
export type GlbLoader = (url: string) => Promise<{ scene: THREE.Object3D }>;

/**
 * One asset load, and who is responsible for the geometry it produces.
 *
 * The interesting cases are all about a load that outlives the attempt that
 * started it. `abandoned` is what a LATE fulfilment reads: set while the promise
 * is still PENDING by both paths that give up (the mount deadline, and dispose),
 * so it is always settled before the promise fulfils, and a fulfilment callback
 * can read it and know whether anyone is still going to use what just arrived.
 *
 * `adopted` is only ever read by dispose, to avoid releasing the same buffers
 * twice — see the loop there.
 */
interface AssetLoad {
  promise: Promise<{ scene: THREE.Object3D }>;
  /** The loaded scene, set as soon as the promise fulfils. */
  loaded: { scene: THREE.Object3D } | null;
  /** True once this attempt can no longer be adopted, however it ends. */
  abandoned: boolean;
  /** True once a clone of this load was handed back for adoption. */
  adopted: boolean;
}

/**
 * Renderer resource accounting, for tests and gates.
 *
 * Exposed rather than reached into, because the question these numbers answer —
 * "after a timeout and a late resolve, is anything left?" — is only meaningful
 * if it can be asked of a disposed viewer, and private fields disappear in a
 * production build. A leak gate that has to guess at field names is a leak gate
 * that quietly stops working.
 */
export interface RendererResources {
  /** Loads this viewer owns and has not finished accounting for. */
  outstandingAssets: number;
  /** URL cache entries, which is the sharing optimisation and nothing more. */
  cacheEntries: number;
  /** Entries adopted into the scene, keyed by asiId. */
  sceneObjects: number;
  /** Nodes in the scene graph, at every depth. */
  sceneNodes: number;
  /** Whether a canvas is attached to the renderer. */
  canvasAttached: boolean;
  /** A pending animation frame handle, or 0 when none is scheduled. */
  frameHandle: number;
}

const DEFAULT_ASSET_TIMEOUT_MS = 15_000;

/**
 * The production loader. The GLTFLoader import is dynamic so a manifest with no
 * url geometry never pulls three's loader chunk into the bundle.
 */
const defaultGlbLoader: GlbLoader = async (url) => {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  return { scene: gltf.scene };
};

export class Three3dAnatomyAdapter implements RenderedViewer {
  readonly kind = 'three3d';
  readonly capabilities: ViewerCapabilities = {
    picking: true,
    cameraPresets: true,
    layers: true,
    requiresGpu: true,
  };

  private manifest: RendererSceneManifest;
  private index: Map<string, RendererSceneEntry>;
  private state: ViewerState;
  private view: CameraPreset;
  private listeners = new Set<(state: ViewerState) => void>();
  private opts: Three3dOptions;

  /** PRIVATE engine state. Nothing here is allowed to escape the adapter. */
  private objects = new Map<string, THREE.Object3D>();
  /**
   * asiId -> owning root, for every descendant of that root.
   *
   * A GLB is a scene graph, not a mesh: one manifest entry routinely owns a
   * Group with meshes several levels down. Raycasting returns the leaf that was
   * actually hit, so the hit object has to be resolvable back to the entry that
   * owns it. This is that reverse index, and it is the ONLY bridge from an
   * engine object to a business id — a three.js UUID, a mesh name or a node id
   * is never itself the identity.
   */
  private ownerOf = new Map<THREE.Object3D, string>();
/**
   * One load per distinct url, shared by every entry that points at it. A real
   * asset pipeline ships many parts in one file, and `nodeName` is how a
   * manifest says which part it wants.
   *
   * This is the SHARING index only. An entry here may be forgotten at any time — a
   * timed-out url is deleted so the next mount retries — so it must never be the
   * thing that owns a load.
   */
  private glbCache = new Map<string, AssetLoad>();
  /**
   * OWNERSHIP of every load this viewer started, held SEPARATELY from the URL
   * index and deliberately NOT keyed by url.
   *
   * Keying ownership by url was the original bug. A timeout deleted the url, so
   * the load became unreachable, while a retry wrote a NEW load under the same
   * key and pushed the old one out of any map. A loader that then fulfilled had
   * real GPU buffers and no owner, and held them for the life of the page.
   *
   * A set of loads cannot be overwritten by a retry, so every promise ever
   * started stays reachable until dispose accounts for it. Nothing this viewer
   * allocates is reachable only through a cache entry that may be evicted.
   */
  private assets = new Set<AssetLoad>();
  private pickables: THREE.Object3D[] = [];
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private host: HTMLElement | null = null;
  private frame = 0;
  private disposed = false;
  /**
   * Set while mount() is awaiting assets, so a dispose() that lands mid-load is
   * observable by the loader and can refuse to add anything to the scene.
   */
  private mounting = false;
  private palette: Palette = FALLBACK_PALETTE;
  /** Normalised body-space centre of the focused region, for camera framing. */
  private focus: THREE.Vector3 = new THREE.Vector3(0, 0.1, 0);
  private cameraGoal: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private pinMesh: THREE.Object3D | null = null;
  /** Set when the GPU context is lost, so callers can fall back. */
  private contextLost = false;
  private onContextLost: (() => void) | null = null;
  private onCanvasContextLost: ((event: Event) => void) | null = null;

  constructor(opts: Three3dOptions) {
    this.opts = opts;
    this.manifest = opts.manifest;
    // A fixture must be self-declaring, or it could be shown as anatomy.
    assertNonMedical(this.manifest);
    this.index = indexScene(this.manifest);
    this.state = {
      // The region comes from the SCENE, not from a constant.
      //
      // It was hardcoded to 'shoulder', which was invisible while every scene was a
      // shoulder. A neck-only manifest then had no entries matching `state.region`,
      // `retargetCamera` measured nothing, and the camera kept its fixture-scale
      // depth planes at 0.05..50 -- so neck geometry rendered about 1400 units away,
      // outside the frustum, and could not be picked. The scene rendered correctly
      // and was silently unclickable, which is the worst shape a bug can take.
      //
      // `focusRegion` replaces this when the user picks a region; this is the value
      // before they do.
      region: (this.manifest.entries[0]?.region ?? 'shoulder') as BodyRegion,
      visibleSubRegionIds: [],
      visibleLayers: [...TISSUE_LAYER_ORDER],
      selectedStructureIds: [],
      highlightedStructureIds: [],
      rejectedStructureIds: [],
      pins: [],
      activePin: null,
    };
    this.view = DEFAULT_VIEW[(this.manifest.entries[0]?.region ?? 'shoulder') as BodyRegion];
  }

  /* ---------------- AnatomyAdapter ---------------- */

  getState(): ViewerState {
    return this.state;
  }

  getView(): CameraPreset {
    return this.view;
  }

  getManifest(): RendererSceneManifest {
    return this.manifest;
  }

  subscribe(fn: (state: ViewerState) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  apply(cmd: ViewerCommand): void {
    const s = this.state;
    switch (cmd.type) {
      case 'focusRegion':
        s.region = cmd.region;
        s.visibleSubRegionIds = [];
        s.highlightedStructureIds = [];
        this.view = DEFAULT_VIEW[cmd.region];
        this.retargetCamera();
        break;
      case 'setView':
        this.view = cmd.view;
        this.retargetCamera();
        break;
      case 'showLayers':
        s.visibleLayers = [...new Set([...s.visibleLayers, ...cmd.layers])];
        break;
      case 'hideLayers':
        s.visibleLayers = s.visibleLayers.filter((l) => !cmd.layers.includes(l));
        break;
      case 'focusSubRegion':
        s.visibleSubRegionIds = [cmd.subRegionId];
        break;
      case 'highlight': {
        const set = new Set(cmd.structureIds);
        if (cmd.as === 'selected') {
          s.selectedStructureIds = [...new Set([...s.selectedStructureIds, ...set])];
          s.highlightedStructureIds = s.highlightedStructureIds.filter((id) => !set.has(id));
        } else {
          s.highlightedStructureIds = [
            ...new Set([...s.highlightedStructureIds, ...set]),
          ];
        }
        // Highlighting something the user already dismissed would contradict
        // the rejection, so a new highlight clears it.
        s.rejectedStructureIds = s.rejectedStructureIds.filter((id) => !set.has(id));
        break;
      }
      case 'reject': {
        const set = new Set(cmd.structureIds);
        s.rejectedStructureIds = [...new Set([...s.rejectedStructureIds, ...set])];
        // Presentation only. This must not filter the selection: the canonical
        // authority is location.userSelectedStructureIds, and a visual dismissal
        // is not allowed to unselect something the record still says the user
        // pointed at. See materialFor for how the conflict is displayed.
        s.highlightedStructureIds = s.highlightedStructureIds.filter((id) => !set.has(id));
        break;
      }
      case 'clearReject':
        s.rejectedStructureIds = s.rejectedStructureIds.filter(
          (id) => !cmd.structureIds.includes(id),
        );
        break;
      case 'setSelected':
        // Replace, never merge. The canonical persisted authority is
        // location.userSelectedStructureIds; this mirrors it.
        s.selectedStructureIds = [...new Set(cmd.structureIds)];
        s.highlightedStructureIds = s.highlightedStructureIds.filter(
          (id) => !s.selectedStructureIds.includes(id),
        );
        s.rejectedStructureIds = s.rejectedStructureIds.filter(
          (id) => !s.selectedStructureIds.includes(id),
        );
        break;
      case 'setHighlighted':
        // Replaces, and touches nothing else: a candidate list is presentation.
        // It used to filter the selection out, so a re-localisation could
        // silently drop an id the record still listed as user-selected.
        s.highlightedStructureIds = [...new Set(cmd.structureIds)];
        break;
      case 'clearHighlight':
        s.highlightedStructureIds = [];
        break;
      case 'dropPin':
      case 'movePin':
        s.activePin = cmd.point;
        break;
      case 'clearPin':
        s.activePin = null;
        break;
      case 'removePin':
        s.pins = s.pins.filter((p) => p.id !== cmd.pinId);
        if (s.activePin) s.activePin = null;
        break;
      case 'setDepth':
        s.visibleLayers = layersForDepth(cmd.depth);
        break;
    }
    this.syncScene();
    this.emit();
  }

  pickableStructures(): Structure[] {
    const visible = new Set(this.state.visibleLayers);
    const subs = this.state.visibleSubRegionIds.length
      ? this.state.visibleSubRegionIds
      : REGIONS[this.state.region].subRegions.map((x) => x.id);
    const seen = new Map<string, Structure>();
    for (const id of subs) {
      const structures =
        REGIONS[this.state.region].subRegions.find((x) => x.id === id)?.structures ?? [];
      for (const structure of structures) {
        // A rejected suggestion stays out of the pickable set until it is
        // cleared, so a dismissed structure cannot be re-selected by accident.
        if (visible.has(structure.layer) && !this.state.rejectedStructureIds.includes(structure.id))
          seen.set(structure.id, structure);
      }
    }
    return [...seen.values()];
  }

  pickableSubRegions(): SubRegion[] {
    return REGIONS[this.state.region].subRegions;
  }

  /**
   * Stable, meaningful order for keyboard traversal. The canvas is an
   * enhancement; this list is the accessible path, and it must never depend on
   * scene-graph order.
   */
  keyboardOrder(): string[] {
    const rejected = new Set(this.state.rejectedStructureIds);
    return entriesFor(this.manifest, this.state.region, this.view, (layer) =>
      this.state.visibleLayers.includes(layer),
    )
      .filter((entry) => !entry.structureId || !rejected.has(entry.structureId))
      .map((entry) => entry.asiId);
  }

  /* ---------------- RenderedViewer ---------------- */

  async mount(host: HTMLElement): Promise<void> {
    if (this.opts.failMount)
      throw new Error('Three3dAnatomyAdapter: mount failed (injected)');
    if (this.disposed)
      throw new Error('Three3dAnatomyAdapter: cannot mount a disposed viewer');
    this.host = host;
    this.contextLost = false;
    this.onContextLost = this.opts.onContextLost ?? null;
    this.palette = readPalette(host);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = this.opts.rendererFactory
        ? this.opts.rendererFactory(host)
        : new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (cause) {
      // No WebGL here. The caller falls back to 2D; a blank canvas is not an
      // acceptable outcome.
      throw new Error(
        `Three3dAnatomyAdapter: WebGL unavailable (${
          cause instanceof Error ? cause.message : String(cause)
        })`,
      );
    }
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
    host.appendChild(renderer.domElement);
    // Absolutely positioned so the canvas can never contribute to the host's
    // height. A canvas sized by percentage inside a flex:1 box that is itself
    // sized by its content feeds its own size back in, and grows without bound.
    const style = renderer.domElement.style;
    style.position = 'absolute';
    style.inset = '0';
    style.display = 'block';
    style.width = '100%';
    style.height = '100%';
    style.touchAction = 'none';
    // The event fires on the canvas and does not bubble, so it is bound here.
    // Defaulting the context to null is the browser's way of saying the GPU is
    // gone; a listener that ignores it leaves a frozen canvas on screen.
    this.onCanvasContextLost = (event: Event) => {
      event.preventDefault();
      this.contextLost = true;
      this.onContextLost?.();
    };
    renderer.domElement.addEventListener('webglcontextlost', this.onCanvasContextLost);

    this.scene = new THREE.Scene();
    // An opaque backdrop: the volumes are pale, and a transparent canvas over a
    // pale field makes a working viewer look empty.
    this.scene.background = new THREE.Color(this.palette.backdrop);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
    const station = CAMERA_PRESETS[this.view];
    this.camera.position.set(...station.position);
    this.camera.lookAt(this.focus);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(1.4, 2, 2.2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.7);
    rim.position.set(-1.6, 0.6, -1.8);
    this.scene.add(rim);

    this.mounting = true;
    try {
      this.buildScene();
      // Before this resolves the viewer is NOT ready. A 3D canvas that mounts,
      // reports success and then quietly gains its geometry a second later is
      // indistinguishable from a broken viewer, and a missing asset must land on
      // the 2D fallback rather than on a half-drawn body.
      await this.loadUrlGeometry();
    } finally {
      this.mounting = false;
    }
    // A dispose() that arrived while the loads were in flight wins: adopting the
    // scene now would re-attach objects to a renderer nobody can stop.
    if (this.disposed) throw new Error('Three3dAnatomyAdapter: disposed during mount');
    this.scene.updateMatrixWorld(true);
    this.syncScene();

    const rect = host.getBoundingClientRect();
    this.resize(rect.width || host.clientWidth || 640, rect.height || host.clientHeight || 480);
    // Frame the region with the real aspect ratio now that the size is known.
    this.retargetCamera(true);

    this.frame = requestFrame(this.tick);
  }

  resize(width: number, height: number): void {
    if (!this.renderer || !this.camera) return;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  focusCamera(preset: CameraPreset, opts?: { immediate?: boolean }): void {
    this.view = preset;
    this.retargetCamera(opts?.immediate === true);
  }

  pick(clientX: number, clientY: number): PickResult {
    if (!this.renderer || !this.camera || !this.scene) return { kind: 'none' };
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { kind: 'none' };
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    // Recursive, because an entry owns a scene graph and the raycaster reports
    // the leaf mesh it actually struck. `ownerOf` maps that leaf back to the
    // entry, which is what makes a hit on a 40-mesh GLB resolve to the same
    // asiId as a hit on a single primitive.
    const hits = ray.intersectObjects(this.pickables, true);
    for (const hit of hits) {
      // Straight out of engine space: the caller only ever sees an asiId and
      // domain ids. No UUID, no mesh, no engine-space coordinates.
      const asiId = this.asiIdOf(hit.object);
      if (!asiId) continue;
      const entry = this.index.get(asiId);
      if (!entry) continue;
      // A node with `visible = false` is not a hit target even if it is still in
      // the graph, and neither is anything behind one.
      if (!this.isActuallyVisible(hit.object)) continue;
      return {
        kind: entry.kind === 'structure' ? 'structure' : 'subregion',
        asiId,
        // The whole canonical list, and a singular field ONLY when there is
        // exactly one answer. `soleSubRegionId` is verified against the list by
        // indexScene, so it can never be "the first of several".
        subRegionIds: [...entry.subRegionIds],
        ...(entry.soleSubRegionId ? { subRegionId: entry.soleSubRegionId } : {}),
        structureId: entry.structureId,
        // The side of the geometry that was actually hit, read off the scene entry
        // the ray resolved to. A statement about which mesh was under the cursor --
        // not a clinical side, and not something the renderer may write to a record.
        laterality: entry.laterality,
        point: {
          x: clamp01(
            (hit.point.x + this.manifest.bounds.radius) / (this.manifest.bounds.radius * 2),
          ),
          y: clamp01(0.5 - hit.point.y / this.manifest.bounds.height),
        },
      };
    }
    return { kind: 'none' };
  }

  /** Visible all the way up the chain, so a hidden parent hides its hits. */
  private isActuallyVisible(object: THREE.Object3D): boolean {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      if (!node.visible) return false;
    }
    return true;
  }

  projectPin(point: MapPoint): MapPoint | null {
    if (!this.camera || !this.renderer) return null;
    const v = new THREE.Vector3(
      (point.x - 0.5) * this.manifest.bounds.radius * 2,
      (0.5 - point.y) * this.manifest.bounds.height,
      0,
    );
    v.project(this.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  /**
   * Replace this viewer's state wholesale with the source's.
   *
   * The command path cannot express removal — `showLayers` only adds, `highlight`
   * only adds — so projecting through it could only ever widen the gap between
   * this viewer and its source. Copying the snapshot and re-deriving the scene
   * from it is what makes the two states EQUAL rather than "at least as
   * complete". Meshes and the renderer are untouched: only state and the visuals
   * derived from it are replaced.
   */
  projectState(snapshot: ViewerState): void {
    const regionChanged = snapshot.region !== this.state.region;
    this.state = {
      region: snapshot.region,
      visibleSubRegionIds: [...snapshot.visibleSubRegionIds],
      visibleLayers: [...snapshot.visibleLayers],
      selectedStructureIds: [...snapshot.selectedStructureIds],
      highlightedStructureIds: [...snapshot.highlightedStructureIds],
      rejectedStructureIds: [...snapshot.rejectedStructureIds],
      pins: snapshot.pins.map((pin) => ({ ...pin })),
      activePin: snapshot.activePin ? { ...snapshot.activePin } : null,
    };
    if (regionChanged) this.retargetCamera();
    this.syncScene();
    this.emit();
  }

  isLive(): boolean {
    return this.renderer !== null && !this.disposed && !this.contextLost;
  }

  /** True when the GPU context was lost, so the caller can explain the fallback. */
  hasLostContext(): boolean {
    return this.contextLost;
  }

  /**
   * What this viewer still holds.
   *
   * The leak question that matters is asked AFTER dispose, when the answer should
   * be zero for everything: a timeout that falls back to 2D and then has its
   * loader resolve anyway is the case that used to leave real geometry behind
   * with no reachable owner.
   */
  resources(): RendererResources {
    let sceneNodes = 0;
    this.scene?.traverse(() => {
      sceneNodes += 1;
    });
    return {
      outstandingAssets: this.assets.size,
      cacheEntries: this.glbCache.size,
      sceneObjects: this.objects.size,
      sceneNodes,
      canvasAttached: Boolean(this.renderer?.domElement?.parentNode),
      frameHandle: this.frame,
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame) cancelFrame(this.frame);
    this.frame = 0;
    if (this.renderer && this.onCanvasContextLost)
      this.renderer.domElement.removeEventListener('webglcontextlost', this.onCanvasContextLost);
    this.onCanvasContextLost = null;
    if (this.scene) {
      this.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else if (material) (material as THREE.Material).dispose();
      });
      this.scene.clear();
    }
    // Release every asset this viewer owns, using OWNERSHIP rather than the URL
    // index. The index can legitimately forget a url (a timeout deletes it so a
    // retry is possible), and reaching only through the index is exactly how a
    // timed-out load that fulfils later ended up with nothing to release it.
    for (const load of this.assets) {
      load.abandoned = true;
      // Release ONLY loads nothing adopted. The scene traverse above already
      // freed every buffer a live clone shares, so freeing an adopted load here
      // too would dispose the same geometry twice. An unadopted load has no clone
      // anywhere, so this is the only path that can reach it.
      //
      // Still pending: `abandoned` makes its own late fulfilment release it.
      if (load.loaded && !load.adopted) releaseObject(load.loaded.scene);
    }
    this.assets.clear();
    this.glbCache.clear();
    this.objects.clear();
    this.ownerOf.clear();
    this.pickables = [];
    this.pinMesh = null;
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
    this.host = null;
    this.listeners.clear();
  }

  /* ---------------- internals ---------------- */

  /**
   * Resolve an engine object to the asiId that owns it.
   *
   * Every node in an entry's subtree resolves to the same asiId, which is what
   * lets a manifest bind a Group instead of a Mesh without anything downstream
   * having to know a GLB is a tree.
   */
  private asiIdOf(object: THREE.Object3D): string | undefined {
    return this.ownerOf.get(object);
  }

  /** Index a freshly adopted root so all of its descendants resolve to one asiId. */
  private indexDescendants(root: THREE.Object3D, asiId: string): void {
    this.ownerOf.set(root, asiId);
    root.traverse((node) => this.ownerOf.set(node, asiId));
  }

  /**
   * Load and adopt every `url` entry.
   *
   * Three rules, all of them there because the alternative is a broken viewer
   * rather than an absent one:
   *
   *  1. Await every asset before returning. Mount resolving early is what lets a
   *     "ready" 3D view render an empty scene.
   *  2. Fail loudly. A node that is not there, or a file that will not decode,
   *     throws, so the workspace falls back to 2D. Skipping quietly would draw a
   *     body with holes in it and report success.
   *  3. Add nothing if the viewer was disposed while loading. The canvas, the
   *     scene and the frame loop are already gone at that point, so adopting the
   *     result would attach geometry to a renderer nobody can release.
   */
  private async loadUrlGeometry(): Promise<void> {
    const scene = this.scene;
    if (!scene) throw new Error('Three3dAnatomyAdapter: no scene to load into');
    const urlEntries = this.manifest.entries.filter((entry) => entry.geometry.type === 'url');
    if (urlEntries.length === 0) return;

    // A COMPOSITE contributes several sources, and each must load. The whole entry
    // fails if any component does, for the same reason rule 2 below applies to a single
    // asset: a partially mounted cervical spine is a body drawn with holes in it and
    // reported as ready.
    const settled = await Promise.allSettled(
      urlEntries.map(async (entry) => {
        const components = entry.geometry.type === 'url' ? entry.geometry.components : undefined;
        if (!components?.length) return { entry, roots: [await this.buildUrlRoot(entry)] };
        // Sequential rather than parallel so one failed component names itself in the
        // error; the sets are small (seven vertebrae, three scalenes).
        const roots: THREE.Object3D[] = [];
        for (const component of components) {
          try {
            roots.push(await this.buildComponentRoot(entry, component));
          } catch (cause) {
            for (const root of roots) releaseObject(root);
            throw new Error(
              `component ${component.meshName} of ${entry.asiId} failed to load: ` +
                (cause instanceof Error ? cause.message : String(cause)),
            );
          }
        }
        return { entry, roots };
      }),
    );

    const adopted: Array<{ entry: RendererSceneEntry; roots: THREE.Object3D[] }> = [];
    const failures: string[] = [];
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') adopted.push(outcome.value);
      else {
        failures.push(outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason));
      }
    }

    // Dispose-while-loading: release what did arrive and adopt nothing.
    if (this.disposed || !this.scene) {
      for (const { roots } of adopted) for (const root of roots) releaseObject(root);
      return;
    }
    if (failures.length) {
      for (const { roots } of adopted) for (const root of roots) releaseObject(root);
      throw new Error(
        `Three3dAnatomyAdapter: ${failures.length} asset(s) failed to load, so the 3D view is incomplete — ${failures[0]}`,
      );
    }

    for (const { entry, roots } of adopted) {
      if (entry.geometry.type !== 'url') continue;
      for (const root of roots) {
        if (entry.geometry.position) root.position.set(...entry.geometry.position);
        if (entry.geometry.scale) root.scale.set(...entry.geometry.scale);
        if (entry.geometry.rotation) root.rotation.set(...entry.geometry.rotation);
        this.scene.add(root);
        // EVERY component of a composite indexes to the SAME asiId.
        //
        // This is the invariant the whole composite model rests on: a raycast on the
        // seventh cervical vertebra resolves to `asi:neck.cervical-spine`, because a
        // user who pointed at their neck pointed at all seven. A pick resolving to a
        // sibling component id would mean one source element had become a second
        // canonical identity, which is the failure this prevents.
        this.indexDescendants(root, entry.asiId);
      }
      // Registered as a Group so the rest of the adapter keeps its one-object-per-id
      // shape: retargetCamera measures it, layer toggling hides it, dispose finds it.
      // `objects` stays Map<asiId, Object3D> rather than becoming a collection, so
      // every existing caller is unchanged.
      if (roots.length > 1) {
        const group = new THREE.Group();
        group.name = `composite:${entry.asiId}`;
        for (const root of roots) group.attach(root);
        this.objects.set(entry.asiId, group);
      } else if (roots[0]) {
        this.objects.set(entry.asiId, roots[0]);
      }
    }
  }

  /**
   * Arm the release rule for a load, ONCE, at the moment it is created.
   *
   * Armed here rather than at adoption on purpose. The failure this exists for is
   * one where the viewer has already stopped caring: mount timed out, so nobody is
   * awaiting the promise any more, so whatever arming it at adoption would mean
   * never runs. The rule has to be in place before the outcome is known.
   *
   * It reads `abandoned` and nothing else. An earlier version also checked
   * whether the load had been adopted, which was wrong in a way worth recording:
   * this callback is registered before `buildUrlRoot` awaits, so it always runs
   * BEFORE the adoption flag could be set, and a successful load released its own
   * geometry out from under the clone that shared it.
   */
  private armAssetRelease(load: AssetLoad): void {
    load.promise.then(
      (loaded) => {
        load.loaded = loaded;
        // Nobody is going to use this: it arrived after the deadline, or after the
        // viewer was disposed. Release it now rather than hold it until a dispose
        // that may already have happened.
        if (load.abandoned) releaseObject(loaded.scene);
      },
      () => {
        /* rejected: the loader never produced a scene, so nothing was allocated */
      },
    );
  }

  /**
   * Resolve one composite COMPONENT to a root Object3D, or throw.
   *
   * Structurally the same as `buildUrlRoot` with a different URL, kept separate so the
   * component's own cache entry, timeout and release rule are the same as any other
   * asset rather than a second, less-tested path. Sharing the cache also means two
   * canonical ids referencing the same file would load once, which `indexScene` then
   * rejects as ambiguous anyway.
   */
  private async buildComponentRoot(
    entry: RendererSceneEntry,
    component: { url: string },
  ): Promise<THREE.Object3D> {
    const loader = this.opts.loadGlb ?? defaultGlbLoader;
    const timeoutMs = this.opts.assetTimeoutMs ?? DEFAULT_ASSET_TIMEOUT_MS;

    let load = this.glbCache.get(component.url);
    if (!load) {
      load = { promise: loader(component.url), loaded: null, abandoned: false, adopted: false };
      this.glbCache.set(component.url, load);
      this.assets.add(load);
      this.armAssetRelease(load);
    }
    let loaded: { scene: THREE.Object3D };
    try {
      loaded = await withTimeout(load.promise, timeoutMs, component.url);
    } catch (cause) {
      if (load.loaded) releaseObject(load.loaded.scene);
      throw cause;
    }
    const root = loaded.scene.clone(true);
    load.loaded = loaded;
    load.adopted = true;
    void entry;
    return root;
  }

  /**
   * Resolve one url entry to a root Object3D, or throw.
   *
   * A clone is taken rather than the loaded node itself: one file may back
   * several entries, each with its own transform, and they must not share a
   * parent or a transform. Geometry is shared by the clone, which is what three
   * expects and what makes this cheap.
   */
  private async buildUrlRoot(entry: RendererSceneEntry): Promise<THREE.Object3D> {
    if (entry.geometry.type !== 'url') throw new Error('buildUrlRoot called on a primitive entry');
    const url = entry.geometry.url;
    const loader = this.opts.loadGlb ?? defaultGlbLoader;
    const timeoutMs = this.opts.assetTimeoutMs ?? DEFAULT_ASSET_TIMEOUT_MS;

    let load = this.glbCache.get(url);
    if (!load) {
      load = { promise: loader(url), loaded: null, abandoned: false, adopted: false };
      this.glbCache.set(url, load);
      this.assets.add(load);
      this.armAssetRelease(load);
    }
    let loaded: { scene: THREE.Object3D };
    try {
      loaded = await withTimeout(load.promise, timeoutMs, url);
    } catch (cause) {
      // This attempt is over and will never be adopted, so its geometry is on its
      // own the moment it arrives.
      load.abandoned = true;
      // The URL is forgotten so the next mount retries the deadline instead of
      // being handed the same promise that already missed it. The LOAD is not
      // forgotten: ownership lives in `assets`, which a retry cannot overwrite.
      if (this.glbCache.get(url) === load) this.glbCache.delete(url);
      throw new Error(`asset ${url} failed to load (${describe(cause)})`);
    }

    const source = loaded.scene;
    if (!source) throw new Error(`asset ${url} loaded with no scene`);

    const nodeName = entry.geometry.nodeName;
    const node = nodeName ? source.getObjectByName(nodeName) : source;
    if (!node)
      throw new Error(
        `asset ${url} has no node named "${nodeName}" (required by ${entry.asiId})`,
      );
    // An entry with no mesh descendants would mount successfully and draw
    // nothing, which is the one outcome worse than falling back.
    if (!hasMesh(node))
      throw new Error(`node "${node?.name || url}" contains no mesh for ${entry.asiId}`);

    // The clone below SHARES this geometry, which is what makes one file cheap to
    // use for several entries. That sharing is why dispose must not also release
    // an adopted load: the buffers it would free are the ones on screen.
    load.adopted = true;
    return node.clone(true);
  }

  private materialFor(entry: RendererSceneEntry): THREE.MeshStandardMaterial {
    const s = this.state;
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.72,
      metalness: 0.04,
      transparent: true,
    });
    if (entry.kind === 'subregion') {
      // A sub-region proxy is active when its own one sub-region is visible.
      const active = s.visibleSubRegionIds.includes(entry.soleSubRegionId ?? '');
      material.color.setHex(active ? this.palette.active : this.palette.idle);
      material.opacity = active ? 0.95 : 0.8;
      return material;
    }
    const id = entry.structureId ?? '';
    // Precedence, most authoritative first.
    //
    // `selected` outranks rejection and candidacy because
    // location.userSelectedStructureIds is the canonical record: if the record
    // says the user pointed here, a rejected suggestion cannot make the viewer
    // disagree with it. The presentation-only sets are compared after, so a
    // structure can be both selected and rejected without either command having
    // to mutate the other.
    if (s.selectedStructureIds.includes(id)) {
      material.color.setHex(this.palette.selected);
      material.opacity = 1;
      material.emissive.setHex(this.palette.selected);
      material.emissiveIntensity = 0.28;
      return material;
    }
    if (s.rejectedStructureIds.includes(id)) {
      material.color.setHex(this.palette.rejected);
      material.opacity = 0.35;
      return material;
    }
    if (s.highlightedStructureIds.includes(id)) {
      material.color.setHex(this.palette.candidate);
      material.opacity = 0.95;
      material.emissive.setHex(this.palette.candidate);
      material.emissiveIntensity = 0.16;
      return material;
    }
    material.color.setHex(this.palette.idle);
    material.opacity = 0.62;
    return material;
  }

  private buildScene(): void {
    if (!this.scene) return;
    for (const entry of this.manifest.entries) {
      const geo = entry.geometry;
      // `url` entries are adopted by loadUrlGeometry, which is async; this pass
      // is the synchronous primitive geometry only.
      if (geo.type !== 'primitive') continue;
      const geometry = primitiveGeometry(geo.shape, geo.scale);
      const mesh = new THREE.Mesh(geometry, this.materialFor(entry));
      mesh.position.set(...geo.position);
      if (geo.rotation) mesh.rotation.set(...geo.rotation);
      mesh.userData.asiId = entry.asiId;
      this.scene.add(mesh);
      this.objects.set(entry.asiId, mesh);
      this.indexDescendants(mesh, entry.asiId);
    }
    // A crosshair marker for the active pin. Kept small and offset in z so it
    // reads as an overlay rather than covering the geometry under it.
    const pin = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.045, 0.006, 8, 28),
      new THREE.MeshBasicMaterial({ color: this.palette.pin, depthTest: false }),
    );
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 12, 10),
      new THREE.MeshBasicMaterial({ color: this.palette.pin, depthTest: false }),
    );
    pin.add(ring, dot);
    pin.visible = false;
    pin.renderOrder = 999;
    this.pinMesh = pin;
    this.scene.add(pin);
  }

  /** Re-derive visibility and materials from state. Single source of truth. */
  private syncScene(): void {
    if (!this.scene) return;
    const visibleLayers = new Set(this.state.visibleLayers);
    const view = this.view;
    this.pickables = [];
    for (const [asiId, object] of this.objects) {
      const entry = this.index.get(asiId);
      if (!entry) continue;
      const layerVisible =
        entry.kind === 'subregion' ? true : visibleLayers.has(entry.layer);
      const inView = entry.views.includes(view);
      // Visibility is set on the ROOT and inherited by every descendant, so a
      // layer toggle hides a whole loaded asset rather than the one mesh the
      // old code happened to be holding.
      object.visible = layerVisible && inView;
      // Materials are applied to every mesh under the root: the entry's
      // candidate/selected/rejected appearance belongs to the asiId, and a
      // twenty-mesh GLB must not end up with nineteen of its meshes left in the
      // colour the asset shipped with.
      const material = this.materialFor(entry);
      object.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) mesh.material = material;
      });
      if (object.visible) this.pickables.push(object);
    }
    if (this.pinMesh) {
      const point = this.state.activePin;
      this.pinMesh.visible = Boolean(point);
      if (point) {
        this.pinMesh.position.set(
          (point.x - 0.5) * this.manifest.bounds.radius * 2,
          (0.5 - point.y) * this.manifest.bounds.height,
          this.manifest.bounds.radius * 0.55,
        );
      }
    }
  }

  /**
   * Frame the focused region without losing the current view direction.
   *
   * Distance is derived from the region's own bounds rather than fixed, so a
   * small region fills the field and a large one still fits. A fixed distance
   * makes every region look equally unimportant, which is the opposite of the
   * point of an anatomy workspace.
   *
   * Bounds come from the objects that are ACTUALLY in the scene. For a url entry
   * that is a Box3 over the loaded graph, so a real GLB is framed on its own
   * extent; only a primitive falls back to its declared centre. Sizing a loaded
   * model from hardcoded primitive coordinates would frame the fixture and
   * leave the actual asset off-screen or filling it.
   */
  private retargetCamera(immediate = false): void {
    const entries = entriesFor(this.manifest, this.state.region, this.view);
    let radius = this.manifest.bounds.radius;
    if (entries.length) {
      // World matrices have to be current or nested transforms read as identity.
      this.scene?.updateMatrixWorld(true);
      const box = new THREE.Box3();
      const v = new THREE.Vector3();
      let measured = false;
      for (const entry of entries) {
        const object = this.objects.get(entry.asiId);
        if (object) {
          box.expandByObject(object);
          measured = true;
          continue;
        }
        if (entry.geometry.type !== 'primitive') continue;
        v.set(...entry.geometry.position);
        box.expandByPoint(v);
        measured = true;
      }
if (measured && !box.isEmpty()) {
      box.getCenter(this.focus);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      radius = Math.max(0.08, sphere.radius);
      // FRUSTUM FROM THE ACTUAL SCENE, NOT FROM A CONSTANT.
      //
      // The depth planes were a hardcoded 0.05..50, sized for the fixture, which is
      // about 1.8 units tall and sits on the origin. Real anatomy is in
      // MILLIMETRES: the BodyParts3D shoulder meshes span roughly 80-280 units and
      // sit about 1300 units from the origin, so every ray left the frustum before
      // it reached the geometry. Nothing crashed and nothing rendered as "no hit" in
      // a way anyone would read as a picking bug -- the viewer simply showed real
      // anatomy that could not be clicked.
      //
      // Derived from the measured sphere so it holds for any asset in any units: far
      // clears the camera and the far side of the body with room to spare, near is a
      // small fraction of the radius so precision survives at any scale.
      const depthScale = Math.max(radius, 0.08);
      if (this.camera) {
        this.camera.near = Math.max(0.001, depthScale * 0.01);
        this.camera.far = depthScale * 40 + distanceFor(radius, this.camera) * 4;
        this.camera.updateProjectionMatrix();
      }
    }
    }
    const station = CAMERA_PRESETS[this.view];
    const target = this.focus.clone();
    // Fit the sphere in the tighter of the two field axes, with headroom.
    const distance = this.camera ? distanceFor(radius, this.camera) : radius * 4;
    const direction = new THREE.Vector3(...station.position).normalize();
    const position = direction.multiplyScalar(distance).add(target);
    if (immediate || !this.camera) {
      this.camera?.position.copy(position);
      this.camera?.lookAt(target);
      this.cameraGoal = null;
      return;
    }
    this.cameraGoal = { position, target };
  }

  private tick = (): void => {
    this.frame = requestFrame(this.tick);
    if (!this.renderer || !this.scene || !this.camera) return;
    if (this.cameraGoal) {
      // Ease toward the goal so switching view reads as a move, not a cut.
      this.camera.position.lerp(this.cameraGoal.position, 0.18);
      this.camera.lookAt(this.cameraGoal.target);
      if (this.camera.position.distanceTo(this.cameraGoal.position) < 0.01)
        this.cameraGoal = null;
    }
    this.renderer.render(this.scene, this.camera);
  };
}

/**
 * How far back the camera must sit to fit a sphere of `radius` in the frustum.
 *
 * Shared by `retargetCamera` and the depth-plane calculation, because a far plane
 * derived from a different distance than the camera actually uses is exactly the kind
 * of near-miss that only shows up on some assets.
 */
function distanceFor(radius: number, camera: THREE.PerspectiveCamera): number {
  const vFov = camera.fov * (Math.PI / 180);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(1, camera.aspect || 1));
  return (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.35;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Bound a load so one slow asset cannot hold the viewer in "not ready".
 *
 * The timer is always cleared, including on the success path, so a normal load
 * does not leave a pending timeout behind it.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Release a loaded graph that was never adopted.
 *
 * Needed on both failure and dispose paths: without it, a GLB that finished
 * loading after the viewer gave up would hold its geometry for the life of the
 * page.
 */
function releaseObject(object: THREE.Object3D | null | undefined): void {
  if (!object) return;
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else if (material) (material as THREE.Material).dispose();
  });
}

/** True when the node has a Mesh somewhere beneath it, at any depth. */
function hasMesh(node: THREE.Object3D): boolean {
  let found = false;
  node.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) found = true;
  });
  return found;
}

/**
 * Frame scheduling that also works outside a browser.
 *
 * Headless tests mount a real adapter with a stub renderer, and there is no
 * requestAnimationFrame there; falling back to a timer keeps the lifecycle —
 * including cancelAnimationFrame on dispose — exercised rather than skipped.
 */
const requestFrame: (cb: FrameRequestCallback) => number =
  typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame.bind(globalThis)
    : (cb) => setTimeout(() => cb(Date.now()), 16) as unknown as number;

const cancelFrame: (handle: number) => void =
  typeof globalThis.cancelAnimationFrame === 'function'
    ? globalThis.cancelAnimationFrame.bind(globalThis)
    : (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);

function primitiveGeometry(
  shape: 'box' | 'sphere' | 'cylinder' | 'capsule',
  scale: [number, number, number],
): THREE.BufferGeometry {
  // Unit primitives, scaled by the caller, so the manifest stays declarative.
  switch (shape) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1).scale(scale[0], scale[1], scale[2]);
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 24, 18).scale(scale[0], scale[1], scale[2]);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 24).scale(scale[0], scale[1], scale[2]);
    case 'capsule':
      return new THREE.CapsuleGeometry(0.5, 1, 6, 16).scale(scale[0], scale[1], scale[2]);
  }
}

/**
 * Felt depth maps to which layers are visible. This is the user's report of how
 * deep something FEELS, not a tissue identification, so it only ever changes
 * visibility — it never names or infers a structure.
 */
export function layersForDepth(depth: Depth): TissueLayer[] {
  switch (depth) {
    case 'superficial':
      return ['skin', 'subcutaneous', 'fascia'];
    case 'intermediate':
      return ['subcutaneous', 'fascia', 'muscle', 'tendon'];
    case 'deep':
      return ['muscle', 'tendon', 'ligament', 'joint', 'bone', 'nerve', 'vessel'];
    default:
      return [...TISSUE_LAYER_ORDER];
  }
}

/** Ordering helper shared with the layer control, so UI and viewer agree. */
export function sortLayers(layers: TissueLayer[]): TissueLayer[] {
  return [...layers].sort((a, b) => layerDepthIndex(a) - layerDepthIndex(b));
}
