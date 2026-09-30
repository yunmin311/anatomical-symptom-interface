import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyRecord, signalsFromAnswers, triStateOf } from '@asi/shared';
import type { AnswerMap, SymptomRecord } from '@asi/shared';
import {
  applyLocalisation,
  deselectStructure,
  evaluateSession,
  labelFor,
  mutationsForAnswer,
  mutationsForField,
  peekNextQuestion,
  progressOf,
  recordAnswer,
  selectStructure,
} from '../src/state/logic.ts';
import type { LocalisationOutcome } from '../src/state/logic.ts';

const grounded = (over: Partial<Extract<LocalisationOutcome, { status: 'grounded' }>> = {}): LocalisationOutcome => ({
  status: 'grounded',
  region: 'lower_back',
  side: 'left',
  depth: 'deep',
  suggestedSubRegionId: 'lower_back.central',
  consideredStructures: [],
  userPhrase: 'my lower back hurts',
  clarificationQuestion: null,
  ...over,
});

/* ================================================================== */
/* Localisation must never invent a region                            */
/* ================================================================== */

test('an unsupported localisation leaves the record untouched and blocks progress', () => {
  const previous = emptyRecord('knee');
  const out = applyLocalisation(previous, {
    status: 'unsupported',
    reason: 'out_of_scope',
    message: 'This workflow only covers four regions.',
    supportedRegions: ['shoulder', 'neck', 'lower_back', 'knee'],
  });
  assert.equal(out.allowed, false);
  assert.equal(out.refusal, 'This workflow only covers four regions.');
  assert.equal(out.record, previous, 'the previous record must not be replaced');
  assert.equal(out.considered.length, 0);
});

test('a grounded localisation builds a record for the reported region only', () => {
  const out = applyLocalisation(emptyRecord('knee'), grounded());
  assert.equal(out.allowed, true);
  assert.equal(out.record.location.region, 'lower_back');
  assert.equal(out.record.location.side, 'left');
  assert.equal(out.record.location.depth, 'deep');
  assert.equal(out.record.location.userSelectedStructureIds.length, 0);
});

/* ================================================================== */
/* Answers: yes, no, unknown, not_asked all differ                    */
/* ================================================================== */

const run = (region: 'lower_back' | 'shoulder' | 'knee' | 'neck', steps: [string, unknown, 'yes' | 'no' | 'unknown'][]) => {
  let record = emptyRecord(region);
  let answers: AnswerMap = {};
  for (const [q, raw, tri] of steps) {
    const r = recordAnswer(record, answers, q, raw, tri);
    record = r.record;
    answers = r.answers;
  }
  return { record, answers };
};

test('ISSUE 1: a "no" on the bladder question records no and fires nothing', () => {
  const { answers } = run('lower_back', [['lower_back.bladder', 'no', 'no']]);
  assert.equal(triStateOf(answers, 'lower_back.bladder'), 'no');
  const s = evaluateSession(emptyRecord('lower_back'), answers);
  assert.equal(s.flags.some((f) => f.ruleId === 'msk.cauda_equina'), false);
});

test('ISSUE 1: a "yes" on the bladder question records yes and fires the rule', () => {
  const { answers } = run('lower_back', [['lower_back.bladder', 'yes', 'yes']]);
  assert.equal(triStateOf(answers, 'lower_back.bladder'), 'yes');
  const s = evaluateSession(emptyRecord('lower_back'), answers);
  assert.ok(s.flags.some((f) => f.ruleId === 'msk.cauda_equina'));
});

test('ISSUE 1: "I am not sure" is stored as unknown, not as no', () => {
  const { answers } = run('lower_back', [['lower_back.bladder', "don't know", 'unknown']]);
  assert.equal(triStateOf(answers, 'lower_back.bladder'), 'unknown');
  assert.notEqual(triStateOf(answers, 'lower_back.bladder'), 'no');
  const s = evaluateSession(emptyRecord('lower_back'), answers);
  assert.equal(s.flags.some((f) => f.ruleId === 'msk.cauda_equina'), false);
});

test('ISSUE 1: the shoulder cold/pale hand question maps to its own signal only', () => {
  const yes = signalsFromAnswers(run('shoulder', [['shoulder.vascular', 'yes', 'yes']]).answers);
  assert.equal(yes.cold_pale_or_numb_hand, 'yes');
  assert.equal(yes.fever_or_systemic_unwell, 'not_asked', 'must not leak into the systemic signal');

  const no = signalsFromAnswers(run('shoulder', [['shoulder.vascular', 'no', 'no']]).answers);
  assert.equal(no.cold_pale_or_numb_hand, 'no');
});

test('ISSUE 1: the knee hot joint question maps to its own signal only', () => {
  const yes = signalsFromAnswers(run('knee', [['knee.instability', 'yes', 'yes']]).answers);
  assert.equal(yes.hot_red_swollen_joint, 'yes');
  const no = signalsFromAnswers(run('knee', [['knee.instability', 'no', 'no']]).answers);
  assert.equal(no.hot_red_swollen_joint, 'no');
});

test('a safety-only question writes no record fields at all', () => {
  const { record, answers } = run('lower_back', [['lower_back.bladder', 'yes', 'yes']]);
  const before = JSON.stringify(emptyRecord('lower_back'));
  assert.equal(JSON.stringify(record), before, 'a safety-only answer must not touch the record');
  assert.equal(triStateOf(answers, 'lower_back.bladder'), 'yes');
});

test('a non-safety question does write the fields it declares', () => {
  const r = recordAnswer(emptyRecord('knee'), {}, 'knee.swelling', 'rapid', 'yes');
  assert.ok(r.wroteFields.includes('quality'));
  assert.equal(r.record.quality.includes('swelling'), true);
});

test('a "none" answer clears a previously recorded swelling', () => {
  const first = recordAnswer(emptyRecord('knee'), {}, 'knee.swelling', 'rapid', 'yes');
  const second = recordAnswer(first.record, first.answers, 'knee.swelling', 'none', 'yes');
  assert.equal(second.record.quality.includes('swelling'), false);
});

test('re-answering a question replaces the previous answer rather than adding', () => {
  const first = recordAnswer(emptyRecord('knee'), {}, 'knee.locking', 'yes', 'yes');
  const second = recordAnswer(first.record, first.answers, 'knee.locking', 'no', 'no');
  assert.equal(Object.keys(second.answers).length, 1);
  assert.equal(triStateOf(second.answers, 'knee.locking'), 'no');
});

test('the question queue advances and reports outstanding items', () => {
  const start = run('lower_back', []);
  const first = peekNextQuestion(start.record, start.answers)!;
  const after = run('lower_back', [[first.id, 'after lifting', 'yes']]);
  const second = peekNextQuestion(after.record, after.answers)!;
  assert.notEqual(first.id, second.id);
  const progress = progressOf(after.record, after.answers);
  assert.equal(progress.answered, 1);
  assert.ok(progress.outstanding.length > 0);
});

test('an "I am not sure" answer is not re-asked but stays outstanding', () => {
  const start = run('knee', []);
  const first = peekNextQuestion(start.record, start.answers)!;
  const after = run('knee', [[first.id, "don't know", 'unknown']]);
  const next = peekNextQuestion(after.record, after.answers)!;
  assert.notEqual(next.id, first.id);
  assert.ok(progressOf(after.record, after.answers).outstanding.includes(first.id));
});

/* ================================================================== */
/* Visual selection is not a finding                                  */
/* ================================================================== */

test('ISSUE 3: selecting a structure records a selection, not a confirmation', () => {
  const record = emptyRecord('shoulder');
  record.consideredStructures = [
    { structureId: 'asi:shoulder.biceps-long-head-tendon', confidence: 0.5, selectedByUser: false },
  ];
  selectStructure(record, 'asi:shoulder.biceps-long-head-tendon');
  assert.deepEqual(record.location.userSelectedStructureIds, ['asi:shoulder.biceps-long-head-tendon']);
  assert.equal(record.consideredStructures[0]?.selectedByUser, true);
  // No field anywhere claims a structure was confirmed as a problem.
  assert.equal(JSON.stringify(record).includes('confirmed'), false);
});

test('selecting twice does not duplicate the selection', () => {
  const record = emptyRecord('knee');
  selectStructure(record, 'asi:knee.patella');
  selectStructure(record, 'asi:knee.patella');
  assert.deepEqual(record.location.userSelectedStructureIds, ['asi:knee.patella']);
});

test('deselecting removes it from both lists', () => {
  const record = emptyRecord('knee');
  record.consideredStructures = [{ structureId: 'asi:knee.patella', confidence: 0.5, selectedByUser: false }];
  selectStructure(record, 'asi:knee.patella');
  deselectStructure(record, 'asi:knee.patella');
  assert.deepEqual(record.location.userSelectedStructureIds, []);
  assert.deepEqual(record.consideredStructures, []);
});

test('labels prefer the lay term over the anatomical name', () => {
  assert.equal(labelFor('asi:shoulder.biceps-long-head-tendon'), 'the tendon that runs down the front of the shoulder joint');
  assert.equal(labelFor('asi:nonexistent'), 'asi:nonexistent');
});

/* ================================================================== */
/* Mutation payloads                                                   */
/* ================================================================== */

test('a safety-only answer produces an empty mutation list', () => {
  const r = recordAnswer(emptyRecord('lower_back'), {}, 'lower_back.bladder', 'yes', 'yes');
  assert.deepEqual(mutationsForAnswer(r.record, r.answer, r.wroteFields), []);
});

test('mutations only carry the fields that were actually written', () => {
  const r = recordAnswer(emptyRecord('knee'), {}, 'knee.swelling', 'rapid', 'yes');
  const muts = mutationsForAnswer(r.record, r.answer, r.wroteFields);
  assert.equal(muts.length, r.wroteFields.length);
  assert.ok(muts.every((m) => m.fieldPath === 'quality'));
  assert.equal(muts[0]?.value.includes('swelling'), true);
});

test('a map-originated field is sent as a user selection, not a statement', () => {
  const m = mutationsForField('location.point', { x: 0.4, y: 0.5 });
  assert.equal(m[0]?.provenance.sourceType, 'user_selection');
  const s = mutationsForField('location.side', 'left');
  assert.equal(s[0]?.provenance.sourceType, 'user_statement');
});

test('no mutation the client builds claims to come from a model or a device', () => {
  const r = recordAnswer(emptyRecord('knee'), {}, 'knee.swelling', 'rapid', 'yes');
  const all = [...mutationsForAnswer(r.record, r.answer, r.wroteFields), ...mutationsForField('location.subRegionId', 'knee.anterior')];
  for (const m of all) {
    assert.ok(['user_statement', 'user_selection'].includes(m.provenance.sourceType), `${m.fieldPath} came from ${m.provenance.sourceType}`);
  }
});

/* ================================================================== */
/* The record never gets an answer marker in gaps                      */
/* ================================================================== */

test('ISSUE 1: no answer writes a marker into record.gaps', () => {
  let record: SymptomRecord = emptyRecord('knee');
  let answers: AnswerMap = {};
  for (const [q, raw, tri] of [
    ['knee.swelling', 'rapid', 'yes'],
    ['knee.locking', 'yes', 'yes'],
    ['knee.weight_bearing', 'partial', 'yes'],
  ] as [string, unknown, 'yes'][]) {
    const r = recordAnswer(record, answers, q, raw, tri);
    record = r.record;
    answers = r.answers;
  }
  for (const gap of record.gaps) {
    assert.doesNotMatch(gap, /asked:/);
  }
});
