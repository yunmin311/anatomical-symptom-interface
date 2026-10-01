/**
 * The renderer scene this build is actually showing.
 *
 * One module so the viewer, the workspace and the attribution panel cannot end up
 * describing DIFFERENT geometry. That failure is quiet: the canvas shows one
 * asset while the licence line names another, and nothing would report it.
 *
 * Phase 1A has no real asset, so this is the fixture. When the BodyParts3D archive
 * arrives the change is confined to this file, and it will be a conversion rather
 * than a hand-built scene:
 *
 *   import { parseManifest } from '@asi/shared';
 *   import { toRendererScene } from './asset-scene-adapter.ts';
 *   const canonical = parseManifest(await (await fetch(MANIFEST_URL)).json());
 *   export const ACTIVE_SCENE = toRendererScene(canonical, { assetRoot: '/anatomy/' });
 *
 * The point of routing it through the adapter rather than writing a scene here is
 * that a hand-built scene is how a renderer ends up holding geometry the pipeline
 * never produced, with nobody able to say where it came from.
 */
import { FIXTURE_MANIFEST } from './fixture-manifest.ts';
import type { RendererSceneManifest } from './scene-manifest.ts';

/** The scene every surface must agree on. */
export const ACTIVE_SCENE: RendererSceneManifest = FIXTURE_MANIFEST;

/** Alias kept short for call sites that render it. */
export const SCENE = ACTIVE_SCENE;