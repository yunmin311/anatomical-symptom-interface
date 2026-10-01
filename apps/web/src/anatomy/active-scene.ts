/**
 * The renderer scene this build is actually showing.
 *
 * One module so the viewer, the workspace and the attribution panel cannot end up
 * describing DIFFERENT geometry. That failure is quiet: the canvas shows one asset
 * while the licence line names another, and nothing would report it.
 *
 * ## The production scene is the canonical manifest, converted
 *
 * The generated manifest is imported as DATA and run through the real contract at
 * module load — `parseManifest` validates it against the domain and the geometry
 * budget, and `toRendererScene` converts it. There is no hand-built scene to drift
 * from the pipeline: the viewer renders what the pipeline produced, or the import
 * throws.
 *
 * That ordering is deliberate. `parseManifest` first means an entry naming an
 * `asiId` the domain does not have, a layer that disagrees with the ontology, or an
 * over-budget mesh stops the app at import rather than rendering something at the
 * origin.
 *
 * ## Where the synthetic fixture went
 *
 * `FIXTURE_SCENE` below is still exported, and it is still used — by the browser
 * gates and the headless adapter tests. It is a FIXTURE, kept for rendering,
 * interaction, picking and adapter tests, and it is never what the product renders.
 * `assertProductionSceneIsReal` is the guard: the production scene is rejected if it
 * carries synthetic provenance, so a fixture cannot silently become anatomy.
 *
 * Provenance of the current generated scene:
 *   BodyParts3D 4.0, Database Center for Life Science, CC BY 4.0.
 * See assets/anatomy/README.md for the archive and licence.
 */
import { parseManifest } from '@asi/shared';
import type { AssetManifest, BodyRegion } from '@asi/shared';
import { FIXTURE_MANIFEST } from './fixture-manifest.ts';
import { toRendererScene, isSyntheticManifest } from './asset-scene-adapter.ts';
import type { RendererSceneManifest } from './scene-manifest.ts';
import {
  CANONICAL_ANATOMY_MANIFEST,
  CANONICAL_ASSET_ROOT,
} from './generated/canonical-manifest.ts';

/**
 * The synthetic fixture. Rendering, interaction, picking and adapter tests only.
 *
 * Exported so tests can ask for it explicitly rather than reaching whatever the app
 * happens to be showing — a test that silently inherited the real scene would stop
 * testing geometry that has known gaps.
 */
export const FIXTURE_SCENE: RendererSceneManifest = FIXTURE_MANIFEST;

/**
 * Parse and convert the generated manifest, or explain precisely why it cannot be
 * used.
 *
 * The errors are kept whole rather than collapsed, because a build that cannot
 * activate its anatomy assets is a different problem from a build with a broken one,
 * and the message should say which.
 */
function buildProductionScene(): RendererSceneManifest {
  let canonical: AssetManifest;
  try {
    canonical = parseManifest(CANONICAL_ANATOMY_MANIFEST);
  } catch (error) {
    throw new Error(
      `the generated anatomy manifest does not satisfy the canonical contract, so no anatomy ` +
        `scene was built. Regenerate it with scripts/build-anatomy.mjs.\n` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (isSyntheticManifest(canonical))
    throw new Error(
      'the generated anatomy manifest is SYNTHETIC test geometry, so it will not become the ' +
        'production scene. Run scripts/embed-anatomy-manifest.mjs on a real generated manifest.',
    );

  const scene = toRendererScene(canonical, { assetRoot: CANONICAL_ASSET_ROOT });
  assertProductionSceneIsReal(scene);
  return scene;
}

/**
 * Guard, exported for tests and for the gates.
 *
 * The failure this prevents is not a crash: it is a fixture quietly standing in for
 * anatomy, which renders perfectly and is entirely fabricated.
 */
export function assertProductionSceneIsReal(scene: RendererSceneManifest): void {
  if (scene.source === 'fixture')
    throw new Error(
      'the production scene is a FIXTURE. Synthetic geometry may be rendered by tests and must ' +
        'never reach the anatomy library as medical content.',
    );
  if (scene.attribution?.synthetic)
    throw new Error('the production scene carries synthetic provenance.');
  if (!scene.attribution)
    throw new Error(
      'the production scene has no attribution. Loading anatomy geometry that cannot be ' +
        'attributed is how an uncredited asset ships.',
    );
}

/** The scene the product renders. Built from the canonical manifest, once. */
export const ACTIVE_SCENE: RendererSceneManifest = buildProductionScene();

/**
 * Regions the production scene actually covers.
 *
 * Read from the scene rather than declared, so the 2D fallback and the geometry
 * cannot disagree about which body areas have real assets.
 */
export function activeRegions(): BodyRegion[] {
  return [...new Set(ACTIVE_SCENE.entries.map((e) => e.region))];
}

/** `asi:` ids the production scene can render in 3D. */
export function activeStructureIds(): string[] {
  return ACTIVE_SCENE.entries
    .filter((e) => e.kind === 'structure' && e.structureId)
    .map((e) => e.structureId!);
}