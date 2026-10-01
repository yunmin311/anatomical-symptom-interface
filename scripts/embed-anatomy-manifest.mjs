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

const SIDE = flag('side', 'left');
// Per-side output. One shared directory was workable while only the left side
// existed; with two sides it silently overwrote one with the other, which is the
// kind of collision that produces a left manifest pointing at right GLBs.
const GENERATED = join(ROOT, 'assets/anatomy/generated', SIDE);
const WEB_PUBLIC = join(ROOT, 'apps/web/public/anatomy', SIDE);
const WEB_MODULE_DIR = join(ROOT, 'apps/web/src/anatomy/generated');

const ALLOW_SYNTHETIC = argv.includes('--allow-synthetic');

async function main() {
  if (!['left', 'right'].includes(SIDE)) {
    console.error(`[anatomy] --side must be left or right, got ${SIDE}`);
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

  console.log(`[anatomy] side              ${SIDE}`);
  console.log(`[anatomy] manifest           ${manifest.entries.length} entries`);
  const laterals = [...new Set(manifest.entries.map((e) => e.laterality))].sort();
  const units = [...new Set(manifest.entries.map((e) => e.geometry.units))].sort();
  if (laterals.length !== 1 || laterals[0] !== SIDE) {
    console.error(
      `[anatomy] REFUSING a ${SIDE} build whose manifest says laterality ${laterals.join('/')}.`,
    );
    console.error('[anatomy] the side is a fact from the source mapping, not a build flag.');
    process.exitCode = 1;
    return;
  }
  console.log(`[anatomy] laterality         ${laterals.join(', ')} (verified)`);
  console.log(`[anatomy] units             ${units.join(', ')}`);
  console.log(`[anatomy] dataset            ${manifest.licence.id}`);
  console.log(`[anatomy] synthetic          ${synthetic ? 'YES (test path)' : 'no'}`);

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
  const modulePath = join(WEB_MODULE_DIR, `canonical-manifest.${SIDE}.ts`);
  const body = `${JSON.stringify(manifest, null, 2)}\n`;

  writeFileSync(
    modulePath,
    `/**
 * GENERATED FILE. DO NOT EDIT.
 *
 * Produced by scripts/embed-anatomy-manifest.mjs from
 * assets/anatomy/generated/<side>/manifest.json.
 *
 * The canonical anatomy manifest, as data. The app parses it through
 * \`parseManifest\` and converts it with \`toRendererScene\` at startup, so the
 * production scene is built by the same contract as everything else rather than by a
 * hand-written scene that could drift from the pipeline.
 *
 * Provenance: ${manifest.licence.attribution}
 * Licence:    ${manifest.licence.name} (${manifest.licence.id}) -- ${manifest.licence.url}
 * Archive:    ${manifest.entries[0]?.source.archive ?? 'unknown'}
 * Dataset:    ${manifest.entries[0]?.source.dataset ?? 'unknown'} ${manifest.entries[0]?.source.release ?? ''}
 * Side:       ${SIDE} -- every entry in this file carries \`laterality: '${SIDE}'\`.
 * Units:      ${manifest.entries[0]?.geometry.units ?? 'unknown'}, from the source model, not inferred here.
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
export const CANONICAL_ASSET_ROOT = '/anatomy/${SIDE}/';

/** The side this build represents, as a fact carried in the manifest itself. */
export const CANONICAL_SIDE = '${SIDE}' as const;
`,
  );
  console.log(
    `[anatomy] manifest module    apps/web/src/anatomy/generated/canonical-manifest.${SIDE}.ts (${body.length} bytes)`,
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