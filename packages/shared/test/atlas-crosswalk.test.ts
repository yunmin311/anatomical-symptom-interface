import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertCanonicalStructureId,
  buildSelectableIndex,
  resolveAtlasSelection,
  VIEW_ONLY_REASON,
  DerivedViewGridSchema,
  type DerivedViewGrid,
} from '../src/anatomy-atlas-crosswalk.ts';
import { AtlasManifestSchema } from '../src/anatomy-atlas-manifest.ts';
import { getStructure } from '../src/anatomy.ts';

/**
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 * A raw BodyParts3D id must never become a persisted SymptomRecord structure id.
 *
 * The Atlas carries 43 right-shoulder structures; the ASI ontology has 10. The
 * other 33 -- clavicle, humerus, every axillary vessel -- have no canonical
 * identity, and there is no honest way to invent one. They stay fully usable as
 * view content: searchable, hoverable, isolatable, hideable, good spatial context.
 *
 * What they may not do is enter `location.userSelectedStructureIds`, which is a
 * set of canonical ids the domain resolves. That is what these tests hold.
 *
 * The Atlas is a presentation product. It may show more anatomy than the record
 * can name. It may not widen the record to match.
 */

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const ATLAS_MANIFEST = join(repoRoot, 'assets', 'anatomy', 'atlas', 'shoulder', 'right', 'atlas-manifest.json');

const atlas = AtlasManifestSchema.parse(JSON.parse(readFileSync(ATLAS_MANIFEST, 'utf8')));
const structures = atlas.structures;

describe('a raw BodyParts3D id is never a persistable structure id', () => {
  it('rejects the bp3d prefix outright, even for a structure that maps', () => {
    // FJ3384 IS the scapula and DOES map to asi:shoulder.scapula. The raw id is
    // still refused: the canonical id is the only thing allowed in the record, and
    // a bridge that passed the raw id through would be relying on the domain
    // happening to understand a foreign id scheme.
    assert.throws(
      () => assertCanonicalStructureId('bp3d:FJ3384'),
      /refusing to persist a raw BodyParts3D id/,
    );
  });

  it('rejects any bp3d id, view-only or not', () => {
    for (const s of structures) {
      assert.throws(() => assertCanonicalStructureId(s.id), /raw BodyParts3D id/, `${s.id} was accepted`);
    }
  });

  it('accepts a canonical asi id that resolves', () => {
    const scapula = structures.find((s) => s.canonicalAsiId === 'asi:shoulder.scapula');
    // Narrowed with the optional chain, not just asserted. `assert.ok(scapula)` tells
    // the reader the fixture is right; it does not narrow `scapula.canonicalAsiId`,
    // which is `string | null`, so the call on the next line stayed a type error.
    assert.ok(scapula?.canonicalAsiId, 'expected the scapula to be in the atlas manifest');
    assert.equal(assertCanonicalStructureId(scapula.canonicalAsiId), 'asi:shoulder.scapula');
  });

  it('rejects a well-formed id the domain does not know', () => {
    assert.throws(
      () => assertCanonicalStructureId('asi:shoulder.not-a-real-structure'),
      /not a structure the domain knows/,
    );
  });

  it('rejects a canonical id from the wrong region', () => {
    assert.throws(
      () => assertCanonicalStructureId('asi:shoulder.scapula', 'knee' as never),
      /belongs to shoulder, not knee/,
    );
  });

  it('no atlas structure id is ever mistaken for an asi id', () => {
    // The two vocabularies must not overlap. If they ever did, the prefix check
    // would be the only thing standing between them.
    for (const s of structures) {
      assert.ok(!s.id.startsWith('asi:'), `${s.id} looks canonical`);
      if (s.canonicalAsiId) assert.match(s.canonicalAsiId, /^asi:[a-z_]+\.[a-z0-9-]+$/);
    }
  });
});

describe('resolving an atlas selection', () => {
  it('gives every structure an answer, and the answer is total', () => {
    for (const s of structures) {
      const outcome = resolveAtlasSelection(s);
      assert.equal(outcome.atlasStructureId, s.id);
      assert.ok(outcome.writable === true || outcome.writable === false);
      if (!outcome.writable) assert.equal(outcome.reason, VIEW_ONLY_REASON);
    }
  });

  it('a mapped structure resolves to its canonical id', () => {
    const scapula = structures.find((s) => s.canonicalAsiId === 'asi:shoulder.scapula');
    assert.ok(scapula);
    const outcome = resolveAtlasSelection(scapula);
    assert.equal(outcome.writable, true);
    if (outcome.writable) {
      assert.equal(outcome.canonicalAsiId, 'asi:shoulder.scapula');
      assert.ok(getStructure(outcome.canonicalAsiId), 'the canonical id must resolve');
    }
  });

  it('a view-only structure resolves to no write target at all', () => {
    const clavicle = structures.find((s) => s.label.includes('clavicle'));
    assert.ok(clavicle, 'expected a clavicle in the atlas');
    assert.equal(clavicle.canonicalAsiId, null, 'the clavicle has no canonical mapping');
    const outcome = resolveAtlasSelection(clavicle);
    assert.equal(outcome.writable, false);
    assert.ok(!('canonicalAsiId' in outcome), 'a view-only outcome must carry no id to write');
  });

  it('refuses a structure that claims selectable but names nothing', () => {
    // A generated manifest bug, not a hypothetical: this is exactly what would
    // happen if the crosswalk derivation ever lost its mesh join.
    const outcome = resolveAtlasSelection({
      id: 'bp3d:FJ9999',
      label: 'Something with no mapping',
      canonicalAsiId: null,
      symptomRecordSelectable: true,
    });
    assert.equal(outcome.writable, false);
  });

  it('refuses a structure that names an id the domain does not know', () => {
    const outcome = resolveAtlasSelection({
      id: 'bp3d:FJ9998',
      label: 'Names a structure that does not exist',
      canonicalAsiId: 'asi:shoulder.fabricated',
      symptomRecordSelectable: true,
    });
    assert.equal(outcome.writable, false);
  });

  it('refuses a writable id from the wrong region', () => {
    const outcome = resolveAtlasSelection({
      id: 'bp3d:FJ9997',
      label: 'A knee structure in a shoulder atlas',
      canonicalAsiId: 'asi:knee.patella',
      symptomRecordSelectable: true,
    });
    // Resolvable, so technically writable by resolveAtlasSelection -- which is why
    // the region guard lives in assertCanonicalStructureId. Asserted here so the
    // split of responsibility stays deliberate rather than accidental.
    assert.equal(outcome.writable, true);
    assert.throws(
      () => assertCanonicalStructureId('asi:knee.patella', 'shoulder' as never),
      /belongs to knee, not shoulder/,
    );
  });
});

describe('the atlas offers strictly more than the record can name, and no less', () => {
  const index = buildSelectableIndex(structures);

  it('every structure is in the index', () => {
    assert.equal(index.all.length, structures.length);
    assert.equal(new Set(index.all).size, structures.length, 'ids must be unique');
  });

  it('writable entries are a strict, non-empty subset', () => {
    assert.ok(index.writable.size > 0, 'nothing would be recordable');
    assert.ok(index.writable.size < structures.length, 'everything being recordable defeats the crosswalk');
  });

  it('every writable id maps to a resolvable canonical structure', () => {
    for (const [atlasId, canonical] of index.toCanonical) {
      assert.ok(index.writable.has(atlasId));
      assert.ok(getStructure(canonical), `${atlasId} -> ${canonical} does not resolve`);
    }
  });

  it('the writable count equals the canonical shoulder entry count', () => {
    // The strongest available cross-check: the atlas must make exactly the
    // structures available that the canonical manifest claims, no more. If this
    // drifts, either the crosswalk has grown mappings the domain has not, or it
    // has lost ones it had.
    const canonical = JSON.parse(
      readFileSync(join(repoRoot, 'assets', 'anatomy', 'generated', 'shoulder', 'right', 'manifest.json'), 'utf8'),
    ) as { entries: { asiId: string }[] };
    assert.equal(
      index.writable.size,
      canonical.entries.length,
      `atlas offers ${index.writable.size} writable structures, canonical manifest has ${canonical.entries.length}`,
    );
    for (const e of canonical.entries) {
      assert.ok(
        [...index.toCanonical.values()].includes(e.asiId),
        `${e.asiId} is canonical but the atlas cannot offer it`,
      );
    }
  });

  it('view-only structures are still fully usable as view content', () => {
    // The freeze is on WRITING, not on seeing. A structure with no canonical id
    // must still be present in the index, searchable and displayable.
    for (const s of structures) {
      assert.ok(index.all.includes(s.id), `${s.id} must remain viewable`);
      assert.ok(s.label.length > 0, `${s.id} needs a name to be searchable by`);
    }
  });
});

describe('derived 2D hit maps resolve through the same identity as 3D', () => {
  const VIEWS_DIR = join(repoRoot, 'assets', 'anatomy', 'generated', 'views');
  const VIEWS = ['front', 'back', 'left', 'right'] as const;
  const LAYERS = ['surface', 'bone', 'muscle', 'vascular'] as const;

  const known = new Set(structures.map((s) => s.id));
  const writableIds = buildSelectableIndex(structures).writable;

  for (const view of VIEWS) {
    for (const layer of LAYERS) {
      it(`${view}/${layer} names only atlas structures the manifest also has`, () => {
        const path = join(VIEWS_DIR, `shoulder-${view}-${layer}.grid.json`);
        if (!existsSync(path)) return; // not derived for this pair yet
        const raw = DerivedViewGridSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
        for (const sid of raw.structures) {
          assert.ok(known.has(sid), `${sid} is in the 2D grid but not the atlas manifest`);
        }
      });

      it(`${view}/${layer} selectable flag agrees with its own content`, () => {
        const path = join(VIEWS_DIR, `shoulder-${view}-${layer}.grid.json`);
        if (!existsSync(path)) return;
        const raw = DerivedViewGridSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
        const named = raw.structures.filter((_, i) =>
          raw.rows.some((row) => row.some(([, , si]) => si === i)),
        );
        assert.equal(
          raw.selectable,
          named.length > 0,
          'selectable must agree with whether any cell resolves to a structure',
        );
      });
    }
  }

  it('a 2D tap can only ever reach a canonical id through the crosswalk', () => {
    // The 2D grid carries atlas ids. Every path from there to the record must pass
    // resolveAtlasSelection, so assert the union of what a tap COULD name is a
    // subset of what is writable.
    for (const view of VIEWS) {
      for (const layer of LAYERS) {
        const path = join(VIEWS_DIR, `shoulder-${view}-${layer}.grid.json`);
        if (!existsSync(path)) continue;
        const raw = JSON.parse(readFileSync(path, 'utf8')) as DerivedViewGrid;
        for (const sid of raw.structures) {
          const outcome = resolveAtlasSelection(
            structures.find((s) => s.id === sid) ?? { id: sid, label: sid },
          );
          if (outcome.writable) assert.ok(writableIds.has(sid), `${sid} is writable but not in the index`);
          // Nothing to assert for the false case beyond it not producing an id,
          // which is what the type does.
        }
      }
    }
  });
});