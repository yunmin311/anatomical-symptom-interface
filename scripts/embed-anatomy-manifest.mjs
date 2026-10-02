#!/usr/bin/env node
/**
 * Make the generated anatomy assets loadable by the web app.
 *
 * Reads the canonical manifest the pipeline produced and emits two things:
 *
 *   apps/web/public/anatomy/<region>/*.glb   the geometry, served as-is
 *   apps/web/src/anatomy/generated/canonical-manifest.ts
 *                                            the manifest as a TS module
 *
 * WHY THE MANIFEST BECOMES A TS MODULE rather than a fetched JSON file.
 *
 * Because the scene is built at module load and the renderer's contract is
 * synchronous, so a runtime fetch would mean making the whole scene construction
 * async and reshaping the viewer mount path to accommodate a build detail. The
 * manifest is ~16KB of text, and embedding it means:
 *
 *   - the app goes through the REAL canonical path on startup --
 *     `parseManifest` then `toRendererScene`, with no bypass;
 *   - the manifest is reviewable in a diff, which matters more here than elsewhere
 *     because it is the record of which external mesh became which canonical id;
 *   - a malformed manifest fails at import time rather than as a blank canvas.
 *
 * It is generated output, so it is committed alongside the GLBs: both are
 * reproducible from the archive plus `scripts/build-anatomy.mjs`, and both are small.
 * The SOURCE archive is never committed, and this script never copies it.
 *
 * REFUSES a synthetic manifest. A fixture may be rendered while the viewer is being
 * built, but it must not become the production scene, and the one place that
 * decides that is here rather than in a comment nobody reads.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const REGION = flag('region', 'shoulder');
const SIDE = flag('side', 'left');
// Per-side output. One shared directory was workable while only the left side
// existed; with two sides it silently overwrote one with the other, which is the
// kind of collision that produces a left manifest pointing at right GLBs.
const GENERATED = join(ROOT, 'assets/anatomy/generated', REGION, SIDE);
const WEB_PUBLIC = join(ROOT, 'apps/web/public/anatomy', REGION, SIDE);
const WEB_MODULE_DIR = join(ROOT, 'apps/web/src/anatomy/generated');

const ALLOW_SYNTHETIC = argv.includes('--allow-synthetic');

async function main() {
  if (!['left', 'right', 'midline'].includes(SIDE)) {
    console.error(`[anatomy] --side must be left, right or midline, got ${SIDE}`);
    process.exitCode = 1;
    return;
  }
  const manifestPath = join(GENERATED, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`[anatomy] no generated manifest at ${relative(ROOT, manifestPath)}.`);
    console.error('[anatomy] run scripts/build-anatomy.mjs first.');
    process.exitCode = 1;
    return;
  }

  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const shared = await import(
    pathToFileURL(join(ROOT, 'packages/shared/src/index.ts')).href
  );

  // Parsed through the real contract, so an invalid manifest stops the build here
  // rather than reaching a browser.
  const manifest = shared.parseManifest(raw, {
    fileSizes: sizesByFile(GENERATED),
  });

  // `isSyntheticManifest` lives in the web adapter, not in shared, because it is a
  // RENDERING decision rather than a property of the data. Importing the adapter
  // module here is deliberate: this script is the gate that stops a fixture becoming
  // the production scene, so it must ask exactly the question the adapter will ask.
  const adapter = await import(
    pathToFileURL(join(ROOT, 'apps/web/src/anatomy/asset-scene-adapter.ts')).href
  );
  const synthetic = adapter.isSyntheticManifest(manifest);
  if (synthetic && !ALLOW_SYNTHETIC) {
    console.error('[anatomy] REFUSING a synthetic manifest.');
    console.error(
      '[anatomy] A fixture may be rendered while the viewer is being built, but it must',
    );
    console.error(
      '[anatomy] not become the production scene. Pass --allow-synthetic deliberately',
    );
    console.error('[anatomy] if you are wiring a test path.');
    process.exitCode = 1;
    return;
  }

  console.log(`[anatomy] region            ${REGION}`);
  console.log(`[anatomy] side              ${SIDE}`);
  console.log(`[anatomy] manifest           ${manifest.entries.length} entries`);
  // Per-ENTRY, not per-manifest. A build is not one laterality: a left neck scene
  // legitimately contains left structures AND the midline cervical spine as context.
  //
  // The earlier check compared the SET of lateralities against --side and refused the
  // build. That was correct while every entry really was one side, and became wrong the
  // moment a midline composite existed -- the guard was right to fire and its rule was
  // the thing that needed changing.
  //
  // A MIDLINE build is the opposite case and gets the opposite rule. Its whole claim is
  // that it holds midline geometry and nothing else, so "or midline" would let every
  // left and right entry through and embed a scene called midline that is a copy of the
  // left shoulder. Midline means midline, exactly.
  const wrongSide =
    SIDE === 'midline'
      ? manifest.entries.filter((e) => e.laterality !== 'midline')
      : manifest.entries.filter((e) => e.laterality !== SIDE && e.laterality !== 'midline');
  if (wrongSide.length) {
    console.error(
      `[anatomy] REFUSING a ${SIDE} build containing ${wrongSide.length} entr${
        wrongSide.length === 1 ? 'y' : 'ies'
      } of another side: ${wrongSide.map((e) => `${e.asiId}=${e.laterality}`).join(', ')}`,
    );
    console.error('[anatomy] the side is a fact from the source mapping, not a build flag.');
    process.exitCode = 1;
    return;
  }
  const laterals = [...new Set(manifest.entries.map((e) => e.laterality))].sort();
  const units = [...new Set(manifest.entries.map((e) => e.geometry.units))].sort();
  const composites = manifest.entries.filter((e) => e.composite);
  console.log(`[anatomy] laterality         ${laterals.join(', ')} (verified per entry)`);
  console.log(
    `[anatomy] composites          ${composites.length}` +
      (composites.length
        ? ` (${composites.map((e) => `${e.asiId.split(':')[1]} x${e.composite.components.length}`).join(', ')})`
        : ''),
  );
  console.log(`[anatomy] units             ${units.join(', ')}`);
  console.log(`[anatomy] dataset            ${manifest.licence.id}`);
  console.log(`[anatomy] synthetic          ${synthetic ? 'YES (test path)' : 'no'}`);

  // --- the header claims, computed rather than assumed ---
  //
  // These used to be read off `entries[0]`, which crashed on a build whose first entry
  // is a composite: a composite parent deliberately carries NO single `source`, because
  // it does not have one. It also produced a comment that lied -- "every entry in this
  // file carries laterality: left" is false for a left build, which legitimately carries
  // the midline cervical spine as context, and true only for a midline build.
  const sources = manifest.entries
    .map((e) => e.source)
    .filter((s) => s !== null);
  const archiveName = sources[0]?.archive ?? 'unknown';
  const datasetName = sources[0]
    ? `${sources[0].dataset} ${sources[0].release}`
    : 'unknown';
  const lateralsInBuild = [...new Set(manifest.entries.map((e) => e.laterality))].sort();
  const sideClaim =
    lateralsInBuild.length === 1 && lateralsInBuild[0] === SIDE
      ? `every entry in this file carries laterality: '${SIDE}'`
      : `entries carry laterality ${lateralsInBuild.map((l) => `'${l}'`).join(' and ')} -- ` +
        `this build represents ${SIDE}, and midline structures are context, not ${SIDE} anatomy`;
  const unitsInBuild = [...new Set(manifest.entries.map((e) => e.geometry.units))].sort();
  const unitsClaim = unitsInBuild.join(', ');

  // --- geometry: copy region directories, never anything else ---
  mkdirSync(WEB_PUBLIC, { recursive: true });
  let copied = 0;
  let bytes = 0;
  for (const region of readdirSync(GENERATED, { withFileTypes: true })) {
    if (!region.isDirectory()) continue;
    const from = join(GENERATED, region.name);
    const to = join(WEB_PUBLIC, region.name);
    mkdirSync(to, { recursive: true });
    for (const file of readdirSync(from)) {
      if (!file.endsWith('.glb')) continue;
      const target = join(to, file);
      writeFileSync(target, readFileSync(join(from, file)));
      copied += 1;
      bytes += statSync(target).size;
    }
  }
  console.log(`[anatomy] geometry           ${copied} glb, ${bytes} bytes -> apps/web/public/anatomy`);

  // --- the manifest as a module ---
  mkdirSync(WEB_MODULE_DIR, { recursive: true });
  const modulePath = join(WEB_MODULE_DIR, `canonical-manifest.${REGION}.${SIDE}.ts`);
  const body = `${JSON.stringify(manifest, null, 2)}\n`;

  writeFileSync(
    modulePath,
    `/**
 * GENERATED FILE. DO NOT EDIT.
 *
 * Produced by scripts/embed-anatomy-manifest.mjs from
 * assets/anatomy/generated/<region>/<side>/manifest.json.
 *
 * The canonical anatomy manifest, as data. The app parses it through
 * \`parseManifest\` and converts it with \`toRendererScene\` at startup, so the
 * production scene is built by the same contract as everything else rather than by a
 * hand-written scene that could drift from the pipeline.
 *
 * Provenance: ${manifest.licence.attribution}
 * Licence:    ${manifest.licence.name} (${manifest.licence.id}) -- ${manifest.licence.url}
 * Archive:    ${archiveName}
 * Dataset:    ${datasetName}
 * Side:       ${SIDE} -- ${sideClaim}
 * Units:      ${unitsClaim}, from the source model, not inferred here.
 */

import type { AssetManifest } from '@asi/shared';

/** The canonical manifest exactly as the pipeline wrote it. */
const CANONICAL_MANIFEST_JSON = ${body};

export const CANONICAL_ANATOMY_MANIFEST = CANONICAL_MANIFEST_JSON as unknown as AssetManifest;

/**
 * Where this side's generated geometry is served from.
 *
 * Per side, so the two builds cannot collide on a path. The renderer does not
 * hardcode this: it is read from the manifest and passed to the adapter.
 */
export const CANONICAL_ASSET_ROOT = '/anatomy/${REGION}/${SIDE}/';

/** The side this build represents, as a fact carried in the manifest itself. */
export const CANONICAL_SIDE = '${SIDE}' as const;

/** The region this build represents, so a caller cannot mix scenes. */
export const CANONICAL_REGION = '${REGION}' as const;
`,
  );
  console.log(
    `[anatomy] manifest module    canonical-manifest.${REGION}.${SIDE}.ts (${body.length} bytes)`,
  );
}

function sizesByFile(dir) {
  const sizes = new Map();
  for (const region of readdirSync(dir, { withFileTypes: true })) {
    if (!region.isDirectory()) continue;
    const regionDir = join(dir, region.name);
    for (const file of readdirSync(regionDir)) {
      if (!file.endsWith('.glb')) continue;
      sizes.set(`${region.name}/${file}`, statSync(join(regionDir, file)).size);
    }
  }
  return sizes;
}

main().catch((e) => {
  console.error('[anatomy] embed failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
void basename;