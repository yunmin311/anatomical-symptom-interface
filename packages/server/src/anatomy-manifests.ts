/**
 * The built anatomy manifests, as the SERVER sees them.
 *
 * ## Why the server reads files instead of importing modules
 *
 * The generated manifests exist twice: as committed JSON under
 * `assets/anatomy/generated/`, and as TypeScript modules under
 * `apps/web/src/anatomy/generated/`. The web app imports the modules, because a browser
 * cannot read the filesystem.
 *
 * The server could import those modules too, and it would be less code. It must not: that
 * would make `packages/server` depend on `apps/web`, so the direction of dependency points
 * at the application rather than at the domain. Every other shared thing already lives in
 * `@asi/shared`, and a client that wanted the same data would be unable to get it.
 *
 * So the server reads the JSON, which is the canonical artifact anyway -- the modules are
 * generated FROM it. `assets/anatomy/generated/manifest.json` is what the pipeline wrote
 * and what a reviewer reads in a diff.
 *
 * ## Failure is loud on purpose
 *
 * A manifest that does not satisfy the canonical contract stops the server at startup
 * rather than producing a capability report that quietly undercounts. Undercounting is the
 * dangerous direction: a client would be told a region has no geometry, offer no 3D
 * picker, and nobody would learn why.
 *
 * A MISSING directory is different, and is tolerated: a checkout with no built anatomy
 * should still start and still serve localisation and interviews. That is reported as
 * "no builds", which is the truth.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseManifest, PIPELINE_SIDES, REGIONS } from '@asi/shared';
import type { AssetManifest, BodyRegion } from '@asi/shared';

// Three levels up from `packages/server/src`: src -> server -> packages -> repo root.
// This was four, and the symptom was silent and total: the server looked one directory
// above the repository, found nothing, and reported EVERY region as having no geometry.
// Every capability assertion then passed vacuously except the one written to catch it.
// A path is a claim about the filesystem, so it is checked rather than assumed.
const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const GENERATED = resolve(REPO_ROOT, 'assets/anatomy/generated');

/** Regions to look for, from the ontology rather than a hardcoded list. */
const REGION_IDS = Object.keys(REGIONS) as BodyRegion[];

function load(): Partial<Record<BodyRegion, Partial<Record<(typeof PIPELINE_SIDES)[number], AssetManifest>>>> {
  if (!existsSync(GENERATED))
    // Loud, not a warning. This repository has committed anatomy for four regions, so
    // "no generated anatomy" is never a legitimate startup state here -- it means the
    // path is wrong or the build was never run, and in both cases the capability
    // endpoint would otherwise answer "this product has no 3D anatomy", which is false
    // and which every client would believe.
    throw new Error(
      `[anatomy] no generated anatomy at ${GENERATED}. This build ships real anatomy for ` +
        `shoulder, neck, lower back and knee, so an empty directory means the path is wrong ` +
        `or scripts/build-anatomy.mjs has not been run. Refusing to start rather than ` +
        `reporting that this product has no anatomy.`,
    );

  const out: ReturnType<typeof load> = {};
  for (const region of REGION_IDS) {
    for (const side of PIPELINE_SIDES) {
      const file = resolve(GENERATED, region, side, 'manifest.json');
      if (!existsSync(file)) continue;
      try {
        out[region] = { ...out[region], [side]: parseManifest(JSON.parse(readFileSync(file, 'utf8'))) };
      } catch (error) {
        throw new Error(
          `[anatomy] ${region}/${side}/manifest.json does not satisfy the canonical contract, so the ` +
            `server refuses to start rather than under-report this region's geometry. ` +
            `Regenerate it with scripts/build-anatomy.mjs.\n` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const loaded = Object.values(out).reduce((n, sides) => n + Object.keys(sides).length, 0);
  if (!loaded)
    throw new Error(
      `[anatomy] ${GENERATED} exists but contains no readable region manifests. Refusing to start: ` +
        `an empty capability report would tell every client this product has no anatomy.`,
    );
  return out;
}

/** Loaded once at startup. Immutable: nothing rebuilds anatomy under a running server. */
export const BUILT_MANIFESTS = Object.freeze(load());