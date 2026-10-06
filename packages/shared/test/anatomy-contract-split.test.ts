import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { AssetManifestSchema } from '../src/anatomy-manifest.ts';
import { AtlasManifestSchema, validateAtlasManifest, atlasHasErrors } from '../src/anatomy-atlas-manifest.ts';
import { getStructure } from '../src/anatomy.ts';
import { BODYPARTS3D_LICENCE } from '../src/anatomy-mapping.ts';

/**
 * THE MANIFEST SPLIT, GUARDED.
 *
 * The atlas viewer once wrote its own manifest straight to
 * `assets/anatomy/generated/shoulder/right/manifest.json`, replacing the canonical
 * AssetManifest. Twelve tests in anatomy-laterality.test.ts then failed with
 * "entries is not iterable", because that file records which `asi:*` structures
 * the product claims, on which source mesh, with which laterality.
 *
 * Those tests were correct. The overwrite was the bug. They are deliberately NOT
 * modified here: they read real committed builds as their evidence, and weakening
 * them to accept the atlas schema would delete the protection rather than restore
 * the thing being protected.
 *
 * So there are now two documents, and this file is what keeps them from merging
 * again:
 *
 *   canonical  assets/anatomy/generated/<region>/<side>/manifest.json
 *              written ONLY by scripts/build-anatomy.mjs
 *              validates against AssetManifestSchema
 *
 *   atlas      assets/anatomy/atlas/<region>/<side>/atlas-manifest.json
 *              written ONLY by scripts/build-atlas-manifest.mjs
 *              validates against AtlasManifestSchema
 *
 * The atlas is a DERIVED PRESENTATION product and legitimately contains structures
 * the canonical ontology has no id for. What it may never do is let one of those
 * raw source ids become a persisted domain structure id, and that is what the
 * crosswalk tests below exist to prevent.
 */

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const CANONICAL_ROOT = join(repoRoot, 'assets', 'anatomy', 'generated');
const ATLAS_ROOT = join(repoRoot, 'assets', 'anatomy', 'atlas');

/** Every region/side that has a canonical build committed. */
function canonicalManifests(): { region: string; side: string; path: string }[] {
  const out: { region: string; side: string; path: string }[] = [];
  for (const region of readdirSync(CANONICAL_ROOT, { withFileTypes: true })) {
    if (!region.isDirectory()) continue;
    for (const side of readdirSync(join(CANONICAL_ROOT, region.name), { withFileTypes: true })) {
      if (!side.isDirectory()) continue;
      const path = join(CANONICAL_ROOT, region.name, side.name, 'manifest.json');
      if (existsSync(path)) out.push({ region: region.name, side: side.name, path });
    }
  }
  return out;
}

function atlasManifests(): { region: string; side: string; path: string }[] {
  const out: { region: string; side: string; path: string }[] = [];
  if (!existsSync(ATLAS_ROOT)) return out;
  for (const region of readdirSync(ATLAS_ROOT, { withFileTypes: true })) {
    if (!region.isDirectory()) continue;
    for (const side of readdirSync(join(ATLAS_ROOT, region.name), { withFileTypes: true })) {
      if (!side.isDirectory()) continue;
      const path = join(ATLAS_ROOT, region.name, side.name, 'atlas-manifest.json');
      if (existsSync(path)) out.push({ region: region.name, side: side.name, path });
    }
  }
  return out;
}

const CANONICAL = canonicalManifests();
const ATLAS = atlasManifests();

describe('A. every canonical manifest parses as an AssetManifest', () => {
  it('there is at least one canonical build to check', () => {
    assert.ok(CANONICAL.length >= 4, `expected several canonical manifests, found ${CANONICAL.length}`);
  });

  for (const { region, side, path } of CANONICAL) {
    it(`${region}/${side} validates against AssetManifestSchema`, () => {
      const parsed = AssetManifestSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      assert.ok(
        parsed.success,
        `${region}/${side} does not parse as a canonical AssetManifest. If this is an atlas ` +
          `document that has been written over the canonical path, that is the regression this ` +
          `file exists to catch. Cause: ${parsed.success ? '' : parsed.error.message}`,
      );
      // And it carries the canonical shape specifically, not just something that
      // happens to validate: `entries` is what the laterality tests read.
      const doc = parsed.data as { entries?: unknown[]; regions?: unknown; licence?: unknown };
      assert.ok(Array.isArray(doc.entries), `${region}/${side} has no entries array`);
      assert.ok(doc.regions !== undefined, `${region}/${side} does not declare its regions`);
      assert.ok(doc.licence !== undefined, `${region}/${side} does not declare its licence`);
    });
  }

  it('the canonical manifests of one region all use the SAME contract', () => {
    // The asymmetry that caused this: `right` was regenerated in the atlas shape
    // while `left` stayed canonical, so a region had two incompatible documents
    // and neither test noticed, because only one of them was ever parsed.
    const byRegion = new Map<string, string[]>();
    for (const { region, side, path } of CANONICAL) {
      const doc = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      const shape = Object.keys(doc).sort().join(',');
      byRegion.set(region, [...(byRegion.get(region) ?? []), `${side}:${shape}`]);
    }
    for (const [region, shapes] of byRegion) {
      const distinct = new Set(shapes.map((s) => s.slice(s.indexOf(':') + 1)));
      assert.equal(
        distinct.size,
        1,
        `${region} has canonical manifests in ${distinct.size} different shapes: ${shapes.join(' | ')}`,
      );
    }
  });
});

describe('C. atlas manifests parse as an AtlasManifest', () => {
  it('there is at least one atlas manifest to check', () => {
    assert.ok(ATLAS.length >= 1, 'expected the atlas build to be committed');
  });

  for (const { region, side, path } of ATLAS) {
    it(`${region}/${side} validates against AtlasManifestSchema and the crosswalk rules`, () => {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      const parsed = AtlasManifestSchema.safeParse(raw);
      assert.ok(parsed.success, `${region}/${side} does not parse as an AtlasManifest: ${parsed.success ? '' : parsed.error.message}`);

      const known = new Set(
        CANONICAL.flatMap(({ path: p }) =>
          (JSON.parse(readFileSync(p, 'utf8')) as { entries: { asiId: string }[] }).entries.map(
            (e) => e.asiId,
          ),
        ),
      );
      const issues = validateAtlasManifest(parsed.data, { knownCanonicalAsiIds: known });
      const errors = issues.filter((i) => i.severity === 'error');
      assert.equal(
        errors.length,
        0,
        `${region}/${side} atlas manifest has contract errors:\n` +
          errors.map((e) => `  - ${e.structureId ?? ''} ${e.message}`).join('\n'),
      );
      assert.ok(!atlasHasErrors(issues));
    });

    it(`${region}/${side} declares a coordinate system explicitly, not one ambiguous units field`, () => {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      assert.equal(raw.units, undefined, 'a single top-level `units` is exactly the ambiguity this replaces');
      const cs = raw.coordinateSystem as Record<string, unknown>;
      assert.equal(cs.sourceUnits, 'mm');
      assert.equal(cs.renderUnits, 'm');
      assert.equal(cs.sourceToRenderScale, 0.001);
      assert.equal(cs.glTFYUp, true);
    });
  }
});

describe('D. atlas provenance survives the split', () => {
  for (const { region, side, path } of ATLAS) {
    it(`${region}/${side} every structure names a source mesh and a laterality`, () => {
      const doc = JSON.parse(readFileSync(path, 'utf8')) as {
        structures: { id: string; sourceMeshName: string; laterality: string }[];
        side: string;
      };
      for (const s of doc.structures) {
        assert.match(s.sourceMeshName, /^FJ\d+M?$/, `${s.id} has no usable source mesh name`);
        assert.ok(
          ['left', 'right', 'midline'].includes(s.laterality),
          `${s.id} has laterality ${s.laterality}`,
        );
      }
      // A structure in a `right` build must not be left-side anatomy.
      for (const s of doc.structures) {
        assert.notEqual(s.laterality, 'left', `${region}/${side}: ${s.id} is a left structure in a ${side} build`);
      }
    });

    it(`${region}/${side} carries licence and archive evidence, not just a file name`, () => {
      const doc = JSON.parse(readFileSync(path, 'utf8')) as { provenance: Record<string, unknown> };
      const p = doc.provenance;
      assert.equal(p.dataset, 'BodyParts3D');
      assert.equal(p.licence, 'CC-BY-4.0');
      assert.equal(p.assetLicence, 'CC BY 4.0');
      assert.equal(p.codeLicence, 'MIT');
      assert.match(String(p.archiveSha256), /^[a-f0-9]{64}$/);
      assert.equal(p.attribution, BODYPARTS3D_LICENCE.attribution);
      assert.equal(p.geometryModified, false);
    });

    it(`${region}/${side} render bounds are the source bounds, converted`, () => {
      const doc = JSON.parse(readFileSync(path, 'utf8')) as {
        coordinateSystem: { sourceToRenderScale: number };
        structures: {
          id: string;
          sourceBounds: {
            min: [number, number, number];
            max: [number, number, number];
            renderMin: [number, number, number];
            renderMax: [number, number, number];
          } | null;
        }[];
      };
      const k = doc.coordinateSystem.sourceToRenderScale;
      let checked = 0;
      for (const s of doc.structures) {
        if (!s.sourceBounds) continue;
        for (let i = 0; i < 3; i++) {
          assert.ok(
            Math.abs(s.sourceBounds.renderMin[i]! - s.sourceBounds.min[i]! * k) < 1e-9,
            `${s.id}: renderMin[${i}] is not min[${i}] x ${k}`,
          );
          assert.ok(
            Math.abs(s.sourceBounds.renderMax[i]! - s.sourceBounds.max[i]! * k) < 1e-9,
            `${s.id}: renderMax[${i}] is not max[${i}] x ${k}`,
          );
        }
        checked++;
      }
      assert.ok(checked > 0, 'no structure carried bounds, so the conversion went unchecked');
    });
  }
});

describe('E. the crosswalk, which is what stops a raw source id being persisted', () => {
  for (const { region, side, path } of ATLAS) {
    it(`${region}/${side} selectable implies a real canonical asi id`, () => {
      const doc = JSON.parse(readFileSync(path, 'utf8')) as {
        structures: { id: string; canonicalAsiId: string | null; symptomRecordSelectable: boolean }[];
      };
      const known = new Set(
        CANONICAL.flatMap(({ path: p }) =>
          (JSON.parse(readFileSync(p, 'utf8')) as { entries: { asiId: string }[] }).entries.map(
            (e) => e.asiId,
          ),
        ),
      );

      for (const s of doc.structures) {
        if (!s.symptomRecordSelectable) continue;
        assert.ok(
          s.canonicalAsiId !== null,
          `${s.id} is symptomRecordSelectable but names no canonical structure`,
        );
        assert.match(s.canonicalAsiId!, /^asi:[a-z_]+\.[a-z0-9-]+$/, `${s.id}: ${s.canonicalAsiId} is not an asi id`);
        assert.ok(known.has(s.canonicalAsiId!), `${s.id}: ${s.canonicalAsiId} is in no canonical manifest`);
        // The id must be a structure the domain actually resolves. Otherwise the
        // flag would promise a write target that does not exist.
        assert.ok(getStructure(s.canonicalAsiId!), `${s.id}: ${s.canonicalAsiId} is not a domain structure`);
      }
    });

    it(`${region}/${side} a view-only structure has no canonical id at all`, () => {
      const doc = JSON.parse(readFileSync(path, 'utf8')) as {
        structures: { id: string; canonicalAsiId: string | null; symptomRecordSelectable: boolean }[];
      };
      const viewOnly = doc.structures.filter((s) => !s.symptomRecordSelectable);
      for (const s of viewOnly) {
        assert.equal(
          s.canonicalAsiId,
          null,
          `${s.id} is view-only yet names ${s.canonicalAsiId}; one of the two is wrong`,
        );
        // And its own id is a raw source id, which is exactly why it is view-only.
        assert.match(s.id, /^bp3d:FJ\d+M?$/);
      }
    });

    it(`${region}/${side} at least one structure is selectable, so the viewer can start a record`, () => {
      const doc = JSON.parse(readFileSync(path, 'utf8')) as {
        structures: { symptomRecordSelectable: boolean }[];
      };
      assert.ok(
        doc.structures.some((s) => s.symptomRecordSelectable),
        'no atlas structure could be written to a SymptomRecord',
      );
    });
  }

  it('no domain write path accepts a raw bp3d source id', () => {
    // The crosswalk is only useful if the domain side actually refuses. This is
    // the belt to the manifest's braces: even if a bp3d id reached a write path,
    // it must fail rather than silently become a SymptomRecord structure.
    assert.equal(getStructure('bp3d:FJ3384'), undefined);
    assert.equal(getStructure('bp3d:FJ3384' as never), undefined);
    assert.equal(getStructure('bp3d:FJ1506' as never), undefined);
  });
});

describe('F. path ownership: the atlas never writes the canonical tree', () => {
  it('an atlas manifest is never committed at a canonical path', () => {
    // The direct check: if an atlas-shaped document ever appears at
    // generated/<region>/<side>/manifest.json, test A above fails too, but this
    // names the failure in a way that points at the cause.
    for (const { region, side, path } of CANONICAL) {
      const doc = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      assert.equal(
        doc.structures,
        undefined,
        `${region}/${side}: the canonical manifest has an atlas "structures" array. An atlas ` +
          'document has been written over the canonical path.',
      );
      assert.equal(
        doc.coordinateSystem,
        undefined,
        `${region}/${side}: the canonical manifest declares atlas coordinate metadata.`,
      );
    }
  });

  it('the atlas generator refuses to write into the canonical tree', () => {
    const src = readFileSync(join(repoRoot, 'scripts', 'build-atlas-manifest.mjs'), 'utf8');
    assert.match(src, /assertNotCanonicalPath/, 'the generator lost its path guard');
    assert.match(src, /refusing to write an atlas artifact into the canonical tree/);
    // It must derive its atlas path, not accept one that lands in generated/.
    assert.match(src, /ATLAS_ROOT = 'assets\/anatomy\/atlas'/);
    assert.ok(
      !/writeFileSync\([^)]*CANONICAL_MANIFEST_PATH/.test(src),
      'the generator writes the canonical manifest',
    );
  });

  it('the Blender exporter no longer writes any manifest', () => {
    const src = readFileSync(join(repoRoot, 'spikes', 'shoulder-geometry', 'export-web-glb.py'), 'utf8');
    // Check the CODE, not the prose. The module docstring deliberately describes
    // the manifest this script used to write, so matching the bare filename
    // anywhere in the file would fail for the right reason in the wrong way.
    const code = src.replace(/^"""[\s\S]*?"""/, '').replace(/^\s*#.*$/gm, '');

    assert.ok(!/json\.dump\(/.test(code), 'the exporter still serialises a manifest; it must export geometry only');
    assert.ok(
      !/writeFileSync|open\([^)]*["']w["']/.test(code),
      'the exporter still writes a file it should be generating elsewhere',
    );
    assert.match(src, /refuse_canonical_write/);

    // One remaining reference to manifest.json is legitimate and wanted: the
    // exporter READS the canonical manifest to assert it is still canonical. What
    // must not exist is a second one, which would be an output path.
    const refs = code.split('\n').filter((l) => l.includes('manifest.json'));
    assert.equal(
      refs.length,
      1,
      `the exporter should name manifest.json exactly once, to read and verify it; found ${refs.length}: ${refs.join(' | ')}`,
    );
    assert.match(refs[0]!, /CANONICAL_MANIFEST\s*=/, 'the one manifest.json reference must be the canonical read path');
  });

  it('the viewer reads the atlas path, never the canonical one', () => {
    const src = readFileSync(join(repoRoot, 'apps', 'web', 'src', 'atlas', 'AtlasViewer.tsx'), 'utf8');
    assert.match(src, /\/anatomy\/atlas\/shoulder\/right\//);
    assert.ok(
      !/['"`]\/anatomy\/shoulder\/right\//.test(src),
      'the viewer still points at the canonical asset root',
    );

    const scene = readFileSync(join(repoRoot, 'apps', 'web', 'src', 'atlas', 'atlas-scene.ts'), 'utf8');
    assert.match(scene, /atlas-manifest\.json/, 'the scene must fetch the atlas manifest by name');
    assert.ok(
      !/\$\{this\.opts\.assetRoot\}manifest\.json/.test(scene),
      'the scene still fetches `manifest.json`, which in this directory is the canonical contract',
    );
  });

  it('the atlas and canonical trees are separate directories that both exist', () => {
    // If these ever collapse into one, the split is gone regardless of what the
    // documents say.
    assert.ok(existsSync(CANONICAL_ROOT), 'canonical generated tree is missing');
    assert.ok(existsSync(ATLAS_ROOT), 'atlas tree is missing');
    assert.notEqual(CANONICAL_ROOT, ATLAS_ROOT);
  });

  it('every atlas manifest is mirrored into public/ for the viewer to fetch', () => {
    for (const { region, side, path } of ATLAS) {
      const mirrored = join(repoRoot, 'apps', 'web', 'public', 'anatomy', 'atlas', region, side, 'atlas-manifest.json');
      assert.ok(existsSync(mirrored), `${region}/${side} atlas manifest is not mirrored to public/`);
      assert.equal(
        readFileSync(mirrored, 'utf8'),
        readFileSync(path, 'utf8'),
        `${region}/${side} the public copy has drifted from the tracked one`,
      );
    }
  });

  it('the geometry the atlas manifest describes is actually present', () => {
    for (const { region, side, path } of ATLAS) {
      const doc = JSON.parse(readFileSync(path, 'utf8')) as {
        atlas: { file: string; objects: number; bytes: number };
        bodyContext: { file: string; bytes: number };
      };
      for (const part of [doc.atlas, doc.bodyContext]) {
        const p = join(repoRoot, 'assets', 'anatomy', 'atlas', region, side, part.file);
        assert.ok(existsSync(p), `${part.file} is referenced by the manifest but missing`);
        // Recorded byte counts are a cheap check that the file is the one the
        // manifest was built against, and not a stale copy.
        assert.equal(statSync(p).size, part.bytes, `${part.file} size does not match the manifest`);
      }
    }
  });
});