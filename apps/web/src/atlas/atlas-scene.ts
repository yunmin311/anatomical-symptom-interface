/**
 * three.js scene for the anatomy atlas viewer.
 *
 * ## Division of responsibility
 *
 * All DECISIONS live in the pure modules: material-system.ts decides colour,
 * atlas-state.ts decides what is visible and at what opacity, camera-presets.ts
 * decides where "front" is, fidelity.ts decides how close the camera may get,
 * coverage.ts decides what the panel says about the dataset. This file only
 * carries those decisions into a WebGL context. It makes no anatomical or
 * presentational judgement of its own, which is why it can be replaced without
 * changing behaviour.
 *
 * ## Identity is never inferred here
 *
 * A structure is whatever node the manifest names. Colour comes from the
 * manifest's `system`, which came from the reviewed anatomy-system-map. Nothing
 * is matched by name pattern, by colour, or by position.
 *
 * ## THIS READS THE ATLAS MANIFEST, NOT THE CANONICAL ONE
 *
 * The viewer loads `atlas-manifest.json`, never `generated/<region>/<side>/manifest.json`.
 * The two are different contracts:
 *
 *   - the CANONICAL manifest is the domain/evidence product. One entry per `asi:*`
 *     structure, the source mesh bound to it, its laterality, the geometry budget.
 *     It is what the product's anatomy claims rest on, and the laterality tests
 *     read real builds of it as evidence.
 *   - the ATLAS manifest is the presentation product. It carries every mesh the
 *     viewer can draw, including the 33 that have no `asi:*` id at all.
 *
 * An earlier version of this viewer wrote its own manifest over the canonical
 * path, which destroyed the canonical file and broke those tests. The split is
 * now enforced by `scripts/build-atlas-manifest.mjs`, which refuses to write into
 * the canonical tree, and by a test that checks this file never fetches the
 * canonical path.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import {
  SELECTION_COLOUR,
  presentationFor,
  type StructurePresentation,
  type System,
} from './material-system.ts';
import { clampDistance, fidelityPolicy, inCloseInspectionBand, type FidelityPolicy } from './fidelity.ts';
import { CAMERA_PRESETS, normalize, type PresetName } from './camera-presets.ts';
import type { AtlasState } from './atlas-state.ts';
import { deriveContext, type ContextClass, type ContextInput } from './context.ts';

/** The atlas manifest's per-structure shape, as far as the renderer uses it. */
export interface ManifestStructure {
  id: string;
  label: string;
  sourceMeshName: string;
  laterality: 'left' | 'right' | 'midline';
  /** The system the viewer colours and layers by. */
  presentationSystem: System;
  presentationSystemClassification?: string | null;
  ontologyFmaVerification?: string | null;
  fma?: { conceptId: string | null; status: string } | null;
  bp?: string | null;
  triangles?: number;
  /**
   * The crosswalk. A structure with `canonicalAsiId: null` may be displayed,
   * searched, hovered, isolated and hidden, but it is NOT legal to write into a
   * SymptomRecord. The renderer never persists anything, so it only needs to know
   * the id for display; the flag is what any future selection-to-record path must
   * check.
   */
  canonicalAsiId?: string | null;
  symptomRecordSelectable?: boolean;
  /**
   * Source-space bounds, in millimetres, plus the same box in render metres.
   *
   * `boundsMm` is gone rather than kept alongside: the Atlas contract states its
   * units explicitly in `coordinateSystem`, and a field named `boundsMm` beside a
   * document that also declares `renderUnits` is how two unit systems get mixed up
   * in the first place. The selective-context code below reads this instead, which
   * is the correct direction -- the consumer adapts to the contract, not the other
   * way round. Relative-neighbour classification only needs relative distances, and
   * millimetres are perfectly good at that.
   */
  sourceBounds?: {
    min: [number, number, number];
    max: [number, number, number];
    renderMin: [number, number, number];
    renderMax: [number, number, number];
  } | null;
}

export interface AtlasManifest {
  schemaVersion: number;
  region: string;
  side: string;
  coordinateSystem: {
    sourceUnits: string;
    renderUnits: string;
    sourceToRenderScale: number;
    glTFYUp: boolean;
    sourceAxes: Record<string, string>;
  };
  atlas: { file: string; objects: number; triangles: number; bytes: number };
  bodyContext: { file: string; objects: number; triangles: number; bytes: number };
  structures: ManifestStructure[];
  unavailableInSource: Array<{ system: string; reason: string; wholeBodySourceCount: number }>;
  provenance: Record<string, string>;
}

export interface AtlasSceneOptions {
  assetRoot: string;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string | null) => void;
  onCamera?: (eye: THREE.Vector3, target: THREE.Vector3) => void;
  onFidelityBand?: (inBand: boolean, policy: FidelityPolicy) => void;
}

export interface SectionOptions {
  enabled: boolean;
  /** 'x' | 'y' | 'z' -- which anatomical axis the cut runs across. */
  axis: 'x' | 'y' | 'z';
  /** 0..1 along that axis. */
  position: number;
  /** Flip which side is kept. */
  flip: boolean;
}

const SECTION_AXIS_INDEX: Record<SectionOptions['axis'], 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

export class AtlasScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  manifest: AtlasManifest | null = null;
  presentations = new Map<string, StructurePresentation>();
  private nodes = new Map<string, THREE.Object3D>();
  private materials = new Map<string, THREE.Material>();
  private bodyNode: THREE.Object3D | null = null;
  private bodyMaterial: THREE.Material | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private frameHandle: number | null = null;
  private disposed = false;
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private sectionBounds = { min: new THREE.Vector3(), max: new THREE.Vector3() };

  policy: FidelityPolicy = fidelityPolicy(0.3);
  /** Radius of the whole body, for the "whole body" framing. */
  bodyRadius = 0.9;
  /** Radius of the shoulder region, for the "shoulder" framing. */
  regionRadius = 0.3;
  regionCentre = new THREE.Vector3();

  constructor(
    private readonly host: HTMLElement,
    private readonly opts: AtlasSceneOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x0e0f11, 1);
    // preserveDrawingBuffer so the canvas can be read back.
    //
    // Without it a WebGL drawing buffer is cleared once it has been presented,
    // and any attempt to sample the canvas afterwards -- drawImage into a 2D
    // context, toDataURL, a visual-regression baseline -- returns empty. The
    // acceptance gate read 0 lit pixels from a canvas that was demonstrably
    // drawing a full shoulder, and nearly reported a working viewer as blank.
    // On a static ~600k triangle scene the cost is small, and being able to
    // verify what is on screen is worth more than the frame time.
    this.renderer.domElement.addEventListener('webglcontextcreationerror', (e) => {
      console.warn('[atlas] webgl context creation failed', e);
    });
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', 'Anatomy model of the right shoulder');
    this.renderer.domElement.setAttribute('role', 'img');

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 60);
    this.camera.position.set(0, 0, 1);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.9;
    this.controls.zoomSpeed = 0.8;
    this.controls.panSpeed = 0.8;
    this.controls.screenSpacePanning = true;

    this.addLights();
    this.bindPointer();
    this.resize();
    this.tick();
  }

  /* ------------------------------------------------------------- lighting */
  private addLights(): void {
    // Neutral three-point rig. White only: a coloured light would make the
    // material palette unreadable, and the palette is the thing under review.
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(-1.1, 1.5, 1.4);
    const fill = new THREE.DirectionalLight(0xffffff, 0.85);
    fill.position.set(1.5, -0.4, 0.9);
    const rim = new THREE.DirectionalLight(0xffffff, 1.15);
    rim.position.set(0.7, 1.2, -1.5);
    const amb = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(key, fill, rim, amb);
  }

  /* --------------------------------------------------------------- loading */

  async load(): Promise<void> {
    const loader = new GLTFLoader();

    // The ATLAS manifest, by name. Never `manifest.json`: that filename in this
    // directory is the canonical asset contract and the viewer has no business
    // reading it.
    const manifest = (await fetch(`${this.opts.assetRoot}atlas-manifest.json`).then((r) => {
      if (!r.ok) throw new Error(`atlas manifest ${r.status}`);
      return r.json();
    })) as AtlasManifest;

    // The axis convention is provenance, not decoration. An importer once rotated
    // the body silently and every camera preset became confidently wrong, so a
    // manifest that does not declare the convention it was exported under is
    // rejected rather than guessed at.
    if (manifest.coordinateSystem?.glTFYUp !== true) {
      throw new Error('atlas manifest does not declare glTFYUp; refusing to guess the orientation');
    }

    this.manifest = manifest;

    for (const s of manifest.structures) {
      this.presentations.set(s.id, presentationFor(s as never));
    }

    const atlas = await loader.loadAsync(`${this.opts.assetRoot}${manifest.atlas.file}`);
    this.adopt(atlas.scene);

    // The body context is optional. If it fails to load the shoulder is still
    // usable; refusing to show the region because the context shell is missing
    // would be a worse failure than showing a region without a body.
    try {
      const body = await loader.loadAsync(`${this.opts.assetRoot}${manifest.bodyContext.file}`);
      this.bodyNode = body.scene;
      this.bodyMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#cdb4a4'),
        roughness: 0.85,
        metalness: 0,
        transparent: true,
        opacity: 0.055,
        depthWrite: false,
        side: THREE.FrontSide,
      });
      this.bodyNode.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = this.bodyMaterial!;
          m.castShadow = false;
          m.receiveShadow = false;
        }
      });
      this.scene.add(this.bodyNode);
      this.bodyRadius = this.radiusOf(this.bodyNode) || 0.9;
    } catch (err) {
      console.warn('[atlas] body context unavailable', err);
    }

    this.computeBounds();
    this.applyClippingBounds();
    this.controls.minDistance = this.policy.minDistance;
    this.controls.maxDistance = this.bodyRadius * 4;
  }

  /**
   * Index a loaded GLB by structure id.
   *
   * Identity comes from `userData.asiId`, which arrives from the glTF `extras`
   * and is not touched by any loader. It deliberately does NOT come from the node
   * name: three.js sanitises node names (PropertyBinding.sanitizeNodeName
   * replaces whitespace and [ . : / ] with "_"), so a node exported as
   * "bp3d:FJ3384" arrives as "bp3d_FJ3384". Keying off the name matched nothing,
   * which meant every mesh rendered with the glTF default white material and no
   * layer or selection could change anything -- while the page looked like it
   * worked. The name is only a fallback for a file exported without extras.
   */
  private adopt(root: THREE.Object3D): void {
    let byUserData = 0;
    let byName = 0;
    root.traverse((o) => {
      const id = (o.userData?.asiId as string | undefined) ?? null;
      let key = id;
      if (!key && /^bp3d[_-]FJ\d+M?$/.test(o.name)) {
        // Fallback: rebuild the canonical id from the sanitised name.
        key = o.name.replace('_', ':');
        byName += 1;
      }
      if (!key) return;
      if (id) byUserData += 1;
      this.nodes.set(key, o);
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
    console.info(
      `[atlas] indexed ${this.nodes.size} structures (${byUserData} by asiId, ${byName} by name)`,
    );
    if (this.nodes.size === 0) {
      throw new Error(
        'No structures were indexed from the atlas GLB. Every mesh would render with the ' +
          'default material and nothing could be shown or hidden. Check that the export ' +
          'carried asi_id in extras.',
      );
    }
    this.scene.add(root);
  }

  private radiusOf(obj: THREE.Object3D): number {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return 0;
    return box.getSize(new THREE.Vector3()).length() / 2;
  }

  private computeBounds(): void {
    const shoulderMeshes = [...this.nodes.keys()].map((k) => this.nodes.get(k)!);
    const box = new THREE.Box3();
    for (const o of shoulderMeshes) box.expandByObject(o);
    if (!box.isEmpty()) {
      box.getCenter(this.regionCentre);
      this.regionRadius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-4);
      this.policy = fidelityPolicy(this.regionRadius);
      this.sectionBounds.min.copy(box.min);
      this.sectionBounds.max.copy(box.max);
    }
  }

  private applyClippingBounds(): void {
    const min = this.sectionBounds.min;
    const max = this.sectionBounds.max;
    this.clipPlane.normal.set(0, 0, -1);
    this.clipPlane.constant = 0;
    this.clipEnabledBounds = { min: min.clone(), max: max.clone() };
  }

  private clipEnabledBounds = { min: new THREE.Vector3(), max: new THREE.Vector3() };

  /* ------------------------------------------------------------- materials */

  private materialFor(id: string): THREE.Material {
    const cached = this.materials.get(id);
    if (cached) return cached;
    const p = this.presentations.get(id);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(p?.colour ?? '#808080'),
      roughness: 0.62,
      metalness: 0.02,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    });
    this.materials.set(id, mat);
    return mat;
  }

  /* ---------------------------------------------------------------- render */

  applyState(state: AtlasState): void {
    // Selective context, not one global ghost opacity. The 42-mesh global version
    // fogged; drawing fewer things is the fix, and `context.ts` decides which.
    const contextInputs: ContextInput[] = [...this.nodes.keys()].map((id) => {
      const p = this.presentations.get(id);
      const s = this.manifest?.structures.find((m) => m.id === id);
      // `sourceBounds`, not the old `boundsMm`. Same millimetre numbers, same tuple
      // shape, so the conversion below is unchanged -- but the name now matches the
      // Atlas contract, and a context shell with no bounds still yields null so it
      // falls back to system-class context rather than a bogus zero-sized box.
      const b = s?.sourceBounds;
      return {
        id,
        system: (p?.system ?? 'organ') as System,
        bounds: b?.min && b?.max
          ? {
              min: { x: b.min[0], y: b.min[1], z: b.min[2] },
              max: { x: b.max[0], y: b.max[1], z: b.max[2] },
            }
          : null,
      };
    });
    const { classes, opacities } = deriveContext(contextInputs, state);

    for (const [id, cls] of classes) {
      const node = this.nodes.get(id);
      if (!node) continue;
      const opacity = opacities.get(id) ?? 0;
      node.visible = cls !== 'hidden' && opacity > 0.001;

      // Assign, not just configure. The GLB is exported with
      // export_materials='NONE' so the presentation layer stays in code, which
      // means every mesh arrives with the glTF default WHITE material. Mutating a
      // MeshStandardMaterial without ever assigning it leaves the whole atlas
      // white -- the grey-blob failure, through the back door.
      const mat = this.materialFor(id);
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh && mesh.material !== mat) mesh.material = mat;

      const std = mat as THREE.MeshStandardMaterial;
      std.opacity = opacity;
      std.transparent = opacity < 0.999;
      // Depth writing on a 15% ghost makes it occlude what is behind it and
      // darkens the context into mud. Only the selection and solid structures
      // write depth.
      std.depthWrite = opacity > 0.6;
      // Selection is an overlay state, never an anatomical colour.
      std.emissive = new THREE.Color(cls === 'selected' ? SELECTION_COLOUR : '#000000');
      std.emissiveIntensity = cls === 'selected' ? 0.55 : 0;
    }

    this.lastState = state;
    this.lastContextClasses = classes;
    this.bodyOpacity = this.bodyOpacityFor(state, classes.get(state.selectedId ?? ''));
    this.applyBodyOpacity();
    this.applyClipping(this.section);
  }

  /**
   * The whole-body shell changes character with the framing.
   *
   * In WHOLE BODY mode it is the subject, so it can be prominent. In SHOULDER mode
   * it is only a spatial reference and was competing with the anatomy for
   * attention, so it drops to a whisper. The numbers are the two states; nothing
   * between them is user-facing.
   */
  private bodyOpacityFor(state: AtlasState, selectedClass?: ContextClass): number {
    if (!state.bodyVisible) return 0;
    // A selection means the person is looking at one structure; the body is then
    // pure reference.
    if (selectedClass === 'selected') return 0.035;
    return this.framing === 'body' ? 0.3 : 0.055;
  }

  private bodyOpacity = 0.16;
  private framing: 'body' | 'region' = 'region';

  /**
   * The last state pushed in, so the shell can be re-evaluated when something
   * OTHER than state changes.
   *
   * This exists because of a real bug. The shell's opacity depends on the framing,
   * and the framing is changed by `frameBody` / `frameRegion` rather than by
   * `applyState`. React ran the two effects in the wrong order relative to each
   * other, so clicking "Whole body" moved the camera and set the framing but never
   * re-ran `applyState` -- leaving the shell at the SHOULDER opacity of 0.055 while
   * the body filled the frame. The atlas gate caught it as "whole body: context is
   * drawn, 1393 lit pixels" against a threshold of 3000.
   *
   * The tempting fix is to lower that threshold. It would have made the gate green
   * while leaving the shell six times too faint in the one framing where it is the
   * subject, so the shell would have been effectively invisible to a person opening
   * the viewer.
   *
   * The scene is now self-consistent instead: anything that changes the framing
   * re-applies the shell itself, and no longer depends on a React effect happening
   * to run in the right order.
   */
  private lastState: AtlasState | null = null;

  /** Re-derive the shell opacity from the current framing and last known state. */
  private refreshBodyOpacity(): void {
    if (!this.lastState) return;
    const selectedId = this.lastState.selectedId;
    const selectedClass =
      selectedId && this.lastContextClasses ? this.lastContextClasses.get(selectedId) : undefined;
    this.bodyOpacity = this.bodyOpacityFor(this.lastState, selectedClass);
    this.applyBodyOpacity();
  }

  private lastContextClasses: Map<string, ContextClass> | null = null;

  setFraming(framing: 'body' | 'region'): void {
    this.framing = framing;
    this.refreshBodyOpacity();
  }

  private applyBodyOpacity(): void {
    if (!this.bodyMaterial) return;
    const std = this.bodyMaterial as THREE.MeshStandardMaterial;
    std.opacity = this.bodyOpacity;
    std.transparent = true;
    // A faint shell must not occlude the anatomy in front of it.
    std.depthWrite = this.bodyOpacity > 0.5;
    if (this.bodyNode) this.bodyNode.visible = this.bodyOpacity > 0.001;
  }

  private section: SectionOptions = { enabled: false, axis: 'x', position: 0.5, flip: false };

  setSection(section: SectionOptions): void {
    this.section = section;
    this.applyClipping(section);
  }

  /**
   * Section view over SURFACE meshes.
   *
   * This is a clipping plane, not an anatomical cross-section. There is no
   * interior data in a surface mesh, so a cut reveals back-faces and nothing
   * else. The UI must call this a section or clipping view and must never call it
   * a CT or MRI slice.
   */
  private applyClipping(section: SectionOptions): void {
    const planes = section.enabled ? [this.clipPlane] : [];
    const { min, max } = this.clipEnabledBounds;
    const i = SECTION_AXIS_INDEX[section.axis];
    const lo = i === 0 ? min.x : i === 1 ? min.y : min.z;
    const hi = i === 0 ? max.x : i === 1 ? max.y : max.z;
    const at = lo + (hi - lo) * section.position;
    const n = this.clipPlane.normal as THREE.Vector3;
    n.set(0, 0, 0);
    n.setComponent(i, section.flip ? 1 : -1);
    this.clipPlane.constant = section.flip ? -at : at;
    for (const m of this.materials.values()) {
      const std = m as THREE.MeshStandardMaterial;
      std.clippingPlanes = planes;
      std.clipShadows = false;
      std.needsUpdate = true;
    }
    if (this.bodyMaterial) {
      const std = this.bodyMaterial as THREE.MeshStandardMaterial;
      std.clippingPlanes = planes;
      std.needsUpdate = true;
    }
  }

  /* ---------------------------------------------------------------- camera */

  /** Frame the whole body. The viewer must never open on a floating shoulder. */
  frameBody(): void {
    this.setFraming('body');
    this.flyTo(new THREE.Vector3(0, 0, 0), this.bodyRadius * 2.1, 'front');
  }

  /** Frame the shoulder region. */
  frameRegion(preset: PresetName = 'front'): void {
    this.setFraming('region');
    this.flyTo(this.regionCentre.clone(), this.regionRadius * 2.6, preset);
  }

  /** Frame one structure, respecting the fidelity floor. */
  frameStructure(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    const box = new THREE.Box3().setFromObject(node);
    if (box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-4);
    // The floor is the honest part: a reduced mesh magnified to fill the frame
    // shows its own facets, so the camera stops at the fidelity limit and the UI
    // says why rather than pretending the detail is there.
    const dist = Math.max(radius * 3.2, this.policy.minDistance);
    this.flyTo(centre, dist, this.currentFacing());
  }

  private currentFacing(): PresetName {
    const d = this.camera.position.clone().sub(this.controls.target);
    if (d.lengthSq() < 1e-12) return 'front';
    const n = normalize({ x: d.x, y: d.y, z: d.z });
    let best: PresetName = 'front';
    let bestDot = -Infinity;
    for (const name of Object.keys(CAMERA_PRESETS) as PresetName[]) {
      const p = CAMERA_PRESETS[name].direction;
      const dot = n.x * p.x + n.y * p.y + n.z * p.z;
      if (dot > bestDot) {
        bestDot = dot;
        best = name;
      }
    }
    return best;
  }

  private flight: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; start: number; ms: number } | null = null;

  private flyTo(target: THREE.Vector3, distance: number, facing: PresetName): void {
    const d = CAMERA_PRESETS[facing].direction;
    const dist = clampDistance(this.policy, distance);
    this.flight = {
      from: this.camera.position.clone(),
      to: new THREE.Vector3(target.x + d.x * dist, target.y + d.y * dist, target.z + d.z * dist),
      tFrom: this.controls.target.clone(),
      tTo: target.clone(),
      start: performance.now(),
      ms: 620,
    };
  }

  /** Snap to a preset without animating. Used by the tests and by reset. */
  setPresetImmediate(preset: PresetName, target = this.regionCentre, distance?: number): void {
    const d = CAMERA_PRESETS[preset].direction;
    const dist = clampDistance(this.policy, distance ?? this.regionRadius * 2.6);
    this.flight = null;
    this.controls.target.copy(target);
    this.camera.position.set(target.x + d.x * dist, target.y + d.y * dist, target.z + d.z * dist);
    this.controls.update();
  }

  /* --------------------------------------------------------------- picking */

  private bindPointer(): void {
    const el = this.renderer.domElement;
    let downAt: { x: number; y: number } | null = null;

    const toNdc = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    };

    el.addEventListener('pointerdown', (ev) => {
      downAt = { x: ev.clientX, y: ev.clientY };
    });

    el.addEventListener('pointerup', (ev) => {
      if (!downAt) return;
      const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
      downAt = null;
      // A drag is an orbit, not a selection. Without this threshold every camera
      // move would also pick whatever happened to be under the cursor.
      if (moved > 5) return;
      toNdc(ev);
      this.opts.onSelect?.(this.pick());
    });

    el.addEventListener('pointermove', (ev) => {
      toNdc(ev);
      const id = this.pick();
      el.style.cursor = id ? 'pointer' : 'grab';
      this.opts.onHover?.(id);
    });

    el.addEventListener('pointerleave', () => this.opts.onHover?.(null));
  }

  /** The structure id under the pointer, or null. */
  pick(): string | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.nodes.values()], true);
    for (const hit of hits) {
      if (!hit.object.visible) continue;
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        if (this.nodes.has(o.name)) return o.name;
        o = o.parent;
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ loop */

  resize(): void {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private tick = (): void => {
    if (this.disposed) return;
    this.frameHandle = requestAnimationFrame(this.tick);

    if (this.flight) {
      const k = Math.min(1, (performance.now() - this.flight.start) / this.flight.ms);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.camera.position.lerpVectors(this.flight.from, this.flight.to, e);
      this.controls.target.lerpVectors(this.flight.tFrom, this.flight.tTo, e);
      if (k >= 1) this.flight = null;
    }

    this.controls.update();

    // Fidelity floor, enforced every frame so it holds through orbit, dolly and
    // keyboard alike.
    const offset = this.camera.position.clone().sub(this.controls.target);
    const dist = offset.length();
    const clamped = clampDistance(this.policy, dist);
    if (Math.abs(clamped - dist) > 1e-6) {
      this.camera.position.copy(this.controls.target).add(offset.setLength(clamped));
    }
    this.opts.onFidelityBand?.(inCloseInspectionBand(this.policy, clamped), this.policy);
    this.opts.onCamera?.(this.camera.position, this.controls.target);

    this.renderer.render(this.scene, this.camera);
  };

  /** Every structure id in the scene, for the search index. */
  ids(): string[] {
    return [...this.nodes.keys()];
  }

  get structureCount(): number {
    return this.nodes.size;
  }

  dispose(): void {
    this.disposed = true;
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry?.dispose();
    });
    for (const m of this.materials.values()) m.dispose();
    this.bodyMaterial?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
