/**
 * AnatomyWorkspace — the seam between the UI and whichever renderer is alive.
 *
 * State has exactly one authority: the session's `anatomy` adapter. The 3D
 * viewer is a PROJECTION of it, not a second copy. Two writable copies of
 * viewer state is precisely the failure this project already suffered once with
 * selection, so the rule here is that a renderer may read state and may report a
 * pick, but only the source adapter is ever written to.
 *
 * The fallback rule is the other load-bearing part: 3D is an enhancement, never
 * a prerequisite. If the GPU is missing, the context is lost, the manifest fails
 * to validate or the mesh build throws, the workspace lands on the 2D map and
 * says so in words. A Locate screen must never be a blank canvas.
 */
import { Three3dAnatomyAdapter } from './three3d.ts';
import type { RendererSceneManifest } from './scene-manifest.ts';
import { FIXTURE_MANIFEST } from './fixture-manifest.ts';
import type {
  AnatomyAdapter,
  CameraPreset,
  MapPoint,
  PickResult,
  RenderedViewer,
  ViewerCommand,
  ViewerState,
} from './types.ts';

export type ViewerMode = '3d' | '2d';

export type FallbackReason =
  | 'no-webgl'
  | 'context-lost'
  | 'manifest-invalid'
  | 'mount-failed'
  | 'unsupported-device'
  | 'user-choice'
  | null;

export interface WorkspaceStatus {
  mode: ViewerMode;
  ready: boolean;
  fallbackReason: FallbackReason;
  /** Non-null while the manifest is a fixture; the UI must show it. */
  disclaimer: string | null;
  /** What the user should be told, in plain words. */
  message: string | null;
  /** True once the canvas has actually drawn something. */
  rendered: boolean;
}

const MESSAGES: Record<Exclude<FallbackReason, null>, string> = {
  'no-webgl': 'This device cannot draw the 3D model, so the body map is being used instead.',
  'context-lost': 'The 3D view stopped responding, so the body map is being used instead.',
  'manifest-invalid': 'The 3D model could not be prepared, so the body map is being used instead.',
  'mount-failed': 'The 3D view could not start, so the body map is being used instead.',
  'unsupported-device': '3D is not offered on this device, so the body map is being used instead.',
  'user-choice': 'Using the body map instead of the 3D view.',
};

export interface WorkspaceOptions {
  manifest?: RendererSceneManifest;
  /** Force the next start() to fail, for fallback tests. */
  failMount?: boolean;
  /**
   * Injected in tests: build the viewer instead of constructing one. The viewer
   * is still mounted and still has to succeed, so the fallback path under test is
   * the real one. Lets a headless test drive source -> renderer without a GPU.
   */
  createViewer?: (host: HTMLElement) => Promise<Three3dAnatomyAdapter>;
}

export class AnatomyWorkspace {
  private source: AnatomyAdapter;
  private manifest: RendererSceneManifest;
  private viewer: Three3dAnatomyAdapter | null = null;
  private status: WorkspaceStatus;
  private listeners = new Set<(status: WorkspaceStatus) => void>();
  private detachSource: (() => void) | null = null;
  private detachViewer: (() => void) | null = null;
  private lastCommands: ViewerCommand[] = [];
  private view: CameraPreset = 'anterior';
  private failMount: boolean;
  private opts: WorkspaceOptions;
  private disposed = false;

  constructor(source: AnatomyAdapter, opts: WorkspaceOptions = {}) {
    this.source = source;
    this.manifest = opts.manifest ?? FIXTURE_MANIFEST;
    this.failMount = opts.failMount ?? false;
    this.opts = opts;
    this.status = {
      mode: '2d',
      ready: false,
      fallbackReason: null,
      disclaimer: this.disclaimer(),
      message: null,
      rendered: false,
    };
  }

  private disclaimer(): string | null {
    return this.manifest.source === 'fixture' ? this.manifest.disclaimer ?? null : null;
  }

  /**
   * Try to bring up the 3D viewer. Always resolves: a failure is a mode change,
   * not an exception, because the caller's only useful recovery is to continue
   * on the 2D map.
   */
  async start(host: HTMLElement, opts: { prefer3d?: boolean } = {}): Promise<WorkspaceStatus> {
    if (opts.prefer3d === false) {
      this.setStatus({ mode: '2d', ready: true, fallbackReason: 'user-choice', message: MESSAGES['user-choice'] });
      return this.status;
    }
    let candidate: Three3dAnatomyAdapter | null = null;
    try {
      candidate = this.opts.createViewer
        ? await this.opts.createViewer(host)
        : new Three3dAnatomyAdapter({
            manifest: this.manifest,
            failMount: this.failMount,
            onContextLost: () => this.reportContextLost(),
          });
      if (!candidate.isLive()) await candidate.mount(host);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const reason: FallbackReason = /WebGL unavailable/.test(message)
        ? 'no-webgl'
        : /manifest|asiId|disclaimer/i.test(message)
          ? 'manifest-invalid'
          : 'mount-failed';
      // A viewer that failed may still hold a canvas, so always release it.
      try {
        candidate?.dispose();
      } catch {
        /* nothing to release if it never mounted */
      }
      this.setStatus({ mode: '2d', ready: true, fallbackReason: reason, message: MESSAGES[reason] });
      return this.status;
    }

    this.viewer = candidate;
    // mount() is async, so a component that unmounted while it was in flight
    // will already have called dispose(). Adopting the viewer now would leak a
    // canvas and a render loop that nothing can ever stop, which is exactly what
    // React's double-invoked effects would otherwise produce on every mount.
    if (this.disposed || !host.isConnected) {
      this.detachSource = null;
      this.detachViewer = null;
      candidate.dispose();
      this.viewer = null;
      this.setStatus({ mode: '2d', ready: true, fallbackReason: 'mount-failed', message: MESSAGES['mount-failed'] });
      return this.status;
    }
    this.detachSource = this.source.subscribe((state) => this.project(state));
    this.detachViewer = candidate.subscribe(() => this.setStatus({ ...this.status, rendered: true }));
    this.project(this.source.getState());
    // Adopt whatever view the source is already on, so the 3D camera does not
    // start at the front while the 2D map is showing the back.
    this.view = (this.source as { getView?: () => CameraPreset }).getView?.() ?? this.view;
    candidate.focusCamera(this.view, { immediate: true });
    this.setStatus({ mode: '3d', ready: true, fallbackReason: null, message: null });
    return this.status;
  }

  /**
   * Project the source state onto the 3D viewer.
   *
   * This is a REPLACEMENT, not a replay of commands. Every command in the
   * vocabulary is additive, so replaying one could only ever leave the viewer
   * holding MORE than the source: layers it should have dropped, a selection the
   * record has removed, a pin that was cleared. projectState copies the snapshot
   * and re-derives the scene from it, so the two states are equal afterwards.
   */
  private project(state: ViewerState): void {
    const viewer = this.viewer;
    if (!viewer?.isLive()) return;
    viewer.projectState(state);
  }

  getStatus(): WorkspaceStatus {
    return this.status;
  }

  subscribe(fn: (status: WorkspaceStatus) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.status);
  }

  private setStatus(next: Partial<WorkspaceStatus>): void {
    this.status = { ...this.status, disclaimer: this.disclaimer(), ...next };
    this.emit();
  }

  /** Drop to 2D, keeping the record state, and say why. */
  fallbackTo2d(reason: Exclude<FallbackReason, null>): WorkspaceStatus {
    this.teardown3d();
    this.setStatus({ mode: '2d', ready: true, fallbackReason: reason, message: MESSAGES[reason], rendered: false });
    return this.status;
  }

  /** Report a lost GPU context from the canvas' own event. */
  reportContextLost(): WorkspaceStatus {
    return this.fallbackTo2d('context-lost');
  }

  private teardown3d(): void {
    this.detachSource?.();
    this.detachViewer?.();
    this.detachSource = null;
    this.detachViewer = null;
    if (this.viewer) {
      this.viewer.dispose();
      this.viewer = null;
    }
    this.setStatus({ rendered: false });
  }

  get mode(): ViewerMode {
    return this.status.mode;
  }

  /** The 3D viewer when it is live, otherwise null. Never the source adapter. */
  get renderer(): RenderedViewer | null {
    return this.viewer?.isLive() ? this.viewer : null;
  }

  get manifestRef(): RendererSceneManifest {
    return this.manifest;
  }

  getState(): ViewerState {
    return this.source.getState();
  }

  /** Every write goes to the single authority; the 3D viewer follows. */
  apply(cmd: ViewerCommand): void {
    this.lastCommands.push(cmd);
    this.source.apply(cmd);
  }

  recentCommands(): ViewerCommand[] {
    return [...this.lastCommands];
  }

  setView(view: CameraPreset): void {
    // The camera is view-level UI state, not record state, so it is tracked here
    // and never replayed from ViewerState.
    this.view = view;
    this.viewer?.focusCamera(view);
    this.source.apply({ type: 'setView', view });
  }

  getView(): CameraPreset {
    return this.view;
  }

  /**
   * Resolve a canvas click. Returns the sub-region so the caller can write it to
   * the single authority; the workspace deliberately does not write it itself,
   * so there is still exactly one path that mutates viewer state.
   */
  pick(clientX: number, clientY: number): PickResult {
    return this.renderer?.pick(clientX, clientY) ?? { kind: 'none' };
  }

  projectPin(point: MapPoint): MapPoint | null {
    return this.renderer?.projectPin(point) ?? null;
  }

  /** Keep the 3D camera in step with the canvas box. */
  resize(width: number, height: number): void {
    const renderer = this.renderer;
    if (!renderer) return;
    renderer.resize(width, height);
    // The framing maths depends on aspect, so a resize has to re-frame or the
    // region drifts out of shot when the window changes shape.
    this.viewer?.focusCamera(this.view, { immediate: true });
  }

  /** asiIds the keyboard path should offer, in a stable order. */
  keyboardOrder(): string[] {
    const viewer = this.renderer;
    if (viewer && typeof (viewer as { keyboardOrder?: () => string[] }).keyboardOrder === 'function')
      return (viewer as unknown as { keyboardOrder: () => string[] }).keyboardOrder();
    return [];
  }

  dispose(): void {
    this.disposed = true;
    this.teardown3d();
    this.listeners.clear();
    this.lastCommands = [];
  }
}
