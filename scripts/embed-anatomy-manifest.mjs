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
const GENERATED = join(ROOT, 'assets/anatomy/generated');
const WEB_PUBLIC = join(ROOT, 'apps/web/public/anatomy');
const WEB_MODULE_DIR = join(ROOT, 'apps/web/src/anatomy/generated');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const ALLOW_SYNTHETIC = argv.includes('--allow-synthetic');

async function main() {
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

  console.log(`[anatomy] manifest           ${manifest.entries.length} entries`);
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
  const modulePath = join(WEB_MODULE_DIR, 'canonical-manifest.ts');
  const body = `${JSON.stringify(manifest, null, 2)}\n`;

  writeFileSync(
    modulePath,
    `/**
 * GENERATED FILE. DO NOT EDIT.
 *
 * Produced by scripts/embed-anatomy-manifest.mjs from
 * assets/anatomy/generated/manifest.json.
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
 */

import type { AssetManifest } from '@asi/shared';

/** The canonical manifest exactly as the pipeline wrote it. */
const CANONICAL_MANIFEST_JSON = ${body};

export const CANONICAL_ANATOMY_MANIFEST = CANONICAL_MANIFEST_JSON as unknown as AssetManifest;

/** Where the generated geometry is served from, matching \`assetRoot\` in the adapter. */
export const CANONICAL_ASSET_ROOT = '/anatomy/';
`,
  );
  console.log(
    `[anatomy] manifest module    apps/web/src/anatomy/generated/canonical-manifest.ts (${body.length} bytes)`,
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