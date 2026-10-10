#!/usr/bin/env node
/**
 * Publish the derived 2D view assets for one region and side.
 *
 *   node scripts/publish-anatomy-views.mjs --region shoulder --side right
 *
 * WHAT THIS PUBLISHES, AND WHY IT HAS TO BE A STEP
 * -----------------------------------------------
 * The orthographic PNGs were written straight into `apps/web/public/` by the
 * Blender exporter, and the hit grids were written to `assets/anatomy/generated/`
 * and left there. So the images were served and the grids were not, which made
 * every one of those images a picture nobody could indicate on: there was no way
 * for the browser to know what a tap had hit.
 *
 * This step publishes both halves together, plus a manifest, and derives the
 * served manifest FROM the generated one rather than letting anyone hand-write
 * it. The grid is not optional decoration -- it is the identity half of the
 * feature, and shipping the image without it would produce a map that looks
 * complete and selects nothing.
 *
 * It also re-checks the grids against the atlas manifest before publishing, so a
 * stale grid cannot ship against a rebuilt atlas.
 *
 * WHY NOT DO THIS IN THE BLENDER EXPORTER
 * ---------------------------------------
 * Because the exporter writes assets/anatomy/** and this publishes to
 * apps/web/public/**, which is a different tree with a different owner. The atlas
 * manifest already made that split explicit; this follows it.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const REGION = flag('region', 'shoulder');
const SIDE = flag('side', 'right');
const PUBLIC_ROOT = flag('public-root', 'apps/web/public');

const GEN_DIR = join('assets', 'anatomy', 'generated', 'views');
const ATLAS_MANIFEST = join('assets', 'anatomy', 'atlas', REGION, SIDE, 'atlas-manifest.json');
const PUBLIC_DIR = join(PUBLIC_ROOT, 'anatomy', 'views', REGION, SIDE);

const VIEWS = ['front', 'back', 'left', 'right'];
const LAYERS = ['surface', 'bone', 'muscle', 'vascular'];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

async function main() {
  const shared = await import(pathToFileURL(join(process.cwd(), 'packages/shared/src/index.ts')).href);
  const { AtlasManifestSchema, DerivedViewGridSchema } = shared;

  if (!existsSync(ATLAS_MANIFEST)) {
    console.error(`[views] atlas manifest missing: ${ATLAS_MANIFEST}`);
    console.error(`[views] build it first: node scripts/build-atlas-manifest.mjs --region ${REGION} --side ${SIDE}`);
    process.exitCode = 1;
    return;
  }

  const atlas = AtlasManifestSchema.parse(readJson(ATLAS_MANIFEST));
  const atlasIds = new Set(atlas.structures.map((s) => s.id));
  console.log(`[views] atlas structures    ${atlasIds.size}`);

  const generatedManifestPath = join(GEN_DIR, 'manifest.json');
  if (!existsSync(generatedManifestPath)) {
    console.error(`[views] derived views manifest missing: ${generatedManifestPath}`);
    console.error('[views] run spikes/shoulder-geometry/derive-2d-views.py first');
    process.exitCode = 1;
    return;
  }
  const generated = readJson(generatedManifestPath);

  mkdirSync(PUBLIC_DIR, { recursive: true });

  const published = { schemaVersion: 1, region: REGION, side: SIDE, views: {} };
  let grids = 0;
  let images = 0;

  // The PNGs are rendered straight into apps/web/public/ by the Blender exporter,
  // while the grids land in assets/anatomy/generated/views/. They are now gathered
  // into one published tree so the two halves cannot be served apart -- an image
  // without its grid is a picture nobody can indicate on.
  const LEGACY_PUBLIC_DIR = join(PUBLIC_ROOT, 'anatomy', 'views');

  for (const view of VIEWS) {
    for (const layer of LAYERS) {
      const name = `shoulder-${view}-${layer}`;
      const gridSrc = join(GEN_DIR, `${name}.grid.json`);

      const imgCandidates = [join(GEN_DIR, `${name}.png`), join(LEGACY_PUBLIC_DIR, `${name}.png`)];
      const imgSrc = imgCandidates.find((p) => existsSync(p));
      if (!imgSrc && !existsSync(gridSrc)) continue;

      if (imgSrc) {
        copyFileSync(imgSrc, join(PUBLIC_DIR, `${name}.png`));
        images += 1;
        // Remove the now-superseded loose copy, so there is exactly one served
        // location and nothing to keep in sync by hand.
        if (imgSrc.startsWith(LEGACY_PUBLIC_DIR)) {
          try {
            (await import('node:fs')).unlinkSync(imgSrc);
          } catch {
            /* already gone, or held; the published copy exists either way */
          }
        }
      }

      if (existsSync(gridSrc)) {
        // Validate against the SHARED schema before publishing, and check every id
        // against the atlas. A grid that names a structure the rebuilt atlas no
        // longer has would make a tap select something that does not exist, and
        // that is precisely the drift the crosswalk exists to prevent.
        const raw = readJson(gridSrc);
        const parsed = DerivedViewGridSchema.safeParse(raw);
        if (!parsed.success) {
          console.error(`[views] ${name}: grid does not match DerivedViewGridSchema, refusing to publish`);
          console.error(`         ${parsed.error.message.slice(0, 200)}`);
          process.exitCode = 1;
          return;
        }
        const orphans = parsed.data.structures.filter((id) => !atlasIds.has(id));
        if (orphans.length) {
          console.error(
            `[views] ${name}: grid names ${orphans.length} structure(s) the atlas manifest does not have: ` +
              `${orphans.slice(0, 5).join(', ')}`,
          );
          process.exitCode = 1;
          return;
        }
        writeFileSync(join(PUBLIC_DIR, `${name}.grid.json`), `${JSON.stringify(parsed.data)}\n`);
        grids += 1;
        published.views[view] ??= {};
        published.views[view][layer] = {
          image: `/anatomy/views/${REGION}/${SIDE}/${name}.png`,
          grid: `/anatomy/views/${REGION}/${SIDE}/${name}.grid.json`,
          selectable: parsed.data.selectable,
          distinctStructures: parsed.data.structures.length,
        };
      }
    }
  }

  // The served manifest carries provenance straight through from the generated one,
  // plus a pointer to the atlas manifest these views were rendered from. Same
  // geometry, same identity, stated rather than implied.
  published.sourceAtlasManifest = `/${PUBLIC_ROOT === 'apps/web/public' ? '' : ''}anatomy/atlas/${REGION}/${SIDE}/atlas-manifest.json`;
  published.generator = { name: 'publish-anatomy-views', version: '1.0.0' };
  published.grid = generated.grid;
  published.provenance = {
    ...generated.provenance,
    handDrawn: false,
    aiGenerated: false,
    modification:
      'source geometry unmodified; orthographic renders and a BVH hit grid derived from it, published for the product 2D surface',
  };
  writeFileSync(join(PUBLIC_DIR, 'manifest.json'), `${JSON.stringify(published, null, 2)}\n`);

  const selectable = Object.values(published.views)
    .flatMap((layers) => Object.values(layers))
    .filter((l) => l.selectable).length;
  console.log(`[views] images published    ${images}`);
  console.log(`[views] grids published     ${grids}`);
  console.log(`[views] selectable layers   ${selectable}`);
  console.log(`[views] wrote              ${join(PUBLIC_DIR, 'manifest.json')}`);
  console.log('[views] DONE');
}

main().catch((e) => {
  console.error('[views] publish failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});