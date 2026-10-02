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
  MAPPINGS,
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

test('a structure with 3D names its laterality, and the mapping backs it', () => {
  for (const region of Object.keys(MAPPINGS)) {
    for (const entry of mappingFor(region)) {
      if (entry.expectAbsent) continue;
      const rep = representationFor(entry.asiId);
      if (rep.threeD.status !== 'available') continue;
      const declared = Object.entries(rep.threeD.sides);
      assert.ok(declared.length > 0, `${entry.asiId} is available but names no laterality`);
      for (const [side, capability] of declared) {
        if (!capability.available) continue;
        assert.ok(
          entry.candidates.some((c) => c.side === side),
          `${entry.asiId} declares ${side} available but the mapping has no ${side} candidate`,
        );
      }
    }
  }
});

test('every laterality key is one the canonical vocabulary defines', () => {
  // Guards against a second enum creeping in: the manifest's LateralitySchema is the
  // only list of sides that means anything, so a typo like 'midline ' must not parse.
  const parsed = RepresentationSchema.safeParse({
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', sides: { 'midline ': { available: true, componentCount: 1 } } },
  });
  assert.equal(parsed.success, false, 'a misspelled laterality was accepted');
});

/* ================================================================== */
/* the sides guard                                                     */
/* ================================================================== */

test('a build that produced the wrong side is refused', () => {
  const deltoidPart = deltoidPartIds()[0]!;
  const rep = representationFor(deltoidPart);
  if (rep.threeD.status !== 'available') throw new Error('expected available');
  const both = [{ laterality: 'left', componentCount: 1 }, { laterality: 'right', componentCount: 1 }];
  assert.doesNotThrow(() => assertSidesMatch(deltoidPart, rep.threeD, both));
  // Declares both sides, only one built: a lie. Which side the message names depends on
  // the record's key order, so assert the SHAPE of the complaint rather than one
  // particular wording -- otherwise this test fails for a reason that has nothing to do
  // with what it is checking.
  assert.throws(
    () => assertSidesMatch(deltoidPart, rep.threeD, [{ laterality: 'left', componentCount: 1 }]),
    /declares 3D available for (left|right) but no (left|right) build contains it/,
  );
  assert.throws(
    () => assertSidesMatch(deltoidPart, rep.threeD, []),
    /declares 3D available for (left|right) but no (left|right) build contains it/,
  );
});

test('a build with the wrong COMPONENT count is refused', () => {
  // The case that only exists because composites do: "left is available" would pass
  // for a left build that silently lost two of its seven vertebrae.
  const cervical = representationFor('asi:neck.cervical-spine');
  if (cervical.threeD.status !== 'available') throw new Error('expected available');
  assert.throws(
    () =>
      assertSidesMatch('asi:neck.cervical-spine', cervical.threeD, [
        { laterality: 'midline', componentCount: 4 },
      ]),
    /declares 7 midline component\(s\) but the midline build produced 4/,
  );
});

test('a side that was built but not declared is refused', () => {
  const cervical = representationFor('asi:neck.cervical-spine');
  if (cervical.threeD.status !== 'available') throw new Error('expected available');
  assert.throws(
    () =>
      assertSidesMatch('asi:neck.cervical-spine', cervical.threeD, [
        { laterality: 'midline', componentCount: 7 },
        { laterality: 'left', componentCount: 1 },
      ]),
    /has real left geometry but the declaration does not mention left/,
  );
});

test('an asymmetric source is representable without claiming completeness', () => {
  // The suboccipital case: six concepts on the left, four on the right, because rectus
  // capitis posterior major and minor have no right-side mesh in the archive. The only
  // honest declaration is left available and right explicitly unavailable with a reason.
  const suboccipital = representationFor('asi:neck.suboccipital');
  if (suboccipital.threeD.status !== 'available') throw new Error('expected available');
  assert.equal(suboccipital.threeD.sides.left?.available, true);
  assert.equal(suboccipital.threeD.sides.right?.available, false);
  assert.ok(
    suboccipital.threeD.sides.right && !suboccipital.threeD.sides.right.available
      ? suboccipital.threeD.sides.right.reason
      : false,
    'the unavailable right side must carry its own reason',
  );
});

/* ================================================================== */
/* schema                                                              */
/* ================================================================== */

test('the schema refuses a representation with nothing available', () => {
  // "available" with no laterality available is a contradiction: it claims geometry
  // and renders nothing. Checked in the schema so a declaration cannot ship it.
  assert.equal(
    RepresentationSchema.safeParse({
      twoD: { available: false },
      threeD: {
        status: 'available',
        sides: { left: { available: false, reason: 'no source mesh' } },
      },
    }).success,
    false,
  );
  assert.equal(
    RepresentationSchema.safeParse({
      twoD: { available: false },
      threeD: { status: 'available', sides: {} },
    }).success,
    false,
  );
  // A componentCount of zero is the same lie in a subtler form.
  assert.equal(
    RepresentationSchema.safeParse({
      twoD: { available: false },
      threeD: { status: 'available', sides: { left: { available: true, componentCount: 0 } } },
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

test('a composite may declare more than one element per side', () => {
  // One concept = one mesh is not true of real anatomy: the cervical spine is seven
  // vertebrae and the scalenes are three muscles. The per-laterality shape says so --
  // `componentCount` is per side, so a left suboccipital build is honestly "6" while the
  // right is not represented at all.
  const parsed = RepresentationSchema.safeParse({
    twoD: { available: false },
    threeD: {
      status: 'available',
      sides: {
        left: { available: true, componentCount: 6 },
        midline: { available: true, componentCount: 7 },
        right: { available: false, reason: 'no right-side mesh for two of the six concepts' },
      },
    },
  });
  assert.equal(parsed.success, true);
});

test('a MIDLINE representation parses, and it is not a side', () => {
  // The cervical vertebrae are real midline geometry. Before the per-laterality schema
  // there was no way to say that: `sides` was a left/right pair, so a midline concept
  // could only be recorded as unavailable, which is a different and wrong claim.
  const parsed = RepresentationSchema.safeParse({
    twoD: { available: false },
    threeD: { status: 'available', sides: { midline: { available: true, componentCount: 7 } } },
  });
  assert.equal(parsed.success, true);
});