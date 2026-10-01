/**
 * What a 3D pick means, and what follows from it.
 *
 * These tests are the record of three behaviours that were wrong and are now pinned
 * down. Each of them was invisible before, because the click handler destructured
 * `hit.subRegionId` and did nothing at all when it was absent:
 *
 *   1. clicking a structure reachable from SEVERAL sub-regions did nothing;
 *   2. clicking one with a SINGLE sub-region set the area and recorded no structure;
 *   3. the surface point was discarded, so a click on real mesh never made a pin.
 *
 * Plus the one that mattered most: a multi-sub-region structure must never acquire
 * a sub-region the user did not choose. `subRegionIds[0]` is the specific mistake
 * this whole contract exists to prevent, so it gets its own test by name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describePick,
  intentFromPick,
  needsAreaChoice,
  reducePickToDraft,
} from '../src/anatomy/pick-intent.ts';
import type { PickResult } from '../src/anatomy/types.ts';

/**
 * A real pick, as the renderer emits it.
 *
 * `subRegionId` is set ONLY when there is exactly one sub-region — that is the whole
 * reason the old handler was broken, so these fixtures reproduce the two shapes
 * rather than always populating the convenient field.
 */
function pick(over: Partial<PickResult> = {}): PickResult {
  return {
    kind: 'structure',
    asiId: 'asi:shoulder.deltoid',
    structureId: 'asi:shoulder.deltoid',
    subRegionIds: ['shoulder.anterior', 'shoulder.lateral'],
    point: { x: 0.51, y: 0.48 },
    ...over,
  };
}

/* ================================================================== */
/* 1. a multi-sub-region structure                                    */
/* ================================================================== */

test('a structure reachable from several sub-regions is still selected', () => {
  const intent = intentFromPick(pick(), null);
  // The bug: `subRegionId` is absent here, so the old handler returned and the click
  // was lost entirely. Selecting the structure does not depend on the area.
  assert.equal(intent.kind, 'structure');
  if (intent.kind !== 'structure') return;
  assert.equal(intent.structureId, 'asi:shoulder.deltoid');
});

test('a multi-sub-region structure with no matching area is UNRESOLVED, never [0]', () => {
  const intent = intentFromPick(pick(), null);
  assert.equal(intent.kind, 'structure');
  if (intent.kind !== 'structure') return;
  assert.equal(intent.subRegion.kind, 'unresolved');
  if (intent.subRegion.kind !== 'unresolved') return;
  assert.deepEqual(intent.subRegion.candidates, ['shoulder.anterior', 'shoulder.lateral']);
  // The explicit assertion: nothing named a sub-region.
  assert.equal(
    (intent.subRegion as { subRegionId?: string }).subRegionId,
    undefined,
    'an unresolved pick invented a sub-region',
  );
  assert.equal(needsAreaChoice(intent), true);
});

test('a multi-sub-region structure KEEPS an area the user already chose', () => {
  // Someone who said "front of shoulder" and then clicked a deltoid meant that
  // deltoid in the front, not a reset to whichever sub-region is listed first.
  for (const current of ['shoulder.anterior', 'shoulder.lateral'] as const) {
    const intent = intentFromPick(pick(), current);
    assert.equal(intent.kind, 'structure');
    if (intent.kind !== 'structure') return;
    assert.deepEqual(intent.subRegion, { kind: 'keep', subRegionId: current });
    assert.equal(needsAreaChoice(intent), false);
  }
});

test('an area that is NOT one of the structure\'s does not get kept', () => {
  const intent = intentFromPick(pick(), 'shoulder.posterior');
  assert.equal(intent.kind, 'structure');
  if (intent.kind !== 'structure') return;
  assert.equal(intent.subRegion.kind, 'unresolved', 'kept an area the structure is not in');
});

/* ================================================================== */
/* 2. a single-sub-region structure                                    */
/* ================================================================== */

test('a structure with exactly one sub-region adopts it', () => {
  const intent = intentFromPick(
    pick({ structureId: 'asi:shoulder.acromion', subRegionIds: ['shoulder.lateral'], subRegionId: 'shoulder.lateral' }),
    null,
  );
  assert.equal(intent.kind, 'structure');
  if (intent.kind !== 'structure') return;
  assert.deepEqual(intent.subRegion, { kind: 'use', subRegionId: 'shoulder.lateral' });
  assert.equal(needsAreaChoice(intent), false);
});

test('a single-sub-region structure records the STRUCTURE, which is the second bug', () => {
  // The old handler called onSubRegion and returned, so a click on a structure with
  // one sub-region never reached location.userSelectedStructureIds at all.
  const intent = intentFromPick(pick({ subRegionIds: ['shoulder.lateral'], subRegionId: 'shoulder.lateral' }), null);
  assert.equal(intent.kind, 'structure');
  if (intent.kind !== 'structure') return;
  assert.equal(intent.structureId, 'asi:shoulder.deltoid', 'the structure was dropped');
});

test('a structure with no sub-regions at all still selects, and asks for an area', () => {
  const intent = intentFromPick(pick({ subRegionIds: [] }), null);
  assert.equal(intent.kind, 'structure');
  if (intent.kind !== 'structure') return;
  assert.deepEqual(intent.subRegion, { kind: 'unresolved', candidates: [] });
  assert.equal(needsAreaChoice(intent), true);
});

/* ================================================================== */
/* 3. the point is a user location indication, not discarded            */
/* ================================================================== */

test('the surface point reaches the intent', () => {
  const point = { x: 0.51, y: 0.48 };
  const structure = intentFromPick(pick({ point }), null);
  assert.equal(structure.kind, 'structure');
  if (structure.kind === 'structure') assert.deepEqual(structure.point, point);

  const area = intentFromPick(
    pick({ kind: 'subregion', asiId: 'fixture:sub:shoulder.anterior:0', structureId: undefined, subRegionId: 'shoulder.anterior', point }),
    null,
  );
  assert.equal(area.kind, 'area');
  if (area.kind === 'area') assert.deepEqual(area.point, point);
});

test('a pick with no point yields null, never a fabricated one', () => {
  const intent = intentFromPick(pick({ point: undefined }), null);
  assert.equal(intent.kind, 'structure');
  if (intent.kind === 'structure') assert.equal(intent.point, null);
});

/* ================================================================== */
/* areas, and failing closed                                            */
/* ================================================================== */

test('a sub-region proxy selects an AREA and never invents a structure', () => {
  const intent = intentFromPick(
    pick({ kind: 'subregion', structureId: undefined, subRegionIds: ['shoulder.anterior'], subRegionId: 'shoulder.anterior' }),
    null,
  );
  assert.equal(intent.kind, 'area');
  if (intent.kind !== 'area') return;
  assert.equal(intent.subRegionId, 'shoulder.anterior');
  assert.equal('structureId' in intent, false, 'an area pick invented a structure selection');
});

test('a sub-region pick with no resolvable sub-region does nothing', () => {
  // A sub-region entry always has exactly one, so this is a contract violation and
  // must not be papered over by choosing one.
  const intent = intentFromPick(
    pick({ kind: 'subregion', structureId: undefined, subRegionIds: [], subRegionId: undefined }),
    null,
  );
  assert.equal(intent.kind, 'none');
  assert.equal(needsAreaChoice(intent), false);
});

test('a hit on nothing does nothing', () => {
  const intent = intentFromPick({ kind: 'none' }, null);
  assert.equal(intent.kind, 'none');
});

test('a structure pick with no resolvable structureId does nothing', () => {
  const intent = intentFromPick(pick({ structureId: undefined }), null);
  assert.equal(intent.kind, 'none');
});

/* ================================================================== */
/* wording                                                              */
/* ================================================================== */

test('the wording says pointed at, and never confirmed', () => {
  const unresolved = intentFromPick(pick(), null);
  const keep = intentFromPick(pick(), 'shoulder.anterior');
  const use = intentFromPick(pick({ subRegionIds: ['shoulder.lateral'], subRegionId: 'shoulder.lateral' }), null);
  const area = intentFromPick(
    pick({ kind: 'subregion', structureId: undefined, subRegionId: 'shoulder.anterior' }),
    null,
  );

  const sentences = [unresolved, keep, use, area].map((i) =>
    describePick(i, 'the rounded muscle on the outside'),
  );
  for (const sentence of sentences) {
    assert.match(sentence, /pointed at|selected/i, `unhelpful wording: ${sentence}`);
    assert.doesNotMatch(sentence, /confirm|diagnos|severity|risk/i, `clinical drift: ${sentence}`);
  }

  // The unresolved case must actually tell the user there is a choice to make.
  assert.match(describePick(unresolved, 'Deltoid'), /Choose an area/);
  assert.match(describePick(unresolved, 'Deltoid'), /2 places/);
});

test('a structure with no layTerm still produces a sentence', () => {
  const intent = intentFromPick(pick(), null);
  const sentence = describePick(intent, null);
  assert.ok(sentence.length > 0);
  assert.doesNotMatch(sentence, /  /, 'a missing label left a double space');
});
/* ================================================================== */
/* the draft reduction, which is what the UI actually applies           */
/* ================================================================== */

const DRAFT = { subRegionId: null as string | null, point: null as { x: number; y: number } | null };

test('an unresolved pick leaves the draft area EXACTLY as it was', () => {
  const intent = intentFromPick(pick(), null);
  const effect = reducePickToDraft(intent, DRAFT, null);
  assert.equal(effect.draft.subRegionId, null, 'an unresolved pick chose an area');
  // ...and the structure is still selected, because that part is certain.
  assert.equal(effect.selectStructureId, 'asi:shoulder.deltoid');
  assert.match(effect.announce, /Choose an area/);
});

test('an unresolved pick does not overwrite an area the user already drafted', () => {
  const draft = { subRegionId: 'shoulder.posterior', point: { x: 0.4, y: 0.4 } };
  const effect = reducePickToDraft(intentFromPick(pick(), null), draft, null);
  assert.equal(effect.draft.subRegionId, 'shoulder.posterior');
});

test('a keep resolves to the RECORD area, not the first candidate', () => {
  const effect = reducePickToDraft(
    intentFromPick(pick(), 'shoulder.lateral'),
    DRAFT,
    'shoulder.lateral',
  );
  assert.equal(effect.draft.subRegionId, 'shoulder.lateral', 'keep took the first candidate instead');
  assert.equal(effect.selectStructureId, 'asi:shoulder.deltoid');
});

test('a keep with no recorded area falls back to the draft rather than guessing', () => {
  const draft = { subRegionId: 'shoulder.posterior', point: null };
  const effect = reducePickToDraft(intentFromPick(pick(), null), draft, null);
  assert.equal(effect.draft.subRegionId, 'shoulder.posterior');
});

test('a unique candidate is adopted', () => {
  const intent = intentFromPick(
    pick({ subRegionIds: ['shoulder.lateral'], subRegionId: 'shoulder.lateral' }),
    null,
  );
  const effect = reducePickToDraft(intent, DRAFT, null);
  assert.equal(effect.draft.subRegionId, 'shoulder.lateral');
  assert.equal(effect.selectStructureId, 'asi:shoulder.deltoid');
});

test('an area pick sets the area and selects nothing', () => {
  const intent = intentFromPick(
    pick({ kind: 'subregion', structureId: undefined, subRegionIds: ['shoulder.anterior'], subRegionId: 'shoulder.anterior' }),
    null,
  );
  const effect = reducePickToDraft(intent, DRAFT, null);
  assert.equal(effect.draft.subRegionId, 'shoulder.anterior');
  assert.equal(effect.selectStructureId, null, 'an area pick invented a structure selection');
});

test('a pick point becomes the draft pin', () => {
  const effect = reducePickToDraft(intentFromPick(pick({ point: { x: 0.51, y: 0.48 } }), null), DRAFT, null);
  assert.deepEqual(effect.draft.point, { x: 0.51, y: 0.48 });
});

test('a pick with no point keeps the existing draft pin rather than dropping it', () => {
  const draft = { subRegionId: null, point: { x: 0.2, y: 0.3 } };
  const effect = reducePickToDraft(intentFromPick(pick({ point: undefined }), null), draft, null);
  assert.deepEqual(effect.draft.point, { x: 0.2, y: 0.3 }, 'a pin the user placed was lost');
});

test('an unresolvable pick changes nothing at all', () => {
  const draft = { subRegionId: 'shoulder.anterior', point: { x: 0.2, y: 0.3 } };
  const effect = reducePickToDraft(intentFromPick({ kind: 'none' }, null), draft, null);
  assert.deepEqual(effect.draft, draft);
  assert.equal(effect.selectStructureId, null);
});
