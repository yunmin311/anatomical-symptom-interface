/**
 * Server-side tests for the atomic mutation path and the provenance bypass.
 *
 * These run against a TEMPORARY database so they never touch the dev data, and
 * they exercise the store directly, which is where the guarantees live.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'asi-test-'));
process.env.ASI_DB_PATH = join(dir, 'test.sqlite');
process.env.ASI_RELEASE_PROFILE = 'development';

const store = await import('../src/db/store.ts');
const { emptyRecord, FieldPolicyError, signalsFromAnswers, userSelectionIsConsistent, writablePaths, buildAnswer, putAnswer } = await import('@asi/shared');
type Provenance = import('@asi/shared').Provenance;

const CAPTURED = '2026-01-01T00:00:00.000Z';

const prov = (over: Partial<Provenance> = {}): Provenance => ({
  sourceType: 'user_statement',
  verificationStatus: 'user_confirmed',
  createdBy: 'user',
  capturedAt: CAPTURED,
  ...over,
});

const aiProv = (over: Partial<Provenance> = {}): Provenance => ({
  sourceType: 'ai_inference',
  verificationStatus: 'unverified',
  createdBy: 'attacker',
  confidence: 0.9,
  capturedAt: CAPTURED,
  ...over,
});

const mut = (fieldPath: string, value: unknown, provenance: Provenance) => ({
  fieldPath,
  value,
  provenance,
});

function newEpisode(region: 'knee' | 'shoulder' | 'lower_back' | 'neck' = 'knee') {
  return store.createEpisode({
    personId: 'p1',
    displayName: 'Tester',
    region,
    side: 'left',
    grounding: { status: 'grounded', reason: null, by: 'deterministic', score: 0.8, clarification: null },
  });
}

after(() => rmSync(dir, { recursive: true, force: true }));

/* ================================================================== */
/* The write path is atomic and validated                              */
/* ================================================================== */

test('a field mutation writes the value and its provenance together', () => {
  const ep = newEpisode();
  const outcome = store.applyMutations(ep.id, {
    fieldMutations: [mut('location.side', 'left', prov())],
  });
  assert.equal(outcome.rejected.length, 0);
  assert.equal(outcome.applied.filter((a) => a.action === 'written').length, 1);

  const reloaded = store.getEpisode(ep.id)!;
  assert.equal(reloaded.record.location.side, 'left');
  // The value and its provenance are the same row, so they cannot diverge.
  const sideProv = reloaded.provenance['location.side'];
  assert.ok(sideProv, 'a written value must have provenance');
  assert.equal(sideProv.sourceType, 'user_statement');
  assert.equal(sideProv.verificationStatus, 'user_confirmed');
});

test('an unwritten field has NO provenance row at all', () => {
  const ep = newEpisode();
  store.applyMutations(ep.id, { fieldMutations: [mut('location.side', 'left', prov())] });
  const reloaded = store.getEpisode(ep.id)!;
  assert.equal(reloaded.provenance['location.depth'], undefined, 'a value with no provenance is impossible');
  assert.equal(reloaded.provenance['quality'], undefined);
});

test('gaps are derived from real coverage, never from answer markers', () => {
  const ep = newEpisode();
  store.applyMutations(ep.id, {
    fieldMutations: [mut('location.side', 'left', prov())],
    answerMutations: [{ questionId: 'knee.locking', raw: 'yes', wroteFields: [], createdBy: 'user', capturedAt: CAPTURED }],
  });
  const reloaded = store.getEpisode(ep.id)!;
  const writable = new Set(writablePaths());
  assert.ok(reloaded.record.gaps.length > 0);
  for (const gap of reloaded.record.gaps) {
    // The exact invariant: a gap is a registry field path, and nothing else.
    assert.ok(writable.has(gap), `gaps held "${gap}", which is not a writable field path`);
    assert.doesNotMatch(gap, /asked:/, 'gaps must never hold an answer marker');
  }
  assert.ok(reloaded.record.gaps.includes('location.depth'), 'a genuinely missing field must be listed');
  assert.equal(reloaded.record.gaps.includes('knee.locking'), false, 'a question id is not a gap');
});

/* ================================================================== */
/* ISSUE 2: attempts to bypass provenance                              */
/* ================================================================== */

test('ISSUE 2: a model cannot write a user-grounded field', () => {
  const ep = newEpisode();
  assert.throws(
    () =>
      store.applyMutations(ep.id, {
        fieldMutations: [
          mut('location.userSelectedStructureIds', ['asi:knee.patella'], aiProv()),
        ],
      }),
    FieldPolicyError,
  );
});

test('ISSUE 2: a model cannot stamp a user_confirmed symptom', () => {
  const ep = newEpisode();
  assert.throws(
    () => store.applyMutations(ep.id, { fieldMutations: [mut('quality', ['dull'], aiProv())] }),
    FieldPolicyError,
  );
  assert.equal(store.getEpisode(ep.id)!.record.quality.length, 0, 'nothing was written');
});

test('ISSUE 2: a rejected batch rolls back every field in it', () => {
  const ep = newEpisode();
  assert.throws(
    () =>
      store.applyMutations(ep.id, {
        fieldMutations: [
          mut('location.side', 'left', prov()),
          mut('quality', ['dull'], aiProv()), // forbidden
        ],
      }),
    FieldPolicyError,
  );
  const reloaded = store.getEpisode(ep.id)!;
  assert.equal(reloaded.provenance['location.side'], undefined, 'the legal write must roll back too');
  assert.equal(reloaded.record.location.side, 'unknown');
});

test('ISSUE 2: an unknown field path is rejected and rolls the batch back', () => {
  const ep = newEpisode();
  assert.throws(
    () =>
      store.applyMutations(ep.id, {
        fieldMutations: [
          mut('location.side', 'left', prov()),
          mut('location.notAField', 'x', prov()),
        ],
      }),
    FieldPolicyError,
  );
  assert.equal(store.getEpisode(ep.id)!.provenance['location.side'], undefined);
});

test('ISSUE 2: a client cannot write gaps', () => {
  const ep = newEpisode();
  assert.throws(
    () =>
      store.applyMutations(ep.id, {
        fieldMutations: [
          mut('gaps', ['temporal.trend'], prov({ sourceType: 'system_rule', verificationStatus: 'unverified' })),
        ],
      }),
    FieldPolicyError,
  );
});

test('ISSUE 2: a device import cannot write a subjective symptom at all', () => {
  const ep = newEpisode();
  // The field policy blocks this before the merge layer is even reached, which
  // is a stronger guarantee than "it loses the merge".
  assert.throws(
    () =>
      store.applyMutations(ep.id, {
        fieldMutations: [
          mut('quality', ['burning'], prov({ sourceType: 'device_import', verificationStatus: 'unverified', createdBy: 'fitbit' })),
        ],
      }),
    /may not write this field/,
  );
  assert.equal(store.getEpisode(ep.id)!.record.quality.length, 0);
});

test('ISSUE 6: an out-of-class source is preserved in parallel, not merged in', () => {
  const ep = newEpisode();
  // context.medications accepts a lab/record source, but its claim class is
  // symptom_subjective, where external_record has no standing. So the record's
  // value must be kept alongside the user's, not replace it.
  store.applyMutations(ep.id, {
    fieldMutations: [mut('context.medications', ['ibuprofen'], prov())],
  });
  const outcome = store.applyMutations(ep.id, {
    fieldMutations: [
      mut('context.medications', ['naproxen'], prov({ sourceType: 'external_record', verificationStatus: 'clinician_confirmed', createdBy: 'lab' })),
    ],
  });
  assert.equal(outcome.applied[0]?.action, 'kept_incumbent');
  assert.deepEqual(store.getEpisode(ep.id)!.record.context.medications, ['ibuprofen']);

  const preserved = store.preservedAssertions(ep.id);
  assert.equal(preserved.length, 1);
  assert.equal(preserved[0]?.fieldPath, 'context.medications');
  assert.deepEqual(preserved[0]?.value, ['naproxen']);
  assert.equal(preserved[0]?.sourceType, 'external_record');
});

test('ISSUE 6: a lower-authority write cannot overwrite a user edit', () => {
  const ep = newEpisode();
  store.applyMutations(ep.id, {
    fieldMutations: [mut('temporal.trend', 'worsening', prov({ sourceType: 'user_edited' }))],
  });
  const outcome = store.applyMutations(ep.id, {
    fieldMutations: [mut('temporal.trend', 'improving', prov({ sourceType: 'user_statement' }))],
  });
  assert.equal(outcome.applied[0]?.action, 'kept_incumbent');
  assert.equal(store.getEpisode(ep.id)!.record.temporal.trend, 'worsening');
});

/* ================================================================== */
/* ISSUE 1: answers drive safety, persisted end to end                 */
/* ================================================================== */

test('ISSUE 1: a persisted "no" does not fire cauda equina, a "yes" does', () => {
  const no = newEpisode('lower_back');
  store.applyMutations(no.id, {
    answerMutations: [{ questionId: 'lower_back.bladder', raw: 'no', triStateHint: 'no', wroteFields: [], createdBy: 'user', capturedAt: CAPTURED }],
  } as never);
  const noFlags = store.safetyFor(no.id, 'development')!;
  assert.equal(noFlags.flags.some((f) => f.ruleId === 'msk.cauda_equina'), false);

  const yes = newEpisode('lower_back');
  store.applyMutations(yes.id, {
    answerMutations: [{ questionId: 'lower_back.bladder', raw: 'yes', wroteFields: [], createdBy: 'user', capturedAt: CAPTURED }],
  });
  const yesFlags = store.safetyFor(yes.id, 'development')!;
  assert.ok(yesFlags.flags.some((f) => f.ruleId === 'msk.cauda_equina'));
});

test('ISSUE 1: answers round-trip through the database with their tri-state', () => {
  const ep = newEpisode('lower_back');
  store.applyMutations(ep.id, {
    answerMutations: [
      { questionId: 'lower_back.bladder', raw: 'false', wroteFields: [], createdBy: 'user', capturedAt: CAPTURED },
      { questionId: 'lower_back.numbness', raw: "don't know", wroteFields: [], createdBy: 'user', capturedAt: CAPTURED },
    ],
  });
  const answers = store.answersFor(ep.id);
  assert.equal(answers['lower_back.bladder']?.triState, 'no');
  assert.equal(answers['lower_back.numbness']?.triState, 'unknown');
  assert.equal(answers['lower_back.weakness'], undefined);

  const signals = signalsFromAnswers(answers);
  assert.equal(signals.bladder_or_bowel_change, 'no');
  assert.equal(signals.saddle_numbness, 'unknown');
  assert.equal(signals.leg_weakness, 'not_asked');
});

/* ================================================================== */
/* ISSUE 4: an unsupported episode cannot be created                  */
/* ================================================================== */

test('ISSUE 4: an unsupported episode still records the refusal, but has no record', () => {
  const ep = store.createEpisode({
    personId: 'p1',
    region: 'knee',
    grounding: { status: 'unsupported', reason: 'out_of_scope', by: 'deterministic', score: 0, clarification: null },
  });
  const grounding = store.getGrounding(ep.id)!;
  assert.equal(grounding.status, 'unsupported');
  assert.equal(grounding.reason, 'out_of_scope');
  // No record was fabricated from a region the user never identified.
  assert.deepEqual(ep.record.location.userSelectedStructureIds, []);
});

/* ================================================================== */
/* ISSUE 8: the release profile withholds and blocks                  */
/* ================================================================== */

test('ISSUE 8: the release profile withholds an unreviewed fired rule and blocks', () => {
  const ep = newEpisode('lower_back');
  store.applyMutations(ep.id, {
    answerMutations: [{ questionId: 'lower_back.bladder', raw: 'yes', wroteFields: [], createdBy: 'user', capturedAt: CAPTURED }],
  });
  const dev = store.safetyFor(ep.id, 'development')!;
  assert.ok(dev.flags.some((f) => f.ruleId === 'msk.cauda_equina'));
  assert.equal(dev.blocked, false);

  const rel = store.safetyFor(ep.id, 'release')!;
  assert.equal(rel.flags.length, 0, 'unreviewed rules must not be user-facing in release');
  assert.equal(rel.withheld.length, 1);
  assert.equal(rel.blocked, true);
});

/* ================================================================== */
/* Issue 5: coverage drives the summary                               */
/* ================================================================== */

test('ISSUE 5: coverage marks only written fields as recorded', () => {
  const ep = newEpisode('knee');
  store.applyMutations(ep.id, {
    fieldMutations: [mut('location.side', 'left', prov()), mut('function.sleepAffected', 'yes', prov())],
  });
  const coverage = store.coverageFor(ep.id);
  assert.equal(coverage['location.side'], true);
  assert.equal(coverage['function.sleepAffected'], true);
  assert.equal(coverage['function.takesPainkiller'], false);
  assert.equal(coverage['context.systemicSymptoms'], false);
  assert.equal(coverage['quality'], false);
});

test('ISSUE 5: an unanswered negative is never rendered as a negative', () => {
  const ep = newEpisode('knee');
  const out = store.summaryFor(ep.id, 'development')!;
  const text = out.text;
  assert.match(text, /Sleep affected: not asked/);
  assert.match(text, /Systemic symptoms: not asked/);
  assert.doesNotMatch(text, /Systemic symptoms: none reported/);
  assert.doesNotMatch(text, /Sleep affected: No/);
});

/* ================================================================== */
/* Canonical user selection survives a rebuild                         */
/* ================================================================== */

const PATELLA = 'asi:knee.patella';
const MENISCUS = 'asi:knee.meniscus-medial';

const selectionProv = (over: Partial<Provenance> = {}): Provenance => ({
  sourceType: 'user_selection',
  verificationStatus: 'user_confirmed',
  createdBy: 'user',
  capturedAt: CAPTURED,
  ...over,
});

const candidates = (patellaSelected: boolean) => [
  { structureId: PATELLA, rationale: 'You described something near the kneecap.', confidence: 0.5, selectedByUser: patellaSelected },
  { structureId: MENISCUS, rationale: 'Nearby structure.', confidence: 0.4, selectedByUser: false },
];

test('rebuild recomputes the candidate flag from the canonical id set', () => {
  const ep = newEpisode('knee');
  store.applyMutations(ep.id, {
    fieldMutations: [
      mut('location.userSelectedStructureIds', [PATELLA], selectionProv()),
      // The client ALSO claims a selection on a candidate that is not in the
      // canonical set. The canonical set must win.
      mut('consideredStructures', candidates(true), prov({ sourceType: 'ai_inference', verificationStatus: 'unverified', createdBy: 'model', confidence: 0.5 })),
    ],
  });

  const rec = store.getEpisode(ep.id)!.record;
  assert.deepEqual(rec.location.userSelectedStructureIds, [PATELLA]);
  assert.equal(
    rec.consideredStructures.find((c) => c.structureId === PATELLA)?.selectedByUser,
    true,
    'the candidate IS in the canonical set, so it projects as selected',
  );
  assert.equal(
    rec.consideredStructures.find((c) => c.structureId === MENISCUS)?.selectedByUser,
    false,
  );
});

test('rebuild dedupes the canonical id set, preserving the order the user pointed in', () => {
  const ep = newEpisode('knee');
  // Hostile input: a client that appends on every click sends this shape. The
  // array is rendered to a clinician as "areas you pointed to", so a repeat is a
  // reporting bug, not a cosmetic one.
  store.applyMutations(ep.id, {
    fieldMutations: [
      mut('location.userSelectedStructureIds', [MENISCUS, PATELLA, MENISCUS, PATELLA], selectionProv()),
      mut('consideredStructures', candidates(false), prov({ sourceType: 'ai_inference', verificationStatus: 'unverified', createdBy: 'model', confidence: 0.5 })),
    ],
  });

  const rec = store.getEpisode(ep.id)!.record;
  assert.deepEqual(
    rec.location.userSelectedStructureIds,
    [MENISCUS, PATELLA],
    'first occurrence wins, and the order is not sorted or reversed',
  );
  // The dedup must not disturb the flag projection.
  assert.equal(rec.consideredStructures.find((c) => c.structureId === PATELLA)?.selectedByUser, true);
  assert.equal(rec.consideredStructures.find((c) => c.structureId === MENISCUS)?.selectedByUser, true);
});

test('the raw field store keeps the value it was given', () => {
  const ep = newEpisode('knee');
  const raw = [PATELLA, PATELLA];
  store.applyMutations(ep.id, { fieldMutations: [mut('location.userSelectedStructureIds', raw, selectionProv())] });

  // Canonicalization belongs to the projection, not the writer: the field store
  // stays a faithful log of what arrived, and everything that reads the record
  // goes through the projection.
  assert.deepEqual(store.fieldStoreFor(ep.id)['location.userSelectedStructureIds']?.value, raw);
  assert.deepEqual(store.getEpisode(ep.id)!.record.location.userSelectedStructureIds, [PATELLA]);
});

test('a stale unselected flag on a selected candidate is corrected on read', () => {
  const ep = newEpisode('knee');
  store.applyMutations(ep.id, {
    fieldMutations: [
      mut('location.userSelectedStructureIds', [PATELLA], selectionProv()),
      // Contradiction the other way: canonical set says selected, candidate says no.
      mut('consideredStructures', candidates(false), prov({ sourceType: 'ai_inference', verificationStatus: 'unverified', createdBy: 'model', confidence: 0.5 })),
    ],
  });
  const rec = store.getEpisode(ep.id)!.record;
  assert.equal(rec.consideredStructures.find((c) => c.structureId === PATELLA)?.selectedByUser, true);
  assert.equal(userSelectionIsConsistent(rec), true, 'a persisted contradiction must never be readable');
});

test('candidate rationale and confidence survive the projection', () => {
  const ep = newEpisode('knee');
  store.applyMutations(ep.id, {
    fieldMutations: [
      mut('location.userSelectedStructureIds', [PATELLA], selectionProv()),
      mut('consideredStructures', candidates(false), prov({ sourceType: 'ai_inference', verificationStatus: 'unverified', createdBy: 'model', confidence: 0.5 })),
    ],
  });
  const rec = store.getEpisode(ep.id)!.record;
  const p = rec.consideredStructures.find((c) => c.structureId === PATELLA)!;
  assert.equal(p.rationale, 'You described something near the kneecap.');
  assert.equal(p.confidence, 0.5);
  assert.equal(rec.consideredStructures.length, 2, 'no candidate may be added or dropped');
});

test('the two summary lists never overlap, whatever was persisted', () => {
  const ep = newEpisode('knee');
  store.applyMutations(ep.id, {
    fieldMutations: [
      mut('location.userSelectedStructureIds', [PATELLA], selectionProv()),
      mut('consideredStructures', candidates(false), prov({ sourceType: 'ai_inference', verificationStatus: 'unverified', createdBy: 'model', confidence: 0.5 })),
    ],
  });
  const { summary } = store.summaryFor(ep.id, 'development')!;
  assert.deepEqual(summary.visualSelections, ['Patella']);
  assert.deepEqual(summary.unselectedSuggestions, ['Medial meniscus']);
  const overlap = summary.visualSelections.filter((v) => summary.unselectedSuggestions.includes(v));
  assert.deepEqual(overlap, []);
});

test('clearing the selection keeps the candidate as a suggestion', () => {
  const ep = newEpisode('knee');
  const ai = prov({ sourceType: 'ai_inference', verificationStatus: 'unverified', createdBy: 'model', confidence: 0.5 });
  store.applyMutations(ep.id, {
    fieldMutations: [
      mut('location.userSelectedStructureIds', [PATELLA], selectionProv()),
      mut('consideredStructures', candidates(false), ai),
    ],
  });
  store.applyMutations(ep.id, {
    fieldMutations: [
      mut('location.userSelectedStructureIds', [], prov({ sourceType: 'user_edited' })),
      mut('consideredStructures', candidates(false), ai),
    ],
  });

  const rec = store.getEpisode(ep.id)!.record;
  assert.deepEqual(rec.location.userSelectedStructureIds, []);
  assert.equal(rec.consideredStructures.length, 2, 'the candidate must not be deleted');
  assert.equal(rec.consideredStructures.find((c) => c.structureId === PATELLA)?.selectedByUser, false);

  const { summary } = store.summaryFor(ep.id, 'development')!;
  assert.deepEqual(summary.visualSelections, []);
  assert.deepEqual(summary.unselectedSuggestions, ['Patella', 'Medial meniscus']);
});

test('a selected id the model never suggested is still a visual selection', () => {
  const ep = newEpisode('knee');
  store.applyMutations(ep.id, {
    fieldMutations: [
      mut('location.userSelectedStructureIds', ['asi:knee.lcl'], selectionProv()),
      mut('consideredStructures', candidates(false), prov({ sourceType: 'ai_inference', verificationStatus: 'unverified', createdBy: 'model', confidence: 0.5 })),
    ],
  });
  const rec = store.getEpisode(ep.id)!.record;
  assert.deepEqual(rec.location.userSelectedStructureIds, ['asi:knee.lcl']);
  assert.equal(rec.consideredStructures.some((c) => c.structureId === 'asi:knee.lcl'), false, 'no candidate is invented');
  const { summary } = store.summaryFor(ep.id, 'development')!;
  assert.deepEqual(summary.visualSelections, ['Lateral collateral ligament']);
});

test('the plain-text summary is deterministic apart from its timestamp', () => {
  const ep = newEpisode('knee');
  store.applyMutations(ep.id, { fieldMutations: [mut('location.side', 'left', prov())] });
  const a = store.summaryFor(ep.id, 'development')!.text;
  const b = store.summaryFor(ep.id, 'development')!.text;
  const strip = (s: string) => s.replace(/Generated .*/, '').replace(/^\s*$/gm, '');
  assert.equal(strip(a), strip(b));
});

void emptyRecord;
void buildAnswer;
void putAnswer;
void randomUUID;
