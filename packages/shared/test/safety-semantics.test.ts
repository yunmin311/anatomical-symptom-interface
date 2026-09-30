import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AnswerMap, QuestionAnswer } from '../src/answers.ts';
import { buildAnswer, putAnswer, triStateOf, normaliseYesNo, isUncertain } from '../src/answers.ts';
import { applyAnswer, INTERVIEW } from '../src/interview/engine.ts';
import { QUESTION_SIGNALS, signalIsAskedInRegion, signalsFromAnswers, questionsForSignal } from '../src/safety-signals.ts';
import { ALL_RULES, evaluateSafety, RULES_WITHOUT_QUESTION_SIGNAL, UNREAD_SIGNALS } from '../src/rules/redflags.ts';
import { emptyRecord } from '../src/symptom.ts';
import type { SymptomRecord } from '../src/symptom.ts';
import type { BodyRegion } from '../src/anatomy.ts';

const CAPTURED = '2026-01-01T00:00:00.000Z';

const ans = (questionId: string, triState: 'yes' | 'no' | 'unknown', raw: unknown = triState): QuestionAnswer =>
  buildAnswer({
    questionId,
    raw,
    triState,
    provenance: { capturedAt: CAPTURED, createdBy: 'user' },
  });

const answersOf = (...pairs: [string, 'yes' | 'no' | 'unknown'][]): AnswerMap =>
  pairs.reduce<Record<string, QuestionAnswer>>((acc, [q, s]) => putAnswer(acc, ans(q, s)), {}) as AnswerMap;

const rec = (region: BodyRegion = 'lower_back'): SymptomRecord => emptyRecord(region);

/** Build a record the way the real flow does: apply answers, then evaluate. */
function session(region: BodyRegion, pairs: [string, 'yes' | 'no' | 'unknown'][]): {
  record: SymptomRecord;
  answers: AnswerMap;
} {
  const answers = answersOf(...pairs);
  const record = rec(region);
  for (const [q, s] of pairs) applyAnswer(record, q, ans(q, s, s));
  return { record, answers };
}

/* ================================================================== */
/* The four-state answer model                                         */
/* ================================================================== */

test('normaliseYesNo never defaults an unrecognised answer to no', () => {
  assert.equal(normaliseYesNo(true), 'yes');
  assert.equal(normaliseYesNo('yes'), 'yes');
  assert.equal(normaliseYesNo('false'), 'no');
  assert.equal(normaliseYesNo('no'), 'no');
  // The critical cases: these must NOT become 'no'.
  assert.equal(normaliseYesNo("don't know"), 'unknown');
  assert.equal(normaliseYesNo('unsure'), 'unknown');
  assert.equal(normaliseYesNo(''), 'unknown');
  assert.equal(normaliseYesNo('maybe'), 'unknown');
  assert.equal(normaliseYesNo(42), 'unknown');
  assert.equal(normaliseYesNo(null), 'unknown');
  assert.equal(normaliseYesNo(undefined), 'unknown');
});

test('a missing answer is not_asked, which differs from no and from unknown', () => {
  const answers = answersOf(['lower_back.bladder', 'no']);
  assert.equal(triStateOf(answers, 'lower_back.bladder'), 'no');
  assert.equal(triStateOf(answers, 'lower_back.numbness'), 'not_asked');
  const uncertain = answersOf(['lower_back.numbness', 'unknown']);
  assert.equal(triStateOf(uncertain, 'lower_back.numbness'), 'unknown');
  assert.equal(isUncertain(uncertain, 'lower_back.numbness'), true);
  assert.equal(isUncertain(answers, 'lower_back.numbness'), false);
});

/* ================================================================== */
/* ISSUE 1: required end-to-end safety semantics                       */
/* ================================================================== */

test('ISSUE 1: lower_back.bladder = false does NOT trigger cauda equina', () => {
  const { answers } = session('lower_back', [['lower_back.bladder', 'no']]);
  const result = evaluateSafety(rec('lower_back'), { answers, region: 'lower_back' });
  assert.equal(
    result.flags.some((f) => f.ruleId === 'msk.cauda_equina'),
    false,
    'an explicit "no" must not fire the cauda equina rule',
  );
});

test('ISSUE 1: lower_back.bladder = true DOES trigger cauda equina', () => {
  const { answers } = session('lower_back', [['lower_back.bladder', 'yes']]);
  const result = evaluateSafety(rec('lower_back'), { answers, region: 'lower_back' });
  const flag = result.flags.find((f) => f.ruleId === 'msk.cauda_equina');
  assert.ok(flag, 'an explicit "yes" must reach the cauda equina rule');
  assert.equal(flag.severity, 'emergency');
});

test('ISSUE 1: lower_back.bladder = unknown does NOT fire, and is not treated as no', () => {
  const { answers } = session('lower_back', [['lower_back.bladder', 'unknown']]);
  const signals = signalsFromAnswers(answers);
  assert.equal(signals.bladder_or_bowel_change, 'unknown');
  const result = evaluateSafety(rec('lower_back'), { answers, region: 'lower_back' });
  assert.equal(result.flags.some((f) => f.ruleId === 'msk.cauda_equina'), false);
});

test('ISSUE 1: saddle numbness + leg weakness fires without a bladder answer', () => {
  const { answers } = session('lower_back', [
    ['lower_back.numbness', 'yes'],
    ['lower_back.weakness', 'yes'],
  ]);
  const result = evaluateSafety(rec('lower_back'), { answers, region: 'lower_back' });
  assert.ok(result.flags.some((f) => f.ruleId === 'msk.cauda_equina'));
});

test('ISSUE 1: numbness alone does not fire cauda equina', () => {
  const { answers } = session('lower_back', [['lower_back.numbness', 'yes']]);
  const result = evaluateSafety(rec('lower_back'), { answers, region: 'lower_back' });
  assert.equal(result.flags.some((f) => f.ruleId === 'msk.cauda_equina'), false);
});

test('ISSUE 1: shoulder.vascular true/false maps to cold_pale_hand only', () => {
  const yes = signalsFromAnswers(answersOf(['shoulder.vascular', 'yes']));
  assert.equal(yes.cold_pale_or_numb_hand, 'yes');
  // The old bug: a yes here set systemicSymptoms:['fever'] and the rule then
  // saw a fever. It must not touch the systemic signal.
  assert.equal(yes.fever_or_systemic_unwell, 'not_asked');

  const no = signalsFromAnswers(answersOf(['shoulder.vascular', 'no']));
  assert.equal(no.cold_pale_or_numb_hand, 'no');
  assert.equal(no.fever_or_systemic_unwell, 'not_asked');

  const fired = evaluateSafety(rec('shoulder'), { answers: answersOf(['shoulder.vascular', 'yes']), region: 'shoulder' });
  assert.ok(fired.flags.some((f) => f.ruleId === 'msk.cold_pale_hand'));
  const notFired = evaluateSafety(rec('shoulder'), { answers: answersOf(['shoulder.vascular', 'no']), region: 'shoulder' });
  assert.equal(notFired.flags.some((f) => f.ruleId === 'msk.cold_pale_hand'), false);
});

test('ISSUE 1: shoulder.vascular writes nothing to the record', () => {
  const r = rec('shoulder');
  const before = JSON.stringify(r);
  applyAnswer(r, 'shoulder.vascular', ans('shoulder.vascular', 'yes'));
  assert.equal(JSON.stringify(r), before, 'a safety-only question must not mutate the record');
});

test('ISSUE 1: knee hot/red/fever true/false maps to hot_joint_fever', () => {
  const yes = signalsFromAnswers(answersOf(['knee.instability', 'yes']));
  assert.equal(yes.hot_red_swollen_joint, 'yes');
  const no = signalsFromAnswers(answersOf(['knee.instability', 'no']));
  assert.equal(no.hot_red_swollen_joint, 'no');
  assert.notEqual(yes.hot_red_swollen_joint, no.hot_red_swollen_joint);
});

test('ISSUE 1: knee.instability = no does not fire hot_joint_fever', () => {
  const result = evaluateSafety(rec('knee'), { answers: answersOf(['knee.instability', 'no']), region: 'knee' });
  assert.equal(result.flags.some((f) => f.ruleId === 'msk.hot_joint_fever'), false);
});

test('ISSUE 1: knee.instability = yes fires hot_joint_fever', () => {
  const result = evaluateSafety(rec('knee'), { answers: answersOf(['knee.instability', 'yes']), region: 'knee' });
  assert.ok(result.flags.some((f) => f.ruleId === 'msk.hot_joint_fever'));
});

test('ISSUE 1: knee hot_joint question writes only on yes', () => {
  const rNo = rec('knee');
  applyAnswer(rNo, 'knee.instability', ans('knee.instability', 'no'));
  assert.equal(rNo.quality.includes('swelling'), false, 'a "no" must not add swelling');
  assert.equal(rNo.context.systemicSymptoms.includes('fever'), false, 'a "no" must not add fever');

  const rYes = rec('knee');
  applyAnswer(rYes, 'knee.instability', ans('knee.instability', 'yes'));
  assert.equal(rYes.quality.includes('swelling'), true);
  assert.equal(rYes.context.systemicSymptoms.includes('fever'), true);
});

/* ================================================================== */
/* ISSUE 1: every safetyRuleId question has a tested path into its rule */
/* ================================================================== */

test('ISSUE 1: every question carrying safetyRuleId names a real rule', () => {
  const ruleIds = new Set(ALL_RULES.map((r) => r.id));
  for (const [region, questions] of Object.entries(INTERVIEW)) {
    for (const q of questions) {
      if (!q.safetyRuleId) continue;
      assert.ok(ruleIds.has(q.safetyRuleId), `${region}.${q.id} points at unknown rule ${q.safetyRuleId}`);
    }
  }
});

test('ISSUE 1: every safety question drives a declared signal', () => {
  for (const [region, questions] of Object.entries(INTERVIEW)) {
    for (const q of questions) {
      if (!q.safetyRuleId) continue;
      assert.ok(
        Object.hasOwn(QUESTION_SIGNALS, q.id),
        `${region}.${q.id} carries safetyRuleId "${q.safetyRuleId}" but drives no signal, ` +
          `so no rule could ever read it`,
      );
    }
  }
});

test('ISSUE 1: every safety signal is asked in at least one region', () => {
  for (const signal of Object.keys(QUESTION_SIGNALS).length ? Object.values(QUESTION_SIGNALS) : []) {
    const askedInSomeRegion = (['shoulder', 'neck', 'lower_back', 'knee'] as BodyRegion[]).some((r) =>
      signalIsAskedInRegion(signal, r),
    );
    assert.ok(askedInSomeRegion, `signal "${signal}" is wired to a question that no region asks`);
  }
});

test('ISSUE 1: every signal is read by at least one rule', () => {
  assert.deepEqual([...UNREAD_SIGNALS], [], 'a declared signal that no rule reads is dead wiring');
});

test('ISSUE 1: every urgent/emergency rule reads at least one signal', () => {
  assert.deepEqual(
    [...RULES_WITHOUT_QUESTION_SIGNAL],
    [],
    'a time-critical rule that reads no signal cannot be tested end to end',
  );
});

test('ISSUE 1: each safety question can move its signal on its own', () => {
  // A single driving question must be able to set the signal.
  for (const [questionId, signal] of Object.entries(QUESTION_SIGNALS)) {
    const onYes = signalsFromAnswers(answersOf([questionId, 'yes']))[signal];
    assert.equal(onYes, 'yes', `${questionId} did not set ${signal} on yes`);
  }
  // 'no' is only meaningful when EVERY question driving the signal said no.
  for (const [questionId, signal] of Object.entries(QUESTION_SIGNALS)) {
    const drivers = questionsForSignal(signal);
    const allNo = drivers.map((d) => [d, 'no'] as [string, 'no']);
    assert.equal(
      signalsFromAnswers(answersOf(...allNo))[signal],
      'no',
      `${questionId}: all drivers answered no must yield "no"`,
    );
    if (drivers.length > 1) {
      const onlyThisNo = signalsFromAnswers(answersOf([questionId, 'no']))[signal];
      assert.equal(
        onlyThisNo,
        'not_asked',
        `${signal} is multi-driver; one "no" with the rest unasked must not read as "no"`,
      );
    }
  }
});

test('a signal driven by two questions combines them, not last-write-wins', () => {
  // fever_or_systemic_unwell is driven by neck.systemic AND lower_back.systemic.
  // The previous implementation looped over the table and let the second entry
  // overwrite the first, silently erasing the neck answer.
  assert.deepEqual(questionsForSignal('fever_or_systemic_unwell'), ['neck.systemic', 'lower_back.systemic']);

  const neckOnly = signalsFromAnswers(answersOf(['neck.systemic', 'yes']));
  assert.equal(neckOnly.fever_or_systemic_unwell, 'yes', 'a neck answer alone must set the signal');

  const lbOnly = signalsFromAnswers(answersOf(['lower_back.systemic', 'yes']));
  assert.equal(lbOnly.fever_or_systemic_unwell, 'yes', 'a lower-back answer alone must set the signal');

  // one yes is enough regardless of the other being unanswered
  const mixed = signalsFromAnswers(
    answersOf(['neck.systemic', 'yes'], ['lower_back.systemic', 'no']),
  );
  assert.equal(mixed.fever_or_systemic_unwell, 'yes');

  // 'no' requires every driving question answered no
  const allNo = signalsFromAnswers(
    answersOf(['neck.systemic', 'no'], ['lower_back.systemic', 'no']),
  );
  assert.equal(allNo.fever_or_systemic_unwell, 'no');
  const oneNo = signalsFromAnswers(answersOf(['neck.systemic', 'no']));
  assert.equal(oneNo.fever_or_systemic_unwell, 'not_asked', 'one no and one unasked is not "no"');
});

test('an unknown answer outranks a no when combining signals', () => {
  const s = signalsFromAnswers(
    answersOf(['neck.systemic', 'no'], ['lower_back.systemic', 'unknown']),
  );
  assert.equal(s.fever_or_systemic_unwell, 'unknown', 'an indeterminate answer must not become "no"');
});

/* ================================================================== */
/* ISSUE 1: gaps must mean missing only                                */
/* ================================================================== */

test('ISSUE 1: gaps never contain answer markers or question ids', () => {
  const r = rec('lower_back');
  for (const q of INTERVIEW.lower_back) {
    applyAnswer(r, q.id, ans(q.id, 'yes'));
  }
  for (const gap of r.gaps) {
    assert.doesNotMatch(gap, /asked:/, `gaps must not hold answer markers, found "${gap}"`);
    assert.doesNotMatch(
      gap,
      /\./,
      `gaps must be record field paths, not question ids, found "${gap}"`,
    );
  }
});

/* ================================================================== */
/* Rules never assert a diagnosis                                      */
/* ================================================================== */

test('a rule match never asserts a diagnosis at the user', () => {
  const FORBIDDEN = [
    /you have (cauda|septic|disc|torn|fracture|infection|syndrome)/i,
    /you are suffering from/i,
    /you probably have/i,
    /most likely you/i,
    /the diagnosis is/i,
    /you have been diagnosed/i,
  ];
  for (const rule of ALL_RULES) {
    for (const banned of FORBIDDEN) {
      assert.doesNotMatch(rule.userMessage, banned, `rule ${rule.id} used banned phrasing`);
    }
    assert.ok(rule.actionSteps.length > 0, `${rule.id} must tell the user what to do`);
  }
});

test('a clean mechanical episode raises no flag', () => {
  const r = rec('lower_back');
  r.quality = ['aching'];
  r.triggers = ['lifting'];
  r.temporal = { ...r.temporal, frequency: 'intermittent', onset: 'after_activity', trend: 'stable' };
  const result = evaluateSafety(r, { region: 'lower_back' });
  assert.equal(result.flags.length, 0, `unexpected flags: ${JSON.stringify(result.flags)}`);
});
