/**
 * Right shoulder interview: what an answer actually records.
 *
 * ## Why this file exists separately from answer-withdrawal.test.ts
 *
 * That file proves a *general* property — that a question which records on an answer
 * withdraws it when corrected — and it derives which questions those are. It cannot see
 * inside a mapping. So a mapping that records the wrong thing, or nothing at all, passes
 * it: `shoulder.weakness` recorded on one of its three options and was never examined,
 * because the derivation probed with `raw: 'yes'`, which is not an option on a multi
 * question.
 *
 * These cases are about the RECORD for one region. Each asserts the value a clinician
 * would read, and each one is written so it fails against the mapping it replaces.
 *
 * ## The discipline this file keeps
 *
 * `applyTo` returns the field paths it wrote, and those paths become `wroteFields`, which
 * becomes the mutation payload and the provenance row. So a claim of "I wrote
 * `quality`" that changed nothing is a fabricated statement about what the patient
 * reported. Several cases below assert that no path is reported when nothing moved.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAnswer,
  buildAnswer,
  emptyRecord,
  evaluateSafety,
  fieldsFromAnswers,
  INTERVIEW,
  MSK_RULES,
  putAnswer,
  type AnswerMap,
  type SymptomRecord,
} from '../src/index.ts';

const SHOULDER = 'shoulder' as const;
const CAPTURED = { capturedAt: '2026-01-01T00:00:00.000Z', createdBy: 'user' } as const;

function answer(questionId: string, raw: unknown, triState: 'yes' | 'no' | 'unknown') {
  return buildAnswer({ questionId, raw, triState, provenance: CAPTURED });
}

/** Apply each step in order, then read the recomputed answer-derived fields. */
function replay(steps: { questionId: string; raw: unknown; triState: 'yes' | 'no' | 'unknown' }[]) {
  let answers: AnswerMap = {};
  let record: SymptomRecord = emptyRecord(SHOULDER);
  for (const step of steps) {
    const a = answer(step.questionId, step.raw, step.triState);
    record = structuredClone(record);
    applyAnswer(record, step.questionId, a);
    answers = putAnswer(answers, a);
  }
  return { fields: fieldsFromAnswers(SHOULDER, answers), answers };
}

/** `applyTo` on a fresh record, and what it claims to have written. */
function writtenPaths(questionId: string, raw: unknown, triState: 'yes' | 'no' | 'unknown' = 'yes') {
  const record = emptyRecord(SHOULDER);
  const before = JSON.stringify(record);
  const paths = applyAnswer(record, questionId, answer(questionId, raw, triState));
  return { paths, changed: JSON.stringify(record) !== before };
}

const activities = (steps: Parameters<typeof replay>[0]) =>
  replay(steps).fields['function.activitiesAffected'] as string[];

/* ------------------------------------------------------------------ */

describe('shoulder.injury_context: "I am not sure" is not a mechanism', () => {
  test('records nothing when the answer is the unsure option', () => {
    const { paths, changed } = writtenPaths('shoulder.injury_context', 'unknown', 'unknown');
    assert.equal(changed, false, 'an unsure answer changed the record');
    assert.deepEqual(paths, [], 'an unsure answer claimed a field write');
  });

  test('never stores the option value as the mechanism', () => {
    // Before the fix `applyTo` was `record.context.recentInjury = String(a.raw)`, so the
    // field held the literal string "unknown" and the summary printed
    // "Recent injury or mechanism: I am not sure" under a covered heading.
    const { fields } = replay([{ questionId: 'shoulder.injury_context', raw: 'unknown', triState: 'unknown' }]);
    assert.notEqual(
      fields['context.recentInjury'],
      'unknown',
      'the mechanism field is holding the option value',
    );
    assert.equal(fields['context.recentInjury'], null, 'no mechanism should be recorded at all');
  });

  test('still records each real mechanism', () => {
    for (const value of ['injury', 'activity', 'nothing']) {
      const { paths } = writtenPaths('shoulder.injury_context', value);
      assert.deepEqual(paths, ['context.recentInjury'], `${value} did not record the mechanism`);
    }
  });

  test('a definite mechanism corrected to unsure withdraws it', () => {
    const { fields } = replay([
      { questionId: 'shoulder.injury_context', raw: 'injury', triState: 'yes' },
      { questionId: 'shoulder.injury_context', raw: 'unknown', triState: 'unknown' },
    ]);
    assert.equal(
      fields['context.recentInjury'],
      null,
      'correcting the mechanism to "I am not sure" left the original mechanism in the record',
    );
  });

  test('a definite mechanism corrected to another mechanism replaces it', () => {
    const { fields } = replay([
      { questionId: 'shoulder.injury_context', raw: 'injury', triState: 'yes' },
      { questionId: 'shoulder.injury_context', raw: 'nothing', triState: 'no' },
    ]);
    assert.equal(fields['context.recentInjury'], 'nothing');
  });

  test('an unrecognised value records nothing rather than being stored', () => {
    // Allowlist rather than a check for the word "unknown", so a future option cannot
    // start writing a domain fact simply by existing.
    const { changed } = writtenPaths('shoulder.injury_context', 'something-new', 'yes');
    assert.equal(changed, false, 'an unknown mechanism was stored as if it were one');
  });
});

describe('shoulder.weakness: every weakness option records, and the denial withdraws', () => {
  const W = 'shoulder.weakness';

  test('each weakness option writes its OWN activity', () => {
    const expected: Record<string, string> = {
      weak_above_head: 'weak reaching overhead',
      weak_external_rotation: 'weak turning out to the side',
      weak_internal_rotation: 'weak turning in behind my back',
    };
    for (const [option, activity] of Object.entries(expected)) {
      const { paths, changed } = writtenPaths(W, [option]);
      assert.ok(changed, `${option} recorded NOTHING — the user answered and the record stayed silent`);
      assert.deepEqual(paths, ['function.activitiesAffected'], `${option} claimed the wrong paths`);
      assert.deepEqual(
        activities([{ questionId: W, raw: [option], triState: 'yes' }]),
        [activity],
        `${option} recorded the wrong activity`,
      );
    }
  });

  test('does not record weakness as "giving way"', () => {
    // The bug: `weak_above_head` added `quality: ['instability']`, which the pre-visit
    // summary renders as "Giving way / unstable". Weakness overhead and the shoulder
    // giving way are different complaints, and this label is read literally.
    for (const option of ['weak_above_head', 'weak_external_rotation', 'weak_internal_rotation']) {
      const { fields } = replay([{ questionId: W, raw: [option], triState: 'yes' }]);
      assert.deepEqual(
        fields['quality'],
        [],
        `${option} recorded a quality; weakness is a functional fact and quality is not its synonym`,
      );
    }
  });

  test('records several selected weaknesses at once', () => {
    assert.deepEqual(
      activities([{ questionId: W, raw: ['weak_above_head', 'weak_internal_rotation'], triState: 'yes' }]),
      ['weak reaching overhead', 'weak turning in behind my back'],
    );
  });

  test('option A corrected to option B replaces, and does not accumulate', () => {
    // Two of the three options recorded nothing before the fix, so this path could not
    // have existed: the correction produced an empty list and looked like a withdrawal.
    assert.deepEqual(
      activities([
        { questionId: W, raw: ['weak_above_head'], triState: 'yes' },
        { questionId: W, raw: ['weak_external_rotation'], triState: 'yes' },
      ]),
      ['weak turning out to the side'],
    );
  });

  test('correcting to "just pain" withdraws every weakness activity', () => {
    assert.deepEqual(
      activities([
        { questionId: W, raw: ['weak_above_head'], triState: 'yes' },
        { questionId: W, raw: ['pain_only'], triState: 'no' },
      ]),
      [],
    );
    assert.deepEqual(
      activities([
        { questionId: W, raw: ['weak_above_head', 'weak_internal_rotation'], triState: 'yes' },
        { questionId: W, raw: ['pain_only'], triState: 'no' },
      ]),
      [],
      'the denial did not withdraw a multi-selection',
    );
  });

  test('withdrawing weakness never removes what another question recorded', () => {
    // The ownership case. `shoulder.weakness` withdraws only its own strings, so a
    // correction here cannot take a lower-back-shaped value with it — which is exactly
    // what the old filter did: it removed the literal 'leg feels weak', a LOWER BACK
    // activity no shoulder option can ever have written.
    const record = emptyRecord(SHOULDER);
    record.function.activitiesAffected = ['leg feels weak', 'weak reaching overhead'];
    applyAnswer(record, W, answer(W, ['pain_only'], 'no'));
    assert.deepEqual(
      record.function.activitiesAffected,
      ['leg feels weak'],
      'the withdrawal removed a value this question never wrote',
    );
  });

  test('reports no write when the answer does not move the field', () => {
    // `pain_only` on a fresh record used to return ['function.activitiesAffected'] while
    // changing nothing, which puts a provenance row on a field the answer never touched.
    const { paths, changed } = writtenPaths(W, ['pain_only']);
    assert.equal(changed, false);
    assert.deepEqual(paths, [], 'claimed a write while the record did not move');
  });

  test('re-answering the same options reports no write', () => {
    const record = emptyRecord(SHOULDER);
    applyAnswer(record, W, answer(W, ['weak_above_head'], 'yes'));
    const before = JSON.stringify(record);
    const paths = applyAnswer(record, W, answer(W, ['weak_above_head'], 'yes'));
    assert.equal(JSON.stringify(record), before);
    assert.deepEqual(paths, [], 'an idempotent answer claimed a mutation');
  });
});

describe('shoulder.radiation: an unsure answer is not a location', () => {
  const R = 'shoulder.radiation';

  test('the unsure option exists, so the answer is a real one the UI can offer', () => {
    const question = INTERVIEW[SHOULDER].find((q) => q.id === R);
    const values = (question?.options ?? []).map((o) => o.value);
    assert.ok(values.includes('unsure'), `no unsure option; got ${values.join(', ')}`);
  });

  test('records nothing when the answer is unsure', () => {
    const { paths, changed } = writtenPaths(R, 'unsure', 'unknown');
    assert.equal(changed, false);
    assert.deepEqual(paths, []);
  });

  test('never writes the words "I am not sure" into radiation', () => {
    // Before: `radiation` is a list of strings with no enum, so any raw was accepted and
    // the summary printed "Radiation: I Am Not Sure" as a reported distribution.
    for (const raw of ['unsure', 'I am not sure']) {
      const { fields } = replay([{ questionId: R, raw, triState: 'unknown' }]);
      assert.deepEqual(
        fields['radiation'],
        [],
        `"${raw}" was recorded as a radiation`,
      );
    }
  });

  test('a recorded radiation corrected to unsure withdraws it', () => {
    const { fields } = replay([
      { questionId: R, raw: 'lateral_arm', triState: 'yes' },
      { questionId: R, raw: 'unsure', triState: 'unknown' },
    ]);
    assert.deepEqual(fields['radiation'], [], 'the radiation survived being corrected to unsure');
  });

  test('"none" is still a recorded negative, not a withdrawal', () => {
    const { fields } = replay([{ questionId: R, raw: 'none', triState: 'no' }]);
    assert.deepEqual(fields['radiation'], [], '"none" should record an explicitly empty radiation');
  });

  test('hand_tingle reports quality only when it actually adds numbness', () => {
    const both = writtenPaths(R, 'hand_tingle');
    assert.deepEqual(both.paths, ['radiation', 'quality']);
    // Re-answering identically changes nothing, so it must claim nothing. Reported as
    // ['radiation'] would be a provenance row on a field the second answer never touched.
    const record = emptyRecord(SHOULDER);
    applyAnswer(record, R, answer(R, 'hand_tingle', 'yes'));
    const before = JSON.stringify(record);
    const second = applyAnswer(record, R, answer(R, 'hand_tingle', 'yes'));
    assert.equal(JSON.stringify(record), before);
    assert.deepEqual(second, [], 'an idempotent answer claimed a mutation');
  });

  test('reports no write when "none" lands on an already-empty radiation', () => {
    // Caught by the derived-case probe once it began probing real option values.
    const { paths, changed } = writtenPaths(R, 'none', 'no');
    assert.equal(changed, false);
    assert.deepEqual(paths, [], 'an already-empty field was reported as written');
  });

  test('records "it comes from my neck" without offering a structure that cannot resolve', () => {
    const question = INTERVIEW[SHOULDER].find((q) => q.id === R);
    const neckOption = (question?.options ?? []).find((o) => o.value === 'neck_related');
    assert.ok(neckOption, 'the neck option was removed rather than fixed');
    // `impliedStructures()` filters by region, so a neck id offered from a shoulder
    // episode was dropped silently and the option yielded nothing.
    assert.equal(
      neckOption?.impliesStructureIds,
      undefined,
      'the unreachable cross-region mapping is back',
    );
    // The answer itself is kept, which is the honest record of "this may be the neck".
    const { fields } = replay([{ questionId: R, raw: 'neck_related', triState: 'yes' }]);
    assert.deepEqual(fields['radiation'], ['neck_related']);
  });
});

describe('msk.neck_trauma_neuro does not describe a neck to a shoulder patient', () => {
  const rule = MSK_RULES.find((r) => r.id === 'msk.neck_trauma_neuro');

const firedOn = (region: 'neck' | 'shoulder', profile: 'development' | 'release' = 'development') => {
    const record = emptyRecord(region);
    record.location = { ...record.location, region };
    record.quality = ['numbness'];
    return evaluateSafety(record, {
      region,
      profile,
      signals: {
        bladder_or_bowel_change: 'not_asked', saddle_numbness: 'not_asked', leg_weakness: 'not_asked',
        fever_or_systemic_unwell: 'not_asked', cold_pale_or_numb_hand: 'no', hot_red_swollen_joint: 'not_asked',
        trauma_with_loss_of_movement: 'yes', neck_trauma_with_neuro_symptoms: 'not_asked',
        weight_bearing_lost: 'not_asked', joint_locking_or_giving_way: 'not_asked',
      } as never,
    });
  };

test('still fires, at the same severity, for a shoulder episode', () => {
    // Presentation is what changed. If this rule should not have fired before, changing
    // its wording instead of its predicate would have been a clinical change.
    assert.ok(rule, 'the rule is gone');
    assert.equal(rule?.scope.includes('shoulder'), true, 'shoulder was removed from scope');
    assert.equal(rule?.severity, 'emergency', 'severity changed');
    assert.deepEqual(rule?.signalsUsed, ['neck_trauma_with_neuro_symptoms', 'trauma_with_loss_of_movement']);
    const shoulderFlag = firedOn('shoulder').flags.find((f) => f.ruleId === 'msk.neck_trauma_neuro');
    assert.ok(shoulderFlag, 'the rule stopped firing for a shoulder patient who needs it');
    assert.equal(shoulderFlag.severity, 'emergency');
  });

test('still escalates to blocked in the release profile, as it did before', () => {
    // `blocked` is set when a fired rule is WITHHELD, which the release profile does for
    // every unreviewed rule. Wording is not consulted, so a wording change cannot have
    // moved this -- asserted because "I only changed a string" is exactly the claim that
    // should not be taken on trust for an emergency rule.
    const released = firedOn('shoulder', 'release');
    assert.equal(released.blocked, true, 'a fired emergency rule must still block in release');
    assert.ok(
      released.withheld.some((w) => w.ruleId === 'msk.neck_trauma_neuro'),
      'the rule is no longer withheld, so an unreviewed emergency rule reached a user',
    );
  });

  test('shows a shoulder patient no neck-specific wording', () => {
    const flag = firedOn('shoulder').flags.find((f) => f.ruleId === 'msk.neck_trauma_neuro');
    assert.ok(flag);
    const said = `${flag.userMessage} ${flag.actionSteps.join(' ')}`.toLowerCase();
    assert.equal(said.includes('neck'), false, `shoulder patient was told about their neck: "${flag.userMessage}"`);
    // ...while still saying something about the body part that was actually described.
    const shoulderFlag = firedOn('shoulder').flags.find((f) => f.ruleId === 'msk.neck_trauma_neuro');
    assert.match(shoulderFlag!.actionSteps.join(' '), /injured area/i);
  });

  test('the same wording serves the neck region, where neck is correct', () => {
    const flag = firedOn('neck').flags.find((f) => f.ruleId === 'msk.neck_trauma_neuro');
    assert.ok(flag);
    assert.equal(flag.userMessage.toLowerCase().includes('neck'), false, 'the neutral wording should hold for both');
  });
});