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
import type { AssetManifest, BodyRegion, Side } from '@asi/shared';
import { FIXTURE_MANIFEST } from './fixture-manifest.ts';
import { toRendererScene, isSyntheticManifest } from './asset-scene-adapter.ts';
import type { RendererSceneManifest } from './scene-manifest.ts';
import {
  CANONICAL_ANATOMY_MANIFEST as LEFT_MANIFEST,
  CANONICAL_ASSET_ROOT as LEFT_ASSET_ROOT,
  CANONICAL_SIDE as LEFT_SIDE,
} from './generated/canonical-manifest.left.ts';
import {
  CANONICAL_ANATOMY_MANIFEST as RIGHT_MANIFEST,
  CANONICAL_ASSET_ROOT as RIGHT_ASSET_ROOT,
  CANONICAL_SIDE as RIGHT_SIDE,
} from './generated/canonical-manifest.right.ts';

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
function buildProductionScene(side: 'left' | 'right'): RendererSceneManifest {
  let canonical: AssetManifest;
  const raw = side === LEFT_SIDE ? LEFT_MANIFEST : RIGHT_MANIFEST;
  const assetRoot = side === LEFT_SIDE ? LEFT_ASSET_ROOT : RIGHT_ASSET_ROOT;
  try {
    canonical = parseManifest(raw);
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

  // The build flag and the manifest have to agree. The side is a fact the source
  // mapping established when it chose which real mesh to load; a `--side right`
  // build whose manifest says `left` is a mislabeled build, and shipping it would put
  // right-labelled anatomy on screen with left provenance.
  const claimed = [...new Set(canonical.entries.map((e) => e.laterality))];
  if (claimed.length !== 1 || claimed[0] !== side)
    throw new Error(
      `the generated ${side} manifest carries laterality ${claimed.join('/')}. The side is a ` +
        `fact from the source mapping, not a label, so this build is refused rather than ` +
        `displayed. Rebuild it with scripts/build-anatomy.mjs --side ${side}.`,
    );

  const scene = toRendererScene(canonical, { assetRoot });
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

/**
 * The real scenes, one per side, built from their own canonical manifests.
 *
 * ## Why there is no single ACTIVE_SCENE any more
 *
 * One scene was honest while only the left side existed. With both sides built it
 * stops being honest, because "the scene" has to be a guess: the app would be
 * rendering left anatomy for a user whose record says right, or rendering left
 * anatomy for a user who never said. Both would look entirely correct on screen,
 * which is what makes the mistake hard to see.
 *
 * So the side is a parameter here and the caller has to pass one. There is no
 * default, and `sceneFor` below refuses anything it cannot answer honestly.
 */
export const PRODUCTION_SCENES: {
  readonly left: RendererSceneManifest;
  readonly right: RendererSceneManifest;
} = {
  left: buildProductionScene('left'),
  right: buildProductionScene('right'),
};

/**
 * What the viewer should show for a given record side, and why.
 *
 * Every outcome is named, because the alternative is the app choosing a side
 * silently. A user with no side recorded would otherwise get whichever shoulder
 * happened to be first in the object literal, and would have no way to know that the
 * geometry they clicked belongs to a side they never confirmed.
 *
 * - `left` / `right`: the real scene for that side.
 * - `needs-side`: `unknown`, or `bilateral` when only one side's geometry is asked
 *   for. The honest answer is to ask, because we genuinely do not know.
 * - `both`: `bilateral`, with both real scenes available, so nothing is invented and
 *   nothing is withheld. Both are real source geometry, never one mirrored.
 * - `none`: `midline`. Midline structures have no side, and inventing one would be a
 *   fabrication. The 2D map and the interview still work; there is simply no
 *   one-sided 3D scene to show.
 */
export type SceneSelection =
  | { kind: 'scene'; side: 'left' | 'right'; scene: RendererSceneManifest }
  | { kind: 'both'; sides: readonly ('left' | 'right')[]; scenes: RendererSceneManifest[] }
  | { kind: 'needs-side'; reason: string }
  | { kind: 'none'; reason: string };

export function sceneFor(side: Side): SceneSelection {
  if (side === 'left') return { kind: 'scene', side: 'left', scene: PRODUCTION_SCENES.left };
  if (side === 'right') return { kind: 'scene', side: 'right', scene: PRODUCTION_SCENES.right };
  if (side === 'bilateral')
    return {
      kind: 'both',
      sides: ['left', 'right'],
      scenes: [PRODUCTION_SCENES.left, PRODUCTION_SCENES.right],
    };
  if (side === 'midline')
    return {
      kind: 'none',
      reason:
        'Midline structures have no side, and the shoulder assets are one-sided, so there is no ' +
        '3D scene to show. The map and the questions still work.',
    };
  return {
    kind: 'needs-side',
    reason:
      'Which shoulder? The 3D viewer shows real anatomy for one side at a time, and picking a ' +
        'side here is not a guess we can make for you.',
  };
}

/**
 * The single scene to render when only one is mountable.
 *
 * Kept for the many call sites that have no record side to work from (the library
 * grid, the anatomy reference, tests that are not about laterality). It is the LEFT
 * scene, named as a choice rather than hidden as a default, and callers that DO have
 * a record side must use `sceneFor` instead.
 */
export const ACTIVE_SCENE: RendererSceneManifest = PRODUCTION_SCENES.left;

/**
 * Regions the production scene actually covers.
 *
 * Read from the scene rather than declared, so the 2D fallback and the geometry
 * cannot disagree about which body areas have real assets.
 */
export function activeRegions(side: Side = 'left'): BodyRegion[] {
  return [...new Set(scenesFor(side).flatMap((s) => s.entries.map((e) => e.region)))];
}

/** `asi:` ids the production scene for `side` can render in 3D. */
export function activeStructureIds(side: Side = 'left'): string[] {
  return [
    ...new Set(
      scenesFor(side).flatMap((s) =>
        s.entries.filter((e) => e.kind === 'structure' && e.structureId).map((e) => e.structureId!),
      ),
    ),
  ];
}

/** The real scenes a record side may be shown, always at least one for left/right. */
export function scenesFor(side: Side): RendererSceneManifest[] {
  const selection = sceneFor(side);
  if (selection.kind === 'scene') return [selection.scene];
  if (selection.kind === 'both') return selection.scenes;
  return [];
}

/**
 * The sides the app can actually show real geometry for.
 *
 * Read from the built scenes rather than declared as `['left', 'right']`, so a side
 * whose build failed to load cannot be advertised. `assertProductionSceneIsReal` has
 * already run on each by the time this is called.
 */
export function availableProductionSides(): ('left' | 'right')[] {
  return (['left', 'right'] as const).filter((side) => {
    const scenes = scenesFor(side);
    return scenes.length > 0 && scenes.every((s) => s.entries.length > 0);
  });
}