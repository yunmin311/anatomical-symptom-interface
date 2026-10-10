/**
 * Explicit shoulder uncertainty and patient-readable summary labels.
 *
 * The interview already distinguished unknown from no and not-asked, but three
 * shoulder questions had no explicit unsure response. Free text depended on
 * matching an English uncertainty phrase, while weakness and tenderness forced
 * an uncertain patient into either a definite option or a different statement
 * (`pain_only`, `not_tested`).
 *
 * These cases prove the semantic contract, not merely that an option renders:
 * an explicit unknown answer is retained, remains outstanding, writes no domain
 * fact, withdraws a replaced definite answer on correction, and never becomes
 * a negative. Summary labels come from the option registry without changing
 * storage.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerFactPaths,
  applyAnswer,
  buildAnswer,
  buildPreVisitSummary,
  deriveCoverage,
  emptyRecord,
  fieldsFromAnswers,
  INTERVIEW,
  isGenuinelyUncertain,
  NOT_ASKED_LABEL,
  optionLabel,
  putAnswer,
  questionProgress,
  renderPlainText,
  UNKNOWN_LABEL,
  type AnswerMap,
  type Episode,
  type QuestionAnswer,
  type SymptomRecord,
} from '../src/index.ts';

const SHOULDER = 'shoulder' as const;
const CAPTURED = { capturedAt: '2026-01-01T00:00:00.000Z', createdBy: 'user' } as const;
const ELEVATION = 'shoulder.elevation';
const WEAKNESS = 'shoulder.weakness';
const TENDERNESS = 'shoulder.tenderness';
const INJURY = 'shoulder.injury_context';
const RADIATION = 'shoulder.radiation';

function answer(questionId: string, raw: unknown, triState: 'yes' | 'no' | 'unknown'): QuestionAnswer {
  return buildAnswer({ questionId, raw, triState, provenance: CAPTURED });
}

function replay(steps: { questionId: string; raw: unknown; triState: 'yes' | 'no' | 'unknown' }[]) {
  let answers: AnswerMap = {};
  const record = emptyRecord(SHOULDER);
  for (const step of steps) {
    const current = answer(step.questionId, step.raw, step.triState);
    applyAnswer(record, step.questionId, current);
    answers = putAnswer(answers, current);
  }
  return { record, answers, fields: fieldsFromAnswers(SHOULDER, answers) };
}

function outstanding(questionId: string, current: QuestionAnswer): boolean {
  const record = emptyRecord(SHOULDER);
  return questionProgress({ record, answers: { [questionId]: current } }).outstanding.includes(questionId);
}

function shoulderEpisode(record: SymptomRecord): Episode {
  return {
    id: 'ep_shoulder_uncertainty',
    personId: 'p1',
    region: SHOULDER,
    side: 'right',
    status: 'open',
    title: 'Shoulder',
    record,
    provenance: {},
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    safetyFlags: [],
  };
}

function summaryValue(
  record: SymptomRecord,
  label: string,
  coverage: Record<string, boolean> = deriveCoverage(record),
  answers: AnswerMap = {},
) {
  const summary = buildPreVisitSummary(shoulderEpisode(record), { coverage, answers });
  return { summary, value: summary.history.find((row) => row.label === label)?.value };
}

describe('shoulder.elevation has an explicit standardized uncertainty response', () => {
  test('the response is declared on the question, not inferred from prose', () => {
    const question = INTERVIEW[SHOULDER].find((candidate) => candidate.id === ELEVATION);
    assert.deepEqual(question?.uncertainty, { value: 'unsure', label: 'I am not sure' });
  });

  test('the standardized value records no movement fact and stays outstanding', () => {
    const current = answer(ELEVATION, 'unsure', 'unknown');
    const record = emptyRecord(SHOULDER);
    const before = JSON.stringify(record);
    const paths = applyAnswer(record, ELEVATION, current);

    assert.deepEqual(paths, [], 'uncertainty claimed a field write');
    assert.equal(JSON.stringify(record), before, 'uncertainty changed the record');
    assert.equal(record.triggerDetail, null);
    assert.deepEqual(record.triggers, []);
    assert.ok(isGenuinelyUncertain(INTERVIEW[SHOULDER].find((q) => q.id === ELEVATION)!, current));
    assert.deepEqual(answerFactPaths(ELEVATION, current), []);
    assert.ok(outstanding(ELEVATION, current), 'uncertainty stopped being outstanding');
  });

  test('definite and uncertain answers replace each other without residue', () => {
    const definiteThenUnknown = replay([
      { questionId: ELEVATION, raw: 'reaching overhead', triState: 'yes' },
      { questionId: ELEVATION, raw: 'unsure', triState: 'unknown' },
    ]);
    assert.equal(definiteThenUnknown.fields.triggerDetail, null);
    assert.deepEqual(definiteThenUnknown.fields.triggers, []);

    const unknownThenDefinite = replay([
      { questionId: ELEVATION, raw: 'unsure', triState: 'unknown' },
      { questionId: ELEVATION, raw: 'reaching overhead', triState: 'yes' },
    ]);
    assert.equal(unknownThenDefinite.fields.triggerDetail, 'reaching overhead');
    assert.deepEqual(unknownThenDefinite.fields.triggers, ['movement']);
  });
});

describe('shoulder.weakness uncertainty is exclusive and writes nothing', () => {
  test('the unknown option is declared exclusive', () => {
    const option = INTERVIEW[SHOULDER].find((q) => q.id === WEAKNESS)?.options?.find(
      (candidate) => candidate.value === 'unknown',
    );
    assert.equal(option?.label, 'I am not sure');
    assert.equal(option?.exclusive, true);
  });

  test('pain_only is exclusive against every weakness option and unknown', () => {
    // `pain_only` used to combine freely with weakness options, so a mixed answer
    // silently read as a denial. Both exclusive markers must be declared for the
    // UI to keep them apart.
    const options = INTERVIEW[SHOULDER].find((q) => q.id === WEAKNESS)?.options ?? [];
    const painOnly = options.find((option) => option.value === 'pain_only');
    assert.equal(painOnly?.exclusive, true);
    const weaknessOptions = options.filter((option) => option.value.startsWith('weak_'));
    assert.equal(weaknessOptions.length, 3, 'the three weakness options must stay multi-selectable');
    assert.ok(weaknessOptions.every((option) => option.exclusive !== true));
  });

  test('a denial mixed with a weakness report records nothing, not a denial', () => {
    // The failure this closes: `['weak_above_head', 'pain_only']` let the denial
    // win and withdrew every weakness activity, so a contradictory answer read as
    // "no weakness". Contradiction is indeterminate: no fact, still outstanding.
    for (const raw of [
      ['weak_above_head', 'pain_only'],
      ['pain_only', 'weak_external_rotation'],
      ['pain_only', 'unknown'],
    ]) {
      const current = answer(WEAKNESS, raw, 'unknown');
      const record = emptyRecord(SHOULDER);
      const before = JSON.stringify(record);
      const paths = applyAnswer(record, WEAKNESS, current);

      assert.deepEqual(paths, [], `${JSON.stringify(raw)} claimed a field write`);
      assert.equal(JSON.stringify(record), before, `${JSON.stringify(raw)} changed the record`);
      assert.ok(outstanding(WEAKNESS, current), `${JSON.stringify(raw)} stopped being outstanding`);
      assert.deepEqual(answerFactPaths(WEAKNESS, current), []);
    }
  });

  test('pain_only alone still denies weakness, and duplication changes nothing', () => {
    // Normal denial semantics are untouched: a lone denial withdraws, and saying
    // it twice is not a contradiction.
    const { fields } = replay([
      { questionId: WEAKNESS, raw: ['weak_above_head'], triState: 'yes' },
      { questionId: WEAKNESS, raw: ['pain_only'], triState: 'no' },
    ]);
    assert.deepEqual(fields['function.activitiesAffected'], []);
    const duplicated = replay([{ questionId: WEAKNESS, raw: ['pain_only', 'pain_only'], triState: 'no' }]);
    assert.deepEqual(duplicated.fields['function.activitiesAffected'], []);
    assert.ok(!outstanding(WEAKNESS, duplicated.answers[WEAKNESS]!));
  });

  test('unknown records no activity, even when combined with another value', () => {
    for (const raw of [['unknown'], ['unknown', 'weak_above_head'], ['unknown', 'pain_only']]) {
      const current = answer(WEAKNESS, raw, 'unknown');
      const record = emptyRecord(SHOULDER);
      const before = JSON.stringify(record);
      const paths = applyAnswer(record, WEAKNESS, current);

      assert.deepEqual(paths, [], `${JSON.stringify(raw)} claimed a field write`);
      assert.equal(JSON.stringify(record), before, `${JSON.stringify(raw)} changed the record`);
      assert.ok(outstanding(WEAKNESS, current), `${JSON.stringify(raw)} stopped being outstanding`);
      assert.deepEqual(answerFactPaths(WEAKNESS, current), []);
    }
  });

  test('correcting weakness to unknown withdraws the replaced activity', () => {
    const { fields, answers } = replay([
      { questionId: WEAKNESS, raw: ['weak_above_head'], triState: 'yes' },
      { questionId: WEAKNESS, raw: ['unknown'], triState: 'unknown' },
    ]);
    assert.deepEqual(fields['function.activitiesAffected'], []);
    assert.ok(outstanding(WEAKNESS, answers[WEAKNESS]!));
  });

  test('correcting unknown to weakness records the new activity', () => {
    const { fields, answers } = replay([
      { questionId: WEAKNESS, raw: ['unknown'], triState: 'unknown' },
      { questionId: WEAKNESS, raw: ['weak_external_rotation'], triState: 'yes' },
    ]);
    assert.deepEqual(fields['function.activitiesAffected'], ['weak turning out to the side']);
    assert.ok(!outstanding(WEAKNESS, answers[WEAKNESS]!));
  });
});

describe('shoulder.tenderness distinguishes untested from undetermined', () => {
  test('unknown writes nothing, while not_tested remains a real report', () => {
    const unknown = answer(TENDERNESS, 'unknown', 'unknown');
    const unknownRecord = emptyRecord(SHOULDER);
    assert.deepEqual(applyAnswer(unknownRecord, TENDERNESS, unknown), []);
    assert.equal(unknownRecord.tendernessOnPalpation, 'unknown');
    assert.ok(outstanding(TENDERNESS, unknown));
    assert.deepEqual(answerFactPaths(TENDERNESS, unknown), []);

    const notTested = answer(TENDERNESS, 'not_tested', 'yes');
    const testedRecord = emptyRecord(SHOULDER);
    assert.deepEqual(applyAnswer(testedRecord, TENDERNESS, notTested), ['tendernessOnPalpation']);
    assert.equal(testedRecord.tendernessOnPalpation, 'not_tested');
    assert.ok(!outstanding(TENDERNESS, notTested));
  });

  test('corrections move between severity, untested, and undetermined without residue', () => {
    const toUnknown = replay([
      { questionId: TENDERNESS, raw: 'moderate', triState: 'yes' },
      { questionId: TENDERNESS, raw: 'unknown', triState: 'unknown' },
    ]);
    assert.equal(toUnknown.fields.tendernessOnPalpation, 'unknown');

    const toSeverity = replay([
      { questionId: TENDERNESS, raw: 'unknown', triState: 'unknown' },
      { questionId: TENDERNESS, raw: 'severe', triState: 'yes' },
    ]);
    assert.equal(toSeverity.fields.tendernessOnPalpation, 'severe');

    const toUntested = replay([
      { questionId: TENDERNESS, raw: 'unknown', triState: 'unknown' },
      { questionId: TENDERNESS, raw: 'not_tested', triState: 'yes' },
    ]);
    assert.equal(toUntested.fields.tendernessOnPalpation, 'not_tested');
  });
});

describe('shoulder.tenderness asked-but-undetermined renders as not established', () => {
  test('unknown is not established, never asked, with no value row', () => {
    // Before the fix the summary row read "not asked", collapsing an asked but
    // undetermined answer into silence. The record still holds no value row.
    const record = emptyRecord(SHOULDER);
    const answers = { [TENDERNESS]: answer(TENDERNESS, 'unknown', 'unknown') };
    const coverage = { ...deriveCoverage(record), tendernessOnPalpation: false };
    const { summary, value } = summaryValue(record, 'Tenderness on palpation', coverage, answers);

    assert.equal(value, UNKNOWN_LABEL);
    assert.equal(
      (summary.structured as { tendernessOnPalpation: unknown }).tendernessOnPalpation,
      null,
      'uncertainty created a tenderness value in the structured output',
    );
    assert.ok(
      summary.outstandingFields.includes('tendernessOnPalpation'),
      'uncertainty is missing from outstanding fields',
    );
    assert.match(
      renderPlainText(summary),
      /Tenderness on palpation: not established/,
      'the copied summary reports uncertainty as never asked',
    );
  });

  test('never asked still reads as not asked', () => {
    const record = emptyRecord(SHOULDER);
    const { summary, value } = summaryValue(record, 'Tenderness on palpation');
    assert.equal(value, NOT_ASKED_LABEL);
    assert.equal(
      (summary.structured as { tendernessOnPalpation: unknown }).tendernessOnPalpation,
      null,
    );
    assert.ok(summary.outstandingFields.includes('tendernessOnPalpation'));
  });

  test('not_tested still reads as a real untested report', () => {
    const record = emptyRecord(SHOULDER);
    record.tendernessOnPalpation = 'not_tested';
    const { summary, value } = summaryValue(record, 'Tenderness on palpation');
    assert.equal(value, 'Not Tested');
    assert.equal(
      (summary.structured as { tendernessOnPalpation: unknown }).tendernessOnPalpation,
      'not_tested',
    );
    assert.ok(!summary.outstandingFields.includes('tendernessOnPalpation'));
  });

  test('the tenderness special case never reaches another region', () => {
    const record = emptyRecord('neck');
    const answers = { [TENDERNESS]: answer(TENDERNESS, 'unknown', 'unknown') };
    const { value } = summaryValue(record, 'Tenderness on palpation', deriveCoverage(record), answers);
    assert.equal(value, NOT_ASKED_LABEL, 'a neck summary adopted the shoulder display rule');
  });
});

describe('shoulder rationales stay neutral about cause and tissue', () => {
  test('no rationale makes an absolute, exclusive, or tissue attribution', () => {
    const rationales = INTERVIEW[SHOULDER].map((question) => question.rationale).join('\n');
    assert.doesNotMatch(rationales, /single most discriminating/i);
    assert.doesNotMatch(rationales, /almost always/i);
    assert.doesNotMatch(rationales, /points at the (tendon|cuff|bursa|joint)/i);
    assert.doesNotMatch(rationales, /bony shelf is a different structure/i);
    assert.doesNotMatch(rationales, /circulation problem, not a tendon problem/i);
    assert.doesNotMatch(rationales, /needs same-day assessment/i);
  });
});

describe('shoulder summaries use option labels, not storage tokens', () => {
  test('mechanism values render with their existing labels', () => {
    const expected: Record<string, string> = {
      injury: 'An injury or fall',
      activity: 'After physical activity',
      nothing: 'Nothing in particular',
    };
    for (const [stored, label] of Object.entries(expected)) {
      const record = emptyRecord(SHOULDER);
      record.context.recentInjury = stored;
      const { summary, value } = summaryValue(record, 'Recent injury or mechanism');
      assert.equal(value, label, `${stored} was rendered as a storage token`);
      assert.equal(
        (summary.structured as { context: { recentInjury: unknown } }).context.recentInjury,
        stored,
        'display wording changed the stored mechanism',
      );
    }
  });

  test('radiation values render with their existing labels', () => {
    const record = emptyRecord(SHOULDER);
    record.radiation = ['lateral_arm', 'front_arm', 'hand_tingle', 'neck_related'];
    const { summary, value } = summaryValue(record, 'Radiation');
    assert.equal(
      value,
      'Down the outside of my arm, Down the front of my arm, Into my hand with tingling or numbness, It comes from my neck',
    );
    assert.deepEqual(
      (summary.structured as { radiation: unknown }).radiation,
      ['lateral_arm', 'front_arm', 'hand_tingle', 'neck_related'],
      'display wording changed stored radiation',
    );
    assert.doesNotMatch(
      renderPlainText(summary),
      /Lateral Arm|Front Arm|Hand Tingle|Neck Related/,
      'copied text exposed storage tokens',
    );
  });

  test('unknown, explicit none, and not asked remain distinct', () => {
    const unresolvedRecord = emptyRecord(SHOULDER);
    const unresolved = summaryValue(
      unresolvedRecord,
      'Radiation',
      { ...deriveCoverage(unresolvedRecord), radiation: false },
      { [RADIATION]: answer(RADIATION, 'unsure', 'unknown') },
    );
    assert.equal(unresolved.value, UNKNOWN_LABEL);

    const deniedRecord = emptyRecord(SHOULDER);
    const denied = summaryValue(deniedRecord, 'Radiation', {
      ...deriveCoverage(deniedRecord),
      radiation: true,
    });
    assert.equal(denied.value, 'none');

    const unaskedRecord = emptyRecord(SHOULDER);
    const unasked = summaryValue(unaskedRecord, 'Radiation');
    assert.equal(unasked.value, NOT_ASKED_LABEL);
  });

  test('option labels come from the registry, with storage as the fallback', () => {
    assert.equal(optionLabel(INJURY, 'activity'), 'After physical activity');
    assert.equal(optionLabel(RADIATION, 'neck_related'), 'It comes from my neck');
    assert.equal(optionLabel(RADIATION, 'retired-value'), undefined);
  });
});

describe('this milestone leaves other regions production interviews unchanged', () => {
  test('explicit uncertainty affordances exist only on the approved shoulder questions', () => {
    const elevation = INTERVIEW[SHOULDER].find((question) => question.id === ELEVATION);
    const weaknessUnknown = INTERVIEW[SHOULDER].find((question) => question.id === WEAKNESS)?.options?.find(
      (option) => option.value === 'unknown',
    );
    const tendernessUnknown = INTERVIEW[SHOULDER].find((question) => question.id === TENDERNESS)?.options?.find(
      (option) => option.value === 'unknown',
    );
    assert.ok(elevation?.uncertainty, 'the approved elevation affordance is missing');
    assert.ok(weaknessUnknown, 'the approved weakness affordance is missing');
    assert.ok(tendernessUnknown, 'the approved tenderness affordance is missing');

    for (const region of ['neck', 'lower_back', 'knee'] as const) {
      for (const question of INTERVIEW[region]) {
        assert.equal(
          question.uncertainty,
          undefined,
          `${question.id} gained an uncertainty affordance outside the approved shoulder scope`,
        );
        for (const option of question.options ?? []) {
          assert.notEqual(
            option.exclusive,
            true,
            `${question.id} gained an exclusive option outside the approved shoulder scope`,
          );
        }
      }
    }
  });

  test('summary label mapping does not rewrite another region', () => {
    const record = emptyRecord('neck');
    record.context.recentInjury = 'whiplash';
    record.radiation = ['arm_pain'];
    const episode = { ...shoulderEpisode(record), region: 'neck' as const, title: 'Neck', record };
    const summary = buildPreVisitSummary(episode, { coverage: deriveCoverage(record) });

    assert.equal(
      summary.history.find((row) => row.label === 'Recent injury or mechanism')?.value,
      'whiplash',
      'a neck mechanism was rewritten by shoulder display mapping',
    );
    assert.equal(
      summary.history.find((row) => row.label === 'Radiation')?.value,
      'Arm Pain',
      'a neck radiation value was rewritten by shoulder display mapping',
    );
  });
});
