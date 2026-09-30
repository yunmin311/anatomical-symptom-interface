/**
 * Canonical user selection.
 *
 * `location.userSelectedStructureIds` is the single source of truth for "the
 * user pointed at this". `consideredStructures[].selectedByUser` is a derived
 * projection of it.
 *
 * They used to be two independently writable copies of the same fact, so a
 * client could make a record where one candidate read as simultaneously
 * selected and unselected — and the summary would then list the structure under
 * BOTH "areas you pointed to" and "suggested, not acted on".
 *
 * These tests cover: inconsistent input in both directions, select, deselect,
 * rebuild, the summary, and that rationale/confidence survive all of it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyRecord, projectUserSelection, userSelectionIsConsistent } from '../src/symptom.ts';
import type { Episode, SymptomRecord } from '../src/symptom.ts';
import type { ConsideredStructure } from '../src/anatomy.ts';
import { buildPreVisitSummary } from '../src/summary.ts';

const PATELLA = 'asi:knee.patella';
const MENISCUS = 'asi:knee.meniscus-medial';

const cand = (over: Partial<ConsideredStructure> = {}): ConsideredStructure => ({
  structureId: PATELLA,
  rationale: 'You described something like "the kneecap".',
  confidence: 0.5,
  selectedByUser: false,
  ...over,
});

/** A record with two candidates, both unselected, and nothing selected. */
function base(): SymptomRecord {
  const r = emptyRecord('knee');
  r.consideredStructures = [cand(), cand({ structureId: MENISCUS, rationale: 'Nearby structure.', confidence: 0.4 })];
  return r;
}

const byId = (r: SymptomRecord, id: string) => r.consideredStructures.find((c) => c.structureId === id);

/* ================================================================== */
/* Inconsistent input                                                  */
/* ================================================================== */

test('a candidate claiming selection with no matching id is forced to unselected', () => {
  const r = base();
  // The hostile case: the flag says selected, the canonical set says no.
  r.consideredStructures[0]!.selectedByUser = true;
  assert.equal(userSelectionIsConsistent(r), false, 'input should be inconsistent to start with');

  const p = projectUserSelection(r);
  assert.equal(byId(p, PATELLA)?.selectedByUser, false, 'the canonical set wins');
  assert.equal(userSelectionIsConsistent(p), true);
});

test('a candidate denying selection that IS in the set is forced to selected', () => {
  const r = base();
  r.location.userSelectedStructureIds = [PATELLA];
  assert.equal(byId(r, PATELLA)?.selectedByUser, false, 'input should be inconsistent to start with');

  const p = projectUserSelection(r);
  assert.equal(byId(p, PATELLA)?.selectedByUser, true, 'the canonical set wins');
  assert.equal(userSelectionIsConsistent(p), true);
});

test('a selected id with no candidate is left alone, not invented', () => {
  // The user may point at a structure the model never suggested.
  const r = base();
  r.location.userSelectedStructureIds = ['asi:knee.lcl'];
  const p = projectUserSelection(r);
  assert.deepEqual(p.location.userSelectedStructureIds, ['asi:knee.lcl']);
  assert.equal(p.consideredStructures.some((c) => c.structureId === 'asi:knee.lcl'), false);
  assert.equal(byId(p, PATELLA)?.selectedByUser, false);
  assert.equal(byId(p, MENISCUS)?.selectedByUser, false);
});

test('an empty selection set means nothing is selected', () => {
  const r = base();
  r.consideredStructures[0]!.selectedByUser = true;
  r.consideredStructures[1]!.selectedByUser = true;
  const p = projectUserSelection(r);
  assert.ok(p.consideredStructures.every((c) => !c.selectedByUser));
  assert.equal(userSelectionIsConsistent(p), true);
});

/* ================================================================== */
/* Preservation                                                        */
/* ================================================================== */

test('projection preserves rationale, confidence and structureId exactly', () => {
  const r = base();
  r.location.userSelectedStructureIds = [PATELLA];
  r.consideredStructures[0]!.selectedByUser = false; // deliberately inconsistent
  const p = projectUserSelection(r);
  for (const id of [PATELLA, MENISCUS]) {
    assert.equal(byId(p, id)?.rationale, byId(r, id)?.rationale);
    assert.equal(byId(p, id)?.confidence, byId(r, id)?.confidence);
    assert.equal(byId(p, id)?.structureId, id);
  }
});

test('projection is idempotent', () => {
  const r = base();
  r.location.userSelectedStructureIds = [PATELLA, MENISCUS];
  const once = projectUserSelection(r);
  const twice = projectUserSelection(once);
  assert.deepEqual(JSON.parse(JSON.stringify(twice)), JSON.parse(JSON.stringify(once)));
});

test('projection does not mutate its input', () => {
  const r = base();
  r.location.userSelectedStructureIds = [PATELLA];
  r.consideredStructures[0]!.selectedByUser = false;
  projectUserSelection(r);
  assert.equal(r.consideredStructures[0]?.selectedByUser, false, 'the input record was rewritten');
});

/* ================================================================== */
/* Select / deselect                                                  */
/* ================================================================== */

test('select writes only the canonical set and derives the flag', () => {
  const r = base();
  const selected = projectUserSelection({
    ...r,
    location: { ...r.location, userSelectedStructureIds: [PATELLA] },
  });
  assert.deepEqual(selected.location.userSelectedStructureIds, [PATELLA]);
  assert.equal(byId(selected, PATELLA)?.selectedByUser, true);
  assert.equal(byId(selected, MENISCUS)?.selectedByUser, false);
  assert.equal(selected.consideredStructures.length, 2, 'no candidate was created or removed');
});

test('deselect clears the canonical set and the flag follows', () => {
  const r = base();
  const selected = projectUserSelection({
    ...r,
    location: { ...r.location, userSelectedStructureIds: [PATELLA] },
  });
  const cleared = projectUserSelection({
    ...selected,
    location: { ...selected.location, userSelectedStructureIds: [] },
  });
  assert.equal(byId(cleared, PATELLA)?.selectedByUser, false);
  // The candidate itself is untouched: rationale and confidence survive.
  assert.equal(byId(cleared, PATELLA)?.rationale, 'You described something like "the kneecap".');
  assert.equal(byId(cleared, PATELLA)?.confidence, 0.5);
});

test('select then deselect is lossless for the candidate', () => {
  const r = base();
  const before = JSON.stringify(r.consideredStructures);
  const on = projectUserSelection({ ...r, location: { ...r.location, userSelectedStructureIds: [PATELLA] } });
  const off = projectUserSelection({ ...on, location: { ...on.location, userSelectedStructureIds: [] } });
  assert.equal(JSON.stringify(off.consideredStructures), before);
});

/* ================================================================== */
/* Summary                                                             */
/* ================================================================== */

function episodeWith(record: SymptomRecord): Episode {
  return {
    id: 'ep_sel',
    personId: 'p1',
    region: 'knee',
    side: 'left',
    status: 'open',
    title: 'Knee',
    record,
    provenance: {},
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    safetyFlags: [],
  };
}

test('the two summary lists can never overlap, even from a contradictory record', () => {
  const r = base();
  r.location.userSelectedStructureIds = [PATELLA];
  // Contradiction: the candidate denies a selection the canonical set claims.
  r.consideredStructures[0]!.selectedByUser = false;

  const s = buildPreVisitSummary(episodeWith(r), { coverage: {} });
  assert.deepEqual(s.visualSelections, ['Patella']);
  assert.equal(s.unselectedSuggestions.includes('Patella'), false, 'listed as both selected and unselected');
  assert.deepEqual(s.unselectedSuggestions, ['Medial meniscus']);
});

test('a summary built from a stale flag still reports the canonical selection', () => {
  const r = base();
  // Nothing in the canonical set, but the candidate claims it was selected.
  r.consideredStructures[0]!.selectedByUser = true;
  const s = buildPreVisitSummary(episodeWith(r), { coverage: {} });
  assert.deepEqual(s.visualSelections, []);
  assert.ok(s.unselectedSuggestions.includes('Patella'));
  assert.equal(s.unselectedSuggestions.includes('Patella'), true);
});

test('every candidate appears in exactly one of the two summary lists', () => {
  for (const ids of [[], [PATELLA], [MENISCUS], [PATELLA, MENISCUS]]) {
    const r = base();
    r.location.userSelectedStructureIds = ids;
    // Seed a contradictory flag to prove the summary does not rely on it.
    r.consideredStructures[0]!.selectedByUser = ids.length === 0;
    const s = buildPreVisitSummary(episodeWith(r), { coverage: {} });
    const both = s.visualSelections.filter((v) => s.unselectedSuggestions.includes(v));
    assert.deepEqual(both, [], `overlap for ${JSON.stringify(ids)}`);
    const all = new Set([...s.visualSelections, ...s.unselectedSuggestions]);
    assert.equal(all.size, 2, 'both candidates must be accounted for exactly once');
  }
});
