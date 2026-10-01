/**
 * Representation capability: what we can draw, as distinct from what exists.
 *
 * Two failure modes are being prevented, and both look reasonable in review:
 *
 *   - deleting a structure from the anatomy model because no asset was found for it,
 *     which erases a real bone from the product's vocabulary; and
 *   - binding that structure to an anatomically broader or merely plausible mesh, so
 *     the viewer renders something believable that is not what the user pointed at.
 *
 * So the two questions are separate types with separate answers, and "no mesh" is
 * always one of a closed set of reason codes rather than a boolean.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStructure, REGIONS } from '../src/anatomy.ts';
import {
  SHOULDER_MAPPING,
  DELTOID_PARTS,
  deltoidPartIds,
  mappingFor,
} from '../src/anatomy-mapping.ts';
import {
  RepresentationSchema,
  assertSidesMatch,
  declaredRepresentationGaps,
  hasThreeD,
  isPlaceholder2D,
  representationFor,
  threeDGapFor,
} from '../src/anatomy-representation.ts';

/**
 * The reason a structure cannot be drawn in 3D.
 *
 * Narrowing on `status` rather than asserting `?.reason` directly, because the two
 * variants are a discriminated union and `?.` on a property only present on one arm is
 * exactly the shape that quietly reads `undefined` and passes a `!== 'x'` assertion.
 */
function reasonOf(asiId: string): string {
  const gap = threeDGapFor(asiId);
  assert.ok(gap, `${asiId} was expected to have a 3D gap`);
  if (gap?.status !== 'unavailable')
    throw new Error(`${asiId} is available, so it has no gap reason`);
  return gap.reason;
}

/* ================================================================== */
/* identity and capability are different questions                      */
/* ================================================================== */

test('a structure with no 3D source is still IN the anatomy model', () => {
  // The acromion is a bone whether or not this dataset ships an isolated mesh.
  const acromion = getStructure('asi:shoulder.acromion');
  assert.ok(acromion, 'the acromion must exist as an anatomical concept');
  assert.equal(threeDGapFor(acromion)?.status, 'unavailable');
  assert.equal(hasThreeD(acromion), false);
  // And it is still selectable from the lateral view.
  assert.ok(
    REGIONS.shoulder.subRegions
      .find((s) => s.id === 'shoulder.lateral')
      ?.structures.some((s) => s.id === 'asi:shoulder.acromion'),
    'the acromion must remain selectable even with no 3D',
  );
});

test('unavailable is never reported as anatomically absent', () => {
  for (const gap of declaredRepresentationGaps()) {
    const structure = getStructure(gap.asiId);
    assert.ok(structure, `${gap.asiId} is declared a 3D gap but is not in the anatomy model`);
    assert.ok(gap.reason.length > 0);
    assert.ok(gap.detail.length > 10, `${gap.asiId} has no explanation`);
  }
});

test('the reason codes are the honest ones, chosen per structure', () => {
  // Absent from the SOURCE, which is a different situation from "present but we
  // have not drawn it", and a different one again from "a space".
  for (const id of [
    'asi:shoulder.acromion',
    'asi:shoulder.coracoid',
    'asi:shoulder.glenohumeral-joint',
    'asi:shoulder.acromioclavicular-joint',
    'asi:shoulder.spine-of-scapula',
  ])
    assert.equal(reasonOf(id), 'no-source-concept', id);

  assert.equal(reasonOf('asi:shoulder.subacromial-bursa'), 'non-solid-space');
  // The deltoid is NOT absent from the source; it is a composite we do not join.
  assert.equal(reasonOf('asi:shoulder.deltoid'), 'composite-unsupported');
});

test('an unreviewed structure reports not-yet-sourced, not unavailable', () => {
  // Nothing has been checked, so claiming either availability or unavailability
  // would be a claim about a source nobody has read.
  const rep = representationFor('asi:never:reviewed');
  assert.equal(rep.threeD.status, 'unavailable');
  if (rep.threeD.status === 'unavailable') {
    assert.equal(rep.threeD.reason, 'not-yet-sourced');
  }
});

/* ================================================================== */
/* 2D and 3D are independent                                            */
/* ================================================================== */

test('a structure can be 2D-capable and 3D-unavailable', () => {
  const rep = representationFor('asi:shoulder.acromion');
  assert.equal(rep.twoD.available, true);
  assert.equal(rep.threeD.status, 'unavailable');
});

test('the hand-built body map is declared PLACEHOLDER, not medical content', () => {
  // Phase 1A's 2D geometry was drawn by hand to answer "is the viewer usable"
  // before any external 2D library existed. Honest to render, wrong to ship, so the
  // flag travels with the capability and a production asset cannot be mistaken for it.
  assert.equal(isPlaceholder2D('asi:shoulder.deltoid'), true);
  assert.equal(isPlaceholder2D('asi:shoulder.acromion'), true);
});

/* ================================================================== */
/* the deltoid, part level                                             */
/* ================================================================== */

test('the deltoid composite exists AND its three parts exist', () => {
  assert.ok(getStructure('asi:shoulder.deltoid'), 'the composite must stay a concept');
  for (const id of deltoidPartIds()) {
    const part = getStructure(id);
    assert.ok(part, `part ${id} must exist in the anatomy model`);
    assert.equal(part?.layer, 'muscle');
  }
  assert.equal(DELTOID_PARTS.length, 3);
});

test('the parts are named after the SOURCE, not renamed to fit our sub-regions', () => {
  // anterior/middle/posterior would be our vocabulary imposed on its data, which is
  // the mistake the original mapping table made once already.
  const parts = DELTOID_PARTS.map((p) => p.part);
  assert.deepEqual(parts, ['clavicular', 'acromial', 'spinal']);
  for (const p of DELTOID_PARTS) {
    assert.ok(getStructure(p.asiId)?.label.toLowerCase().includes(p.part));
    assert.ok(p.fmaRight && p.fmaLeft, `${p.part} has no FMA binding`);
    assert.notEqual(p.rightMesh, p.leftMesh);
  }
});

test('every deltoid part is BOUND in the mapping, and the composite is not', () => {
  const mapping = mappingFor('shoulder');
  const bound = new Set(mapping.filter((e) => !e.expectAbsent).map((e) => e.asiId));
  for (const p of DELTOID_PARTS) assert.ok(bound.has(p.asiId), `${p.asiId} is not bound`);
  // The composite must NOT be bindable, or one part gets rendered as the whole muscle.
  const composite = mapping.find((e) => e.asiId === 'asi:shoulder.deltoid');
  assert.ok(composite?.expectAbsent, 'the composite deltoid must be expected-absent');
});

test('each deltoid part declares the side its OWN mesh carries', () => {
  const mapping = mappingFor('shoulder');
  for (const p of DELTOID_PARTS) {
    const entry = mapping.find((e) => e.asiId === p.asiId)!;
    const right = entry.candidates.find((c) => c.side === 'right')!;
    const left = entry.candidates.find((c) => c.side === 'left')!;
    assert.equal(right.meshName, p.rightMesh);
    assert.equal(left.meshName, p.leftMesh);
    assert.equal(right.fmaConceptId, p.fmaRight);
    assert.equal(left.fmaConceptId, p.fmaLeft);
  }
});

/* ================================================================== */
/* no silent binding of an unavailable structure                        */
/* ================================================================== */

test('no unavailable structure has a bindable candidate name', () => {
  // The specific failure: `expectAbsent` documents an expectation but does not skip
  // the lookup, so a real-looking candidate would bind the moment such a file existed
  // -- rendering the acromion as a whole scapula, for instance.
  for (const entry of SHOULDER_MAPPING) {
    if (!entry.expectAbsent) continue;
    for (const c of entry.candidates) {
      assert.match(
        c.meshName,
        /^UNAVAILABLE:/,
        `${entry.asiId} is expected-absent but names a plausible mesh "${c.meshName}"`,
      );
      assert.equal(c.side, 'not_applicable');
      assert.equal(c.sourceLabel, null);
    }
  }
});

test('a structure declared unavailable in 3D is never marked available', () => {
  for (const gap of declaredRepresentationGaps()) {
    assert.equal(hasThreeD(gap.asiId), false, `${gap.asiId} has a declared gap and also claims 3D`);
  }
});

test('a structure with 3D claims a side, and only one', () => {
  for (const entry of SHOULDER_MAPPING) {
    if (entry.expectAbsent) continue;
    const rep = representationFor(entry.asiId);
    if (rep.threeD.status !== 'available') continue;
    assert.ok(rep.threeD.sides.length > 0);
    // The declared sides must exist as candidates in the mapping.
    for (const side of rep.threeD.sides)
      assert.ok(
        entry.candidates.some((c) => c.side === side),
        `${entry.asiId} declares ${side} but the mapping has no such candidate`,
      );
  }
});

/* ================================================================== */
/* the sides guard                                                     */
/* ================================================================== */

test('a build that produced the wrong side is refused', () => {
  const deltoidPart = deltoidPartIds()[0]!;
  const rep = representationFor(deltoidPart);
  if (rep.threeD.status !== 'available') throw new Error('expected available');
  // Declares left, build produced left: fine.
  assert.doesNotThrow(() => assertSidesMatch(deltoidPart, rep.threeD, ['left']));
  // Declares left, build produced right only: a lie, and now a thrown error.
  assert.throws(() => assertSidesMatch(deltoidPart, rep.threeD, ['right']), /declares 3D for left/);
  assert.throws(() => assertSidesMatch(deltoidPart, rep.threeD, []), /produced only nothing/);
});

/* ================================================================== */
/* schema                                                              */
/* ================================================================== */

test('the schema refuses a representation with no sides', () => {
  // A side is not optional: "available" without one is how a build ends up claiming
  // geometry for a side it never loaded.
  assert.equal(
    RepresentationSchema.safeParse({
      twoD: { available: false },
      threeD: { status: 'available', elementCount: 1, sides: [] },
    }).success,
    false,
  );
  assert.equal(
    RepresentationSchema.safeParse({
      twoD: { available: false },
      threeD: { status: 'unavailable', reason: 'made-up-reason' },
    }).success,
    false,
    'an invented reason code must not validate',
  );
});

test('a composite may declare more than one element', () => {
  // One concept = one mesh is not true of real anatomy, and the schema must not
  // pretend otherwise.
  const parsed = RepresentationSchema.safeParse({
    twoD: { available: false },
    threeD: { status: 'available', elementCount: 3, sides: ['left', 'right'] },
  });
  assert.equal(parsed.success, true);
});