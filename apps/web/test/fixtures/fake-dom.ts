/**
 * A DOM small enough to mount a real viewer in node.
 *
 * The 3D adapter needs a host element, a canvas it can append and remove, and a
 * WebGL renderer that satisfies its calls without drawing anything. None of that
 * is what these tests are about, and all of it used to be copy-pasted per test
 * file — which meant a fix to the fake could land in one file and leave the other
 * silently testing a different mount path.
 *
 * It is deliberately faithful where faithfulness matters: remove() DETACHES from
 * the parent rather than just marking itself, because a canvas that is still
 * attached after dispose is exactly the leak the resource tests look for, and a
 * fake that only marked itself would hide it.
 */
import * as THREE from 'three';

export class FakeElement {
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
  /** Mirrors real DOM: remove() detaches, it does not just mark. */
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
  /** True DOM exposes isConnected; the workspace reads it after mount(). */
  get isConnected(): boolean {
    return this.connected;
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
  setAttribute(): void {}
  focus(): void {}
}

/** Enough of a WebGLRenderer that the adapter never draws a pixel. */
export function stubRenderer(host?: FakeElement): THREE.WebGLRenderer {
  void host;
  const canvas = new FakeElement() as unknown as HTMLElement;
  return {
    domElement: canvas,
    setPixelRatio: () => {},
    setSize: () => {},
    setClearColor: () => {},
    render: () => {},
    dispose: () => {},
  } as unknown as THREE.WebGLRenderer;
}

/** A host a viewer can be mounted into, cast for the adapter's signature. */
export function fakeHost(): FakeElement {
  return new FakeElement();
}

export function asElement(el: FakeElement): HTMLElement {
  return el as unknown as HTMLElement;
}