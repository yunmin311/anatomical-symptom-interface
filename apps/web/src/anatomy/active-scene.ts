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
  CANONICAL_ANATOMY_MANIFEST as SHOULDER_LEFT,
  CANONICAL_ASSET_ROOT as SHOULDER_LEFT_ROOT,
} from './generated/canonical-manifest.shoulder.left.ts';
import {
  CANONICAL_ANATOMY_MANIFEST as SHOULDER_RIGHT,
  CANONICAL_ASSET_ROOT as SHOULDER_RIGHT_ROOT,
} from './generated/canonical-manifest.shoulder.right.ts';
import {
  CANONICAL_ANATOMY_MANIFEST as NECK_LEFT,
  CANONICAL_ASSET_ROOT as NECK_LEFT_ROOT,
} from './generated/canonical-manifest.neck.left.ts';
import {
  CANONICAL_ANATOMY_MANIFEST as NECK_RIGHT,
  CANONICAL_ASSET_ROOT as NECK_RIGHT_ROOT,
} from './generated/canonical-manifest.neck.right.ts';

/**
 * The generated manifests, keyed by region and side.
 *
 * Declared as a table rather than as four loose constants because the region is part of
 * a scene's identity: a scene is not "the left scene", it is "the left neck scene", and
 * a lookup that could be asked for the wrong region would quietly answer with the right
 * anatomy. The key type makes that a type error instead.
 *
 * Adding a region means adding four imports and one row here, and the map is
 * `satisfies Record<...>` so a missing region is caught at build time rather than at
 * the moment a user opens that part of the body.
 */
/**
 * The two sides a scene can be built for, plus the two that are not sides at all.
 *
 * A separate type from `Side` on purpose: `Side` is the RECORD's vocabulary and
 * includes 'unknown' and 'midline', neither of which is something a build can be asked
 * for. A `midline` build exists -- the cervical vertebrae are real, midline geometry --
 * but it is a build choice, not a side a user can be on.
 */
type ProductionSide = 'left' | 'right' | 'midline';

/**
 * The production scene registry, typed on `BodyRegion`.
 *
 * `Partial`, and that is the whole design: the registry holds only the regions that
 * currently have real built geometry, so a region is added by building it, not by
 * declaring it. A `Record<BodyRegion, ...>` would force an entry for lower_back and
 * knee today, and the cheapest way to satisfy that is a placeholder scene -- which is
 * the fabricated-anatomy failure this whole architecture exists to prevent.
 *
 * The keys are typed, so `sceneFor('sholder', 'left')` is a compile error rather than a
 * scene that quietly returns whatever `PRODUCTION_SCENES['sholder']` happens to be.
 * The previous version was `Record<string, ...>` and its comment claimed the opposite;
 * the claim was false and is now enforced.
 *
 * Runtime input still validates rather than casting: `asBodyRegion` below is the only
 * way a string becomes one, and it returns undefined for anything it does not know.
 */
type ProductionSceneRegistry = Partial<
  Record<BodyRegion, Partial<Record<ProductionSide, { manifest: AssetManifest; assetRoot: string }>>>
>;

const GENERATED: ProductionSceneRegistry = {
  shoulder: {
    left: { manifest: SHOULDER_LEFT, assetRoot: SHOULDER_LEFT_ROOT },
    right: { manifest: SHOULDER_RIGHT, assetRoot: SHOULDER_RIGHT_ROOT },
  },
  neck: {
    left: { manifest: NECK_LEFT, assetRoot: NECK_LEFT_ROOT },
    right: { manifest: NECK_RIGHT, assetRoot: NECK_RIGHT_ROOT },
  },
};

/**
 * Parse an untrusted string into a `BodyRegion`.
 *
 * The ONLY conversion from string to `BodyRegion` in this file. It returns undefined
 * for anything unrecognised rather than casting, because a cast would let a typo
 * through the type system and into a scene lookup -- which is exactly what typing the
 * registry was supposed to prevent.
 */
export function asBodyRegion(value: string | null | undefined): BodyRegion | undefined {
  return typeof value === 'string' && value in GENERATED ? (value as BodyRegion) : undefined;
}

/** Regions with real, built geometry, as a TYPED collection. */
export const PRODUCTION_REGIONS: readonly BodyRegion[] = Object.keys(GENERATED) as BodyRegion[];

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
function buildProductionScene(region: BodyRegion, side: ProductionSide): RendererSceneManifest {
  let canonical: AssetManifest;
  const source = GENERATED[region]?.[side];
  if (!source)
    throw new Error(
      `no generated anatomy for ${region}/${side}. Rebuild it with ` +
        `scripts/build-anatomy.mjs --region ${region} --side ${side} then ` +
        `scripts/embed-anatomy-manifest.mjs --region ${region} --side ${side}.`,
    );
  const { assetRoot } = source;
  try {
    canonical = parseManifest(source.manifest);
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

  // Per-ENTRY, not per-manifest, and for the same reason the embed gate checks it that
  // way: a left neck scene legitimately contains left structures AND the midline
  // cervical spine, because a person looking at their left neck still has vertebrae
  // behind the muscles.
  //
  // The rule that must still hold is the important one: no entry may claim the OTHER
  // side. That is a real error -- right anatomy in a left scene is wrong anatomy on
  // screen -- and it is the only thing this check is for.
  const wrongSide = canonical.entries.filter(
    (e) => e.laterality !== side && e.laterality !== 'midline',
  );
  if (wrongSide.length)
    throw new Error(
      `the generated ${side} manifest carries ${wrongSide.length} entr${
        wrongSide.length === 1 ? 'y' : 'ies'
      } of another side: ${wrongSide.map((e) => `${e.asiId}=${e.laterality}`).join(', ')}. ` +
        `The side is a fact from the source mapping, not a label, so this build is refused ` +
        `rather than displayed. Rebuild it with scripts/build-anatomy.mjs --side ${side}.`,
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
 * Every real scene, built from its own canonical manifest, keyed by region and side.
 *
 * Built eagerly and once. `assertProductionSceneIsReal` has run on each of them by the
 * time this object exists, so a fixture cannot be in here even if a manifest were
 * somehow to contain one.
 *
 * ## Why the region is part of the key
 *
 * With one region, "the scene" was ambiguous but harmless: there was only one answer.
 * With four regions it stops being harmless, because the wrong key would return real
 * anatomy from the wrong body part — a neck scene rendered for a shoulder complaint.
 * Nothing about that would look wrong, which is the reason the key is typed rather
 * than assembled from strings.
 */
export const PRODUCTION_SCENES: Readonly<
  Partial<Record<BodyRegion, Partial<Record<ProductionSide, RendererSceneManifest>>>>
> = Object.fromEntries(
  PRODUCTION_REGIONS.map((region) => [
    region,
    Object.fromEntries(
      (['left', 'right', 'midline'] as const)
        // A region only has the builds it was actually built for. A region with no
        // midline geometry simply has no midline key, so `sceneFor` can say so rather
        // than handing back a scene that claims to show midline anatomy.
        .filter((side) => GENERATED[region]?.[side])
        .map((side) => [
          side,
          buildProductionScene(region, side),
        ]),
    ),
  ]),
) as ProductionScenes;

/**
 * What the viewer should show for a given region and side, and why.
 *
 * Every outcome is NAMED, because the alternative is the app choosing silently. A user
 * with no side recorded would otherwise get whichever scene happened to be first, and
 * would have no way to know the geometry they clicked belongs to a side they never
 * confirmed. Same for a region we have not built.
 *
 * - `scene`: the real scene for that region and side.
 * - `both`: `bilateral`, with both real scenes, so nothing is invented and nothing is
 *   withheld. Both are real source geometry, never one mirrored.
 * - `needs-side`: the side is `unknown`. We genuinely do not know, and one-sided
 *   geometry cannot stand in for "either side".
 * - `needs-region`: the region has no built geometry yet. This is the honest answer for
 *   lower_back and knee while their mapping is still an empty table, and it falls back
 *   to the 2D map rather than to invented 3D.
 * - `none`: `midline`, or a region/side combination with no one-sided representation.
 *
 * `midline` deserves a note. It is not the same as `needs-side`: a midline concept has
 * no side by definition, so asking the user which side is a nonsense question. When a
 * region later gets midline geometry (the cervical vertebrae are the first candidate),
 * this becomes `scene` and nothing else has to change.
 */
export type SceneSelection =
  | { kind: 'scene'; region: BodyRegion; side: ProductionSide; scene: RendererSceneManifest }
  | {
      kind: 'both';
      region: BodyRegion;
      sides: readonly ProductionSide[];
      scenes: RendererSceneManifest[];
    }
  | { kind: 'needs-side'; region: BodyRegion; reason: string }
  | { kind: 'needs-region'; region: BodyRegion; reason: string }
  | { kind: 'none'; region: BodyRegion; reason: string };

/** The shape `PRODUCTION_SCENES` actually has: partial in both axes, by design. */
type ProductionScenes = Readonly<
  Partial<Record<BodyRegion, Partial<Record<ProductionSide, RendererSceneManifest>>>>
>;

/** True when a region has a built scene for both sides. */
export function hasProductionScenes(region: BodyRegion): boolean {
  const entry = PRODUCTION_SCENES[region];
  return Boolean(entry && (entry.left ?? entry.right));
}

/** Which lateralities a region has REAL geometry for. Never assumed. */
export function productionSidesFor(region: BodyRegion): ProductionSide[] {
  const entry = PRODUCTION_SCENES[region];
  if (!entry) return [];
  return (['left', 'right', 'midline'] as const).filter((side) => Boolean(entry[side]));
}

export function sceneFor(region: BodyRegion, side: Side): SceneSelection {
  const built = PRODUCTION_SCENES[region];

  if (!hasProductionScenes(region))
    return {
      kind: 'needs-region',
      region,
      reason:
        `There is no real 3D anatomy for the ${region.replace(/_/g, ' ')} yet, and inventing it ` +
        `is not something this tool will do. The body map and the questions below still work.`,
    };

  if (side === 'left') return { kind: 'scene', region, side: 'left', scene: built!.left! };
  if (side === 'right') return { kind: 'scene', region, side: 'right', scene: built!.right! };
  if (side === 'midline') {
    // A REAL midline scene when the region has one. The cervical vertebrae are midline
    // geometry that exists, and saying "no 3D" about them because they have no side
    // would be the same error as refusing to load a structure because it is not
    // left or right.
    if (built!.midline) return { kind: 'scene', region, side: 'midline', scene: built!.midline };
    return {
      kind: 'none',
      region,
      reason:
        'Midline structures for this region have not been built yet. The map and the questions still work.',
    };
  }
  if (side === 'bilateral')
    return built!.left && built!.right
      ? { kind: 'both', region, sides: ['left', 'right'], scenes: [built!.left, built!.right] }
      : {
          kind: 'none',
          region,
          reason: `Real geometry for both sides of the ${region.replace(/_/g, ' ')} is not built, and a ` +
            `mirrored copy of one side would not be anatomy.`,
        };
  return {
    kind: 'needs-side',
    region,
    reason:
      'Which side? The 3D viewer shows real anatomy for one side at a time, and choosing one here ' +
      'is not a guess this tool will make for you.',
  };
}

/**
 * The single scene to render when a caller has no region and side to work from — the
 * anatomy reference grid, tests that are not about selection.
 *
 * It is the left SHOULDER, chosen explicitly rather than hidden as a default. Anything
 * that has a record to read from must use `sceneFor(region, side)` instead: this
 * constant is the only path by which the wrong body part can be shown, so it is
 * deliberately hard to reach by accident.
 */
export const ACTIVE_SCENE: RendererSceneManifest = PRODUCTION_SCENES.shoulder!.left!;

/**
 * Regions the production scenes actually cover, read from the built scenes rather than
 * declared, so the 2D fallback and the geometry cannot disagree about which body areas
 * have real assets.
 */
export function activeRegions(side: Side = 'left'): BodyRegion[] {
  return [
    ...new Set(
      PRODUCTION_REGIONS.flatMap((region) =>
        scenesFor(region, side).flatMap((s) => s.entries.map((e) => e.region)),
      ),
    ),
  ] as BodyRegion[];
}

/** `asi:` ids the production scenes for `side` can render in 3D. */
export function activeStructureIds(side: Side = 'left'): string[] {
  return [
    ...new Set(
      PRODUCTION_REGIONS.flatMap((region) =>
        scenesFor(region, side).flatMap((s) =>
          s.entries.filter((e) => e.kind === 'structure' && e.structureId).map((e) => e.structureId!),
        ),
      ),
    ),
  ];
}

/** The real scenes a record side may be shown for one region. */
export function scenesFor(region: BodyRegion, side: Side): RendererSceneManifest[] {
  const selection = sceneFor(region, side);
  if (selection.kind === 'scene') return [selection.scene];
  if (selection.kind === 'both') return selection.scenes;
  return [];
}

/**
 * The sides the app can actually show real geometry for, per region.
 *
 * Read from the built scenes rather than declared as `['left', 'right']`, so a region
 * whose build is missing cannot advertise a side it cannot render.
 */
export function availableProductionSides(region: BodyRegion): ProductionSide[] {
  const built = PRODUCTION_SCENES[region];
  if (!built) return [];
  return (['left', 'right'] as const).filter((side) => (built[side]?.entries.length ?? 0) > 0);
}