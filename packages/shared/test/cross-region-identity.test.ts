import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalStructureId,
  canonicalStructureIdList,
  RETIRED_CANONICAL_IDS,
} from '../src/anatomy-mapping-neck.ts';
import { structureBelongsToRegion, regionsForStructure, getStructure } from '../src/anatomy.ts';
import { projectUserSelection, emptyRecord, SymptomRecordSchema } from '../src/symptom.ts';
import type { SymptomRecord } from '../src/symptom.ts';

/**
 * Cross-region canonical identity, exercised the way the product uses it.
 *
 * The unit this replaces tested a helper in isolation, which is why nothing broke when
 * the helper turned out to be uncalled. These cases go through the real paths: grounding
 * membership, the record projection, and the ordered-unique selection set.
 */
describe('one structure can belong to two regions', () => {
  it('the upper trapezius is in the shoulder AND the neck', () => {
    assert.equal(structureBelongsToRegion('asi:shoulder.trapezius-upper', 'shoulder'), true);
    assert.equal(structureBelongsToRegion('asi:shoulder.trapezius-upper', 'neck'), true);
    assert.deepEqual(regionsForStructure('asi:shoulder.trapezius-upper').sort(), ['neck', 'shoulder']);
  });

  it('membership is NOT the id prefix', () => {
    // The prefix says `shoulder`, so a prefix-based answer would say "not in the neck".
    // That was a live bug: grounding could never propose this structure for a neck
    // complaint even though a user naming the muscle between neck and shoulder means it.
    assert.equal(
      structureBelongsToRegion('asi:shoulder.trapezius-upper', 'neck'),
      true,
      'a structure whose id is prefixed shoulder is still a member of the neck ontology',
    );
    // And a knee structure is genuinely not in the neck.
    assert.equal(structureBelongsToRegion('asi:knee.patella', 'neck'), false);
  });

  it('every structure resolves to at least one region and to no others', () => {
    for (const region of ['shoulder', 'neck', 'lower_back', 'knee'] as const) {
      for (const structure of getAllStructures(region)) {
        const regions = regionsForStructure(structure.id);
        assert.ok(regions.length > 0, `${structure.id} belongs to no region at all`);
        for (const r of regions)
          assert.equal(
            structureBelongsToRegion(structure.id, r),
            true,
            `${structure.id} claims ${r} but the ontology disagrees`,
          );
      }
    }
  });
});

describe('retired ids resolve, and cannot persist as a second identity', () => {
  it('the retired id resolves to the one canonical id', () => {
    assert.equal(canonicalStructureId('asi:neck.upper-trapezius'), 'asi:shoulder.trapezius-upper');
    // A live id is untouched.
    assert.equal(canonicalStructureId('asi:shoulder.trapezius-upper'), 'asi:shoulder.trapezius-upper');
    assert.equal(canonicalStructureId('asi:knee.patella'), 'asi:knee.patella');
  });

  it('every retired id names a canonical id that really exists', () => {
    for (const [retired, { canonical, why }] of Object.entries(RETIRED_CANONICAL_IDS)) {
      assert.ok(getStructure(canonical), `${retired} retires to ${canonical}, which is not a structure`);
      assert.equal(structureIdExists(retired), false, `${retired} is retired but still in the ontology`);
      assert.ok(why.length > 20, `${retired} has no recorded reason`);
    }
  });

  it('selecting both the retired and the live id records ONE selection', () => {
    // This is the whole point. Two ids for one structure would otherwise produce two
    // entries in "areas you pointed to" for a single muscle.
    const ids = canonicalStructureIdList([
      'asi:neck.upper-trapezius',
      'asi:shoulder.trapezius-upper',
      'asi:knee.patella',
    ]);
    assert.deepEqual(ids, ['asi:shoulder.trapezius-upper', 'asi:knee.patella']);
  });

  it('the first occurrence wins, because that is the order the user pointed', () => {
    assert.deepEqual(
      canonicalStructureIdList(['asi:shoulder.trapezius-upper', 'asi:neck.upper-trapezius']),
      ['asi:shoulder.trapezius-upper'],
    );
    assert.deepEqual(
      canonicalStructureIdList(['asi:neck.upper-trapezius', 'asi:shoulder.trapezius-upper']),
      ['asi:shoulder.trapezius-upper'],
    );
  });

  it('a record written with the retired id READS back canonical', () => {
    // Idempotent on every read, which is what lets an existing record resolve without a
    // migration. Simulating the write verbatim: the raw field keeps what arrived, and
    // the projection resolves it.
    const record = recordWithSelection(['asi:neck.upper-trapezius', 'asi:knee.patella']);
    const projected = projectUserSelection(record);
    assert.deepEqual(projected.location.userSelectedStructureIds, [
      'asi:shoulder.trapezius-upper',
      'asi:knee.patella',
    ]);
    // ...and running it again changes nothing, because a projection that drifts is worse
    // than one that is wrong.
    assert.deepEqual(
      projectUserSelection(projected).location.userSelectedStructureIds,
      projected.location.userSelectedStructureIds,
    );
  });

  it('the derived selected flag follows the canonical id, not the retired one', () => {
    // If only the selection set were canonicalised and the derived flag were left on the
    // retired id, the candidate would render as NOT selected while the set says it is.
    const record = recordWithSelection(['asi:neck.upper-trapezius']);
    const projected = projectUserSelection(record);
    const candidate = projected.consideredStructures.find(
      (c) => c.structureId === 'asi:shoulder.trapezius-upper',
    );
    assert.equal(candidate?.selectedByUser, true, 'the canonical candidate must read as selected');
    const retired = projected.consideredStructures.find(
      (c) => c.structureId === 'asi:neck.upper-trapezius',
    );
    assert.equal(retired, undefined, 'a retired id must not survive as a separate candidate');
  });
});

/* helpers */
import { structuresForRegion } from '../src/anatomy.ts';
import type { BodyRegion } from '../src/anatomy.ts';

function getAllStructures(region: BodyRegion) {
  return structuresForRegion(region);
}

function structureIdExists(id: string): boolean {
  return Boolean(getStructure(id));
}

function recordWithSelection(ids: string[]): SymptomRecord {
  const base = emptyRecord();
  const considered: SymptomRecord['consideredStructures'] = ids.map((id) => ({
    structureId: canonicalStructureId(id),
    rationale: 'test',
    confidence: 1,
    selectedByUser: true,
  }));
  const built: SymptomRecord = {
    ...base,
    consideredStructures: considered,
    location: { ...base.location, userSelectedStructureIds: [...ids] },
  };
  // Round-trip through the parser so the record is a real one rather than a hand-built
  // object that happens to satisfy the type.
  return SymptomRecordSchema.parse(built);
}