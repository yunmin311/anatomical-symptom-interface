#!/usr/bin/env node
/**
 * Build the ATLAS manifest for one region and side.
 *
 *   node scripts/build-atlas-manifest.mjs --region shoulder --side right \
 *     --public-root apps/web/public
 *
 * WHAT THIS IS
 * ------------
 * The atlas manifest is a DERIVED PRESENTATION PRODUCT. It is generated from
 * authoritative evidence and is never hand-maintained:
 *
 *   - the canonical AssetManifest           -> laterality, source mesh, FMA, asi id
 *   - the reviewed anatomy system map       -> presentation system classification
 *   - the shoulder scene inventory          -> per-mesh bounds and triangle counts
 *   - the exported GLBs                     -> real object/triangle/byte counts
 *   - review overrides                      -> presentation/ontology two-axis split
 *
 * WHY IT IS NOT THE CANONICAL MANIFEST
 * ------------------------------------
 * The canonical manifest answers "which anatomy does ASI claim, on what
 * evidence". The atlas answers "what can the viewer draw". BodyParts3D has 42
 * shoulder meshes and the canonical ontology has 10 shoulder entries, so the
 * atlas carries structures the canonical document deliberately does not: a
 * clavicle the ontology has no asi id for, a humerus, every vessel in the
 * axilla.
 *
 * Those extra structures are why the crosswalk exists. Each one is marked
 * `canonicalAsiId: null, symptomRecordSelectable: false`, which is the only thing
 * standing between a `bp3d:FJ####` id and a persisted domain structure id.
 *
 * An earlier atlas build wrote its viewer manifest straight to
 * `assets/anatomy/generated/<region>/<side>/manifest.json`, overwriting the
 * canonical file and breaking the 12 laterality tests that read real builds as
 * evidence. This script refuses to write there, and a test enforces it.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const REGION = flag('region', 'shoulder');
const SIDE = flag('side', 'right');
const PUBLIC_ROOT = flag('public-root', 'apps/web/public');

const CANONICAL_ROOT = 'assets/anatomy/generated';
const ATLAS_ROOT = 'assets/anatomy/atlas';
const CANONICAL_MANIFEST_PATH = join(CANONICAL_ROOT, REGION, SIDE, 'manifest.json');
const ATLAS_MANIFEST_PATH = join(ATLAS_ROOT, REGION, SIDE, 'atlas-manifest.json');
const PUBLIC_ATLAS_DIR = join(PUBLIC_ROOT, 'anatomy', 'atlas', REGION, SIDE);

const SYSTEM_MAP_PATH = join(CANONICAL_ROOT, 'anatomy-system-map.json');
const SYSTEM_REVIEW_PATH = join(CANONICAL_ROOT, 'anatomy-system-map.review.json');
const SCENE_PATH = join(CANONICAL_ROOT, 'shoulder-scene.json');
const COVERAGE_NOTES_PATH = join(ATLAS_ROOT, REGION, SIDE, 'coverage-notes.json');

const ATLAS_REGION_FILE = `${REGION}-atlas.glb`;
const ATLAS_BODY_FILE = 'body-context.glb';

/**
 * Refuse to write anywhere near the canonical tree.
 *
 * This is the guard for the exact regression that happened: an atlas build
 * overwrote `generated/<region>/<side>/manifest.json`. It is checked before any
 * write rather than tested afterwards, because a generator that has already
 * written the canonical file has already done the damage.
 */
function assertNotCanonicalPath(target) {
  const norm = target.split(sep).join('/');
  if (norm.includes('/generated/') || /(^|\/)generated\//.test(norm)) {
    throw new Error(
      `refusing to write an atlas artifact into the canonical tree: ${norm}\n` +
        'The canonical manifest is the domain/evidence product and is owned by ' +
        'scripts/build-anatomy.mjs. Atlas artifacts belong under assets/anatomy/atlas/.',
    );
  }
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

async function main() {
  const shared = await import(pathToFileURL(join(process.cwd(), 'packages/shared/src/index.ts')).href);
  const { validateAtlasManifest, atlasHasErrors } = shared;

  if (!existsSync(CANONICAL_MANIFEST_PATH)) {
    console.error(`[atlas] canonical manifest not found: ${CANONICAL_MANIFEST_PATH}`);
    console.error('[atlas] build it first: node scripts/build-anatomy.mjs --region ' + REGION + ' --side ' + SIDE + ' ...');
    process.exitCode = 1;
    return;
  }

  const canonical = readJson(CANONICAL_MANIFEST_PATH);
  const systemMap = readJson(SYSTEM_MAP_PATH);
  const systemReview = existsSync(SYSTEM_REVIEW_PATH) ? readJson(SYSTEM_REVIEW_PATH) : { entries: [] };
  const scene = readJson(SCENE_PATH);
  const coverageNotes = existsSync(COVERAGE_NOTES_PATH) ? readJson(COVERAGE_NOTES_PATH) : { gaps: [] };

  /**
   * Review overrides are an ARRAY keyed by `meshId`, not a map.
   *
   * Reading them as `overrides[s.id]` silently found nothing, which is how the
   * two trapezius presentation overrides would have been dropped from the atlas
   * manifest without a single warning -- the derived machine class is UNKNOWN for
   * both, so the manifest would have said UNKNOWN and looked internally
   * consistent.
   */
  const overrideByMeshId = new Map();
  for (const e of systemReview.entries ?? []) {
    if (overrideByMeshId.has(e.meshId)) {
      throw new Error(`[atlas] two review overrides claim ${e.meshId}; the classification is ambiguous`);
    }
    overrideByMeshId.set(e.meshId, e);
  }

  /**
   * Coverage, DERIVED rather than asserted.
   *
   * A system is reported as "not in this source for this region" when the
   * whole-body source has meshes of it and this region has none. The
   * whole-body count comes from anatomy-system-map.json's own aggregate, which is
   * why it is required to be positive: a not-in-source claim with a zero count
   * would say the tissue does not exist in anatomy, which is a different claim.
   */
  const wholeBodyBySystem = systemMap.counts?.bySystem ?? {};
  const regionSystems = new Set(scene.structures.map((s) => s.system));
  const gapBySystem = new Map((coverageNotes.gaps ?? []).map((g) => [g.system, g.reason]));
  const unavailableInSource = [];
  for (const [system, reason] of gapBySystem) {
    const wholeBodySourceCount = wholeBodyBySystem[system];
    if (typeof wholeBodySourceCount !== 'number' || wholeBodySourceCount <= 0) {
      throw new Error(
        `[atlas] coverage note for "${system}" has no positive whole-body source count ` +
          `(got ${wholeBodySourceCount}). Either the system is not in the map, or the note ` +
          'claims a gap in a tissue the source does not model at all.',
      );
    }
    if (regionSystems.has(system)) {
      throw new Error(
        `[atlas] coverage note claims "${system}" is absent from the ${REGION}, but the scene ` +
          `contains ${scene.structures.filter((s) => s.system === system).length} of them`,
      );
    }
    unavailableInSource.push({ system, reason, wholeBodySourceCount });
  }
  unavailableInSource.sort((a, b) => a.system.localeCompare(b.system));

  const sceneByMesh = new Map(scene.structures.map((s) => [s.id, s]));

  /**
   * The crosswalk, derived from real evidence and nothing else.
   *
   * A structure maps to a canonical asi id when the canonical manifest bound that
   * same source mesh. Matching on the mesh rather than on the label is what makes
   * this trustworthy: the label is presentation text and could be reworded, while
   * the source mesh is the thing both documents independently recorded.
   */
  const canonicalByMesh = new Map();
  for (const e of canonical.entries) {
    if (!e.meshName) continue;
    if (canonicalByMesh.has(e.meshName)) {
      throw new Error(
        `[atlas] source mesh ${e.meshName} is claimed by two canonical entries ` +
          `(${canonicalByMesh.get(e.meshName).asiId} and ${e.asiId}); the crosswalk would be ambiguous`,
      );
    }
    canonicalByMesh.set(e.meshName, e);
  }

  const atlasDir = join(ATLAS_ROOT, REGION, SIDE);
  const atlasGlb = join(atlasDir, ATLAS_REGION_FILE);
  const bodyGlb = join(atlasDir, ATLAS_BODY_FILE);
  for (const p of [atlasGlb, bodyGlb]) {
    if (!existsSync(p)) {
      console.error(`[atlas] missing exported GLB: ${p}`);
      process.exitCode = 1;
      return;
    }
  }

  const structures = scene.structures
    .filter((s) => s.role !== 'context')
    .map((s) => {
      const meshName = s.id.replace(/^bp3d:/, '');
      const canonicalEntry = canonicalByMesh.get(meshName) ?? null;
      const canonicalAsiId = canonicalEntry ? canonicalEntry.asiId : null;
      const override = overrideByMeshId.get(s.id) ?? null;
      const b = s.boundsMm;
      const scale = 0.001;
      return {
        id: s.id,
        label: s.label,
        sourceMeshName: meshName,
        // Laterality comes from the canonical manifest when there is a mapping,
        // because that is the document whose laterality the real-build tests
        // check. The scene inventory carries it too, and the two must agree.
        laterality: canonicalEntry ? canonicalEntry.laterality : SIDE,
        fma: {
          conceptId: s.fma ?? null,
          status: s.ontologyFmaVerification === 'verified' ? 'verified' : s.ontologyFmaVerification,
        },
        bp: s.bp ?? null,
        presentationSystem: s.system,
        presentationSystemClassification: override?.presentationSystemClassification ?? s.presentationSystemClassification,
        ontologyFmaVerification: s.ontologyFmaVerification,
        triangles: s.triangles,
        canonicalAsiId,
        symptomRecordSelectable: canonicalAsiId !== null,
        role: 'primary',
        sourceBounds: b
          ? {
              min: b.min,
              max: b.max,
              renderMin: [b.min[0] * scale, b.min[1] * scale, b.min[2] * scale],
              renderMax: [b.max[0] * scale, b.max[1] * scale, b.max[2] * scale],
            }
          : null,
      };
    });

  // If a primary structure has no inventory entry there is no honest way to
  // describe it, so it is dropped and reported rather than invented.
  const described = new Set(structures.map((s) => s.id));
  const undescribed = scene.structures.filter((s) => s.role !== 'context' && !described.has(s.id));

  const manifest = {
    schemaVersion: 1,
    region: REGION,
    side: SIDE,
    derivedFrom: {
      canonicalManifestPath: CANONICAL_MANIFEST_PATH.split(sep).join('/'),
      canonicalManifestSchemaVersion: canonical.schemaVersion,
      inputs: [
        CANONICAL_MANIFEST_PATH.split(sep).join('/'),
        SYSTEM_MAP_PATH.split(sep).join('/'),
        SYSTEM_REVIEW_PATH.split(sep).join('/'),
        SCENE_PATH.split(sep).join('/'),
        COVERAGE_NOTES_PATH.split(sep).join('/'),
        relative('.', atlasGlb).split(sep).join('/'),
        relative('.', bodyGlb).split(sep).join('/'),
      ],
    },
    generator: { name: 'build-atlas-manifest', version: '1.0.0' },
    coordinateSystem: {
      sourceUnits: 'mm',
      renderUnits: 'm',
      sourceToRenderScale: 0.001,
      glTFYUp: true,
      sourceAxes: { anterior: '-Y', posterior: '+Y', superior: '+Z', bodyRight: '-X' },
    },
    atlas: {
      file: ATLAS_REGION_FILE,
      objects: structures.length,
      triangles: structures.reduce((a, s) => a + s.triangles, 0),
      bytes: statSync(atlasGlb).size,
    },
    bodyContext: {
      file: ATLAS_BODY_FILE,
      objects: 1,
      triangles: scene.bodyContext?.triangles ?? 0,
      bytes: statSync(bodyGlb).size,
    },
    structures,
    unavailableInSource,
    provenance: {
      dataset: 'BodyParts3D',
      release: systemMap.source.release,
      archive: systemMap.source.archive,
      archiveSha256: systemMap.source.archiveSha256,
      doi: systemMap.source.doi,
      licence: 'CC-BY-4.0',
      licenceUrl: systemMap.source.licenceUrl,
      attribution: systemMap.source.attribution,
      retrievedAt: systemMap.source.retrievedAt,
      officialLicenseLastUpdated: '2025-02-27',
      ourLicenseEvidenceCheckedAt: '2026-10-05',
      geometryModified: false,
      modification:
        'source geometry unmodified; combined region GLB and whole-body context shell exported from it, ' +
        'plus a presentation system classification that is not an anatomy claim',
      codeLicence: 'MIT',
      assetLicence: 'CC BY 4.0',
    },
  };

  const issues = validateAtlasManifest(manifest);
  for (const i of issues.filter((x) => x.severity === 'warning')) {
    console.warn(`[atlas] warning ${i.structureId ?? ''} ${i.message}`);
  }
  if (atlasHasErrors(issues)) {
    console.error('[atlas] manifest FAILED validation; nothing was written.');
    for (const e of issues.filter((x) => x.severity === 'error')) {
      console.error(`  - ${e.structureId ?? ''} ${e.message}`);
    }
    process.exitCode = 1;
    return;
  }

  // Guard before writing, not after.
  assertNotCanonicalPath(ATLAS_MANIFEST_PATH);
  mkdirSync(ATLAS_ROOT, { recursive: true });
  mkdirSync(atlasDir, { recursive: true });
  writeFileSync(ATLAS_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  // Mirror into public/ so the viewer can fetch it. The canonical manifest is
  // embedded into the product at build time and is NOT served as a viewer asset.
  mkdirSync(PUBLIC_ATLAS_DIR, { recursive: true });
  writeFileSync(join(PUBLIC_ATLAS_DIR, 'atlas-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const selectable = structures.filter((s) => s.symptomRecordSelectable);
  const viewOnly = structures.filter((s) => !s.symptomRecordSelectable);
  console.log(`[atlas] region             ${REGION}/${SIDE}`);
  console.log(`[atlas] structures        ${structures.length}`);
  console.log(`[atlas] selectable        ${selectable.length}  (have a canonical asi:* id)`);
  console.log(`[atlas] view-only         ${viewOnly.length}  (display/search/hover/isolate/hide only)`);
  console.log(`[atlas] triangles         ${manifest.atlas.triangles}`);
  console.log(`[atlas] unavailable       ${manifest.unavailableInSource.length} systems stated as not in this source`);
  if (undescribed.length) {
    console.log(`[atlas] NOT described     ${undescribed.length}: ${undescribed.map((s) => s.id).join(', ')}`);
  }
  console.log(`[atlas] wrote             ${ATLAS_MANIFEST_PATH}`);
  console.log(`[atlas] mirrored          ${join(PUBLIC_ATLAS_DIR, 'atlas-manifest.json')}`);
  console.log(`[atlas] canonical untouched ${CANONICAL_MANIFEST_PATH}`);
  void readdirSync;
}

main().catch((e) => {
  console.error('[atlas] build failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});