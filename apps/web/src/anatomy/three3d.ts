/**
 * Three3dAnatomyAdapter — the 3D viewer behind the same contract as the 2D map.
 *
 * Scope, stated plainly: Phase 1A wires the RENDERER, not anatomy. The meshes
 * it loads come from a manifest, and the only manifest that exists today is a
 * procedural fixture of placeholder volumes. There is no anatomical model here
 * and the adapter never claims otherwise; `manifest.disclaimer` is surfaced by
 * the UI. When the BodyParts3D pipeline lands it adds a manifest, not code.
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
  indexManifest,
} from './manifest.ts';
import type { AnatomyManifest, ManifestEntry } from './manifest.ts';
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
  manifest: AnatomyManifest;
  /**
   * Force failure of mount(). Exists so the fallback path is testable without
   * having to actually break a GPU context.
   */
  failMount?: boolean;
  /** Injected for tests; defaults to the real THREE renderer. */
  rendererFactory?: (host: HTMLElement) => THREE.WebGLRenderer;
  /**
   * Called when the GPU context is lost. The event is fired on the canvas and
   * does not bubble, so the adapter has to own the listener: a listener on the
   * host element would never see it.
   */
  onContextLost?: () => void;
}

export class Three3dAnatomyAdapter implements RenderedViewer {
  readonly kind = 'three3d';
  readonly capabilities: ViewerCapabilities = {
    picking: true,
    cameraPresets: true,
    layers: true,
    requiresGpu: true,
  };

  private manifest: AnatomyManifest;
  private index: Map<string, ManifestEntry>;
  private state: ViewerState;
  private view: CameraPreset;
  private listeners = new Set<(state: ViewerState) => void>();
  private opts: Three3dOptions;

  /** PRIVATE engine state. Nothing here is allowed to escape the adapter. */
  private objects = new Map<string, THREE.Object3D>();
  private pickables: THREE.Object3D[] = [];
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private host: HTMLElement | null = null;
  private frame = 0;
  private disposed = false;
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
    this.index = indexManifest(this.manifest);
    this.state = {
      region: 'shoulder',
      visibleSubRegionIds: [],
      visibleLayers: [...TISSUE_LAYER_ORDER],
      selectedStructureIds: [],
      highlightedStructureIds: [],
      rejectedStructureIds: [],
      pins: [],
      activePin: null,
    };
    this.view = DEFAULT_VIEW.shoulder;
  }

  /* ---------------- AnatomyAdapter ---------------- */

  getState(): ViewerState {
    return this.state;
  }

  getView(): CameraPreset {
    return this.view;
  }

  getManifest(): AnatomyManifest {
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
        // Never both selected and rejected: that reads as a contradiction.
        s.selectedStructureIds = s.selectedStructureIds.filter((id) => !set.has(id));
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
        s.highlightedStructureIds = [...new Set(cmd.structureIds)];
        s.selectedStructureIds = s.selectedStructureIds.filter(
          (id) => !s.highlightedStructureIds.includes(id),
        );
        break;
      case 'clearHighlight':
        s.highlightedStructureIds = [];
        break;
      case 'dropPin':
      case 'movePin':
        s.activePin = cmd.point;
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

    this.buildScene();
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
    const hits = ray.intersectObjects(this.pickables, false);
    for (const hit of hits) {
      // Straight out of engine space: the caller only ever sees an asiId and
      // domain ids. No UUID, no mesh, no engine-space coordinates.
      const asiId = this.asiIdOf(hit.object);
      if (!asiId) continue;
      const entry = this.index.get(asiId);
      if (!entry) continue;
      return {
        kind: entry.kind === 'structure' ? 'structure' : 'subregion',
        asiId,
        subRegionId: entry.subRegionId,
        structureId: entry.structureId,
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
    this.objects.clear();
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

  private asiIdOf(object: THREE.Object3D): string | undefined {
    for (const [asiId, obj] of this.objects) if (obj === object) return asiId;
    return undefined;
  }

  private materialFor(entry: ManifestEntry): THREE.MeshStandardMaterial {
    const s = this.state;
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.72,
      metalness: 0.04,
      transparent: true,
    });
    if (entry.kind === 'subregion') {
      const active = s.visibleSubRegionIds.includes(entry.subRegionId ?? '');
      material.color.setHex(active ? this.palette.active : this.palette.idle);
      material.opacity = active ? 0.95 : 0.8;
      return material;
    }
    const id = entry.structureId ?? '';
    if (s.rejectedStructureIds.includes(id)) {
      material.color.setHex(this.palette.rejected);
      material.opacity = 0.35;
      return material;
    }
    if (s.selectedStructureIds.includes(id)) {
      material.color.setHex(this.palette.selected);
      material.opacity = 1;
      material.emissive.setHex(this.palette.selected);
      material.emissiveIntensity = 0.28;
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
      if (geo.type !== 'primitive') continue; // url geometry arrives with the real pipeline
      const geometry = primitiveGeometry(geo.shape, geo.scale);
      const mesh = new THREE.Mesh(geometry, this.materialFor(entry));
      mesh.position.set(...geo.position);
      if (geo.rotation) mesh.rotation.set(...geo.rotation);
      mesh.userData.asiId = entry.asiId;
      this.scene.add(mesh);
      this.objects.set(entry.asiId, mesh);
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
      object.visible = layerVisible && inView;
      const mesh = object as THREE.Mesh;
      const material = this.materialFor(entry);
      mesh.material = material;
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
   */
  private retargetCamera(immediate = false): void {
    const entries = entriesFor(this.manifest, this.state.region, this.view);
    let radius = this.manifest.bounds.radius;
    if (entries.length) {
      const box = new THREE.Box3();
      const v = new THREE.Vector3();
      for (const entry of entries) {
        if (entry.geometry.type !== 'primitive') continue;
        v.set(...entry.geometry.position);
        box.expandByPoint(v);
      }
      if (!box.isEmpty()) {
        box.getCenter(this.focus);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        radius = Math.max(0.08, sphere.radius);
      }
    }
    const station = CAMERA_PRESETS[this.view];
    const target = this.focus.clone();
    // Fit the sphere in the tighter of the two field axes, with headroom.
    const vFov = (this.camera?.fov ?? 38) * (Math.PI / 180);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(1, this.camera?.aspect ?? 1));
    const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.35;
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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
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
