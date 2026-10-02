#!/usr/bin/env node
/**
 * Anatomy asset build.
 *
 * The I/O half of the pipeline. `anatomy-pipeline.ts` is pure and does the real
 * work; this reads a directory of OBJ meshes, runs the pipeline for one region,
 * validates the result against the manifest contract and the geometry budget, and
 * writes the GLB files plus manifest.json.
 *
 *   node scripts/build-anatomy.mjs --region shoulder \
 *     --input data/anatomy/source/<dir> \
 *     --out assets/anatomy/generated \
 *     --grid 10
 *
 * WHY THERE IS NO DOWNLOADER IN HERE.
 *
 * The one input this needs is BodyParts3D's bulk mesh archive,
 * `isa_BP3D_4.0_obj_99.zip` (release 4.0, 2013/05, 99% polygon-reduced), from
 * https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html. It is a gated,
 * multi-gigabyte download served from an academic archive rather than a package
 * registry, and its licence terms are CC BY 4.0 with a required attribution line.
 *
 * That means three things this script will not do:
 *   - it will not commit the archive, or any derivative of it, to the repo
 *   - it will not fetch it silently on your behalf
 *   - it will not fabricate a stand-in and call it anatomy
 *
 * Obtain the archive yourself, extract it somewhere gitignored, and point --input
 * at the directory of .obj files. Generated output IS committed, because it is
 * small, reproducible and reviewable in a diff; the source is not, because it is
 * large, licensed and not ours.
 *
 * With no --input the script runs the pipeline's own validation over the mapping
 * table alone and reports what it would need, which is the honest thing to do on
 * a machine that does not have the archive.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const REGION = flag('region', 'shoulder');
const INPUT = flag('input');
// Output is per region AND per side. A single directory worked while only the left
// shoulder existed; with several regions and two sides it lets one build silently
// overwrite another, which is how a left manifest ends up serving right geometry.
const OUT_ROOT = flag('out', 'assets/anatomy/generated');
const GRID = Number(flag('grid', '10'));
const SIDE = flag('side', 'left');
const OUT = join(OUT_ROOT, REGION, SIDE);
const ARCHIVE = flag('archive');
const RETRIEVED = flag('retrieved');

/** Parse an OBJ into the flat form the pipeline expects. */
function parseObj(name, text) {
  const positions = [];
  const indices = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('v ')) {
      const parts = line.split(/\s+/);
      positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    } else if (line.startsWith('f ')) {
      const parts = line.split(/\s+/).slice(1);
      // OBJ indices are 1-based and may be negative (relative to the end).
      const tri = parts.map((p) => {
        const first = Number(p.split('/')[0]);
        return first > 0 ? first - 1 : positions.length / 3 + first;
      });
      // Fan-triangulate n-gons.
      for (let i = 1; i + 1 < tri.length; i++) {
        indices.push(tri[0], tri[i], tri[i + 1]);
      }
    }
  }
  return { name, positions, indices };
}

function readInputDir(dir) {
  const meshes = new Map();
  for (const f of readdirSync(dir)) {
    if (extname(f).toLowerCase() !== '.obj') continue;
    const name = basename(f, '.obj');
    meshes.set(name, parseObj(name, readFileSync(join(dir, f), 'utf8')));
  }
  return meshes;
}

async function main() {
  const shared = await import(
    pathToFileURL(join(process.cwd(), 'packages/shared/src/index.ts')).href
  );
  const { runPipeline, validateManifest, manifestHasErrors, mappingFor, MAPPINGS, BODYPARTS3D_SOURCE, BODYPARTS3D_LICENCE } = shared;

  if (!BODYPARTS3D_LICENCE) throw new Error('shared package did not export the licence metadata');

  const wanted = mappingFor(REGION);
  if (!wanted.length) {
    console.error(`[anatomy] no mapping for region "${REGION}". Mapped regions: ${Object.keys(MAPPINGS).join(', ')}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`[anatomy] region            ${REGION}`);
  console.log(`[anatomy] source dataset    ${BODYPARTS3D_SOURCE.dataset} ${BODYPARTS3D_SOURCE.release} (concepts ${BODYPARTS3D_SOURCE.conceptRelease})`);
  console.log(`[anatomy] licence           ${BODYPARTS3D_LICENCE.id}, page verified ${BODYPARTS3D_LICENCE.verifiedOn}`);
  console.log(`[anatomy] structures wanted  ${wanted.length}`);
  console.log(`[anatomy] side              ${SIDE}`);

  if (!INPUT) {
    console.log('');
    console.log('[anatomy] NO INPUT SUPPLIED -- nothing was generated.');
    console.log('');
    console.log('  This pipeline needs one external file, which is not in the repo and');
    console.log('  cannot be fetched automatically:');
    console.log('');
    console.log(`    file:   ${BODYPARTS3D_SOURCE.archive}`);
    console.log(`    source: ${BODYPARTS3D_LICENCE.url}`);
    console.log(`    licence: ${BODYPARTS3D_LICENCE.id} -- attribution is required`);
    console.log('');
    console.log('  Obtain it, extract the .obj files to a gitignored directory, then:');
    console.log('');
    console.log(`    node scripts/build-anatomy.mjs --region ${REGION} \\`);
    console.log('      --input <dir-of-obj-files> --out assets/anatomy/generated --grid 10 --side left');
    console.log('');
    console.log('  Structures this pipeline will try to bind when it runs:');
    for (const e of wanted) {
      console.log(`    ${e.asiId.padEnd(42)} <- ${e.candidates.map((c) => c.meshName).join(' | ')}${e.expectAbsent ? '   (no mesh expected)' : ''}`);
    }
    process.exitCode = 2;
    return;
  }

  if (!existsSync(INPUT)) {
    console.error(`[anatomy] input directory not found: ${INPUT}`);
    process.exitCode = 1;
    return;
  }

  const meshes = readInputDir(INPUT);
  console.log(`[anatomy] meshes read       ${meshes.size}`);
  if (!meshes.size) {
    console.error('[anatomy] no .obj files found in the input directory');
    process.exitCode = 1;
    return;
  }

  const result = runPipeline(REGION, meshes, {
    gridDivisions: GRID,
    side: SIDE,
    retrievedAt: RETRIEVED ?? null,
    archive: ARCHIVE,
  });

  console.log(`[anatomy] bound             ${result.selection.bound.length}`);
  console.log(`[anatomy] unmapped          ${result.selection.unmapped.length}`);
  if (result.notes.length) {
    console.log('[anatomy] gaps (reported, not invented):');
    for (const n of result.notes) console.log(`  - ${n}`);
  }
  if (result.selection.unusedMeshNames.length) {
    console.log(`[anatomy] unused meshes     ${result.selection.unusedMeshNames.length} (not bound to any structure)`);
  }

  const fileSizes = new Map([...result.files].map(([k, v]) => [k, v.byteLength]));
  const issues = validateManifest(result.manifest, { fileSizes });
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  const totalTriangles = result.manifest.entries.reduce((a, e) => a + e.geometry.triangles, 0);
  const totalBytes = [...fileSizes.values()].reduce((a, b) => a + b, 0);
  console.log(`[anatomy] triangles         ${totalTriangles}`);
  console.log(`[anatomy] generated bytes   ${totalBytes}`);
  console.log(`[anatomy] warnings         ${warnings.length}`);

  if (manifestHasErrors(issues)) {
    console.error('[anatomy] manifest FAILED validation:');
    for (const e of errors) console.error(`  - ${e.asiId ?? ''} ${e.meshName ?? ''}: ${e.message}`);
    console.error('[anatomy] nothing was written. Fix the source or the mapping, then rerun.');
    process.exitCode = 1;
    return;
  }

  mkdirSync(OUT, { recursive: true });
  for (const [rel, bytes] of result.files) {
    const dest = join(OUT, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    writeFileSync(dest, bytes);
  }
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(result.manifest, null, 2)}\n`);

  console.log(`[anatomy] wrote             ${result.files.size} meshes + manifest.json to ${OUT}`);
  console.log('[anatomy] remember: ' + BODYPARTS3D_LICENCE.attribution);
  void statSync;
}

main().catch((e) => {
  console.error('[anatomy] build failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
