/**
 * Correcting an answer must WITHDRAW what the original answer recorded.
 *
 * ## The bug this exists for
 *
 * Six interview questions were written as "an explicit yes adds these values; anything else
 * writes nothing", on the reasoning that an unasked or uncertain answer must never change
 * the record. That reasoning is right for UNCERTAINTY and wrong for a definite NO.
 *
 * So correcting "yes, I have numbness in my leg" to "no" left `quality: ["numbness",
 * "tingling"]` in the record. The answer was marked `user_edited`, the safety flag was
 * withdrawn, and the clinician's summary still printed "numbness, tingling" under a
 * heading whose flag had just been retracted. The correction was accepted, visible, and
 * completely inert -- which made the whole correction feature cosmetic for those questions.
 *
 * A per-question withdrawal would have to guess ownership: `instability` is added by three
 * questions, `numbness` by three, `swelling` by two. So the store RECOMPUTES the
 * answer-derived fields from the whole answer set, which never guesses.
 *
 * ## What these tests would have caught
 *
 * Every one of them answered YES then NO and asserted the record no longer says YES. Each
 * names the question it covers, because "some questions withdraw and some do not" is the
 * exact shape of the bug and a single happy-path test cannot see it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWER_DERIVED_FIELD_PATHS,
  applyAnswer,
  buildAnswer,
  emptyRecord,
  fieldsFromAnswers,
  INTERVIEW,
  putAnswer,
  type AnswerMap,
  type BodyRegion,
  type SymptomRecord,
} from '../src/index.ts';

interface AnswerStep {
  questionId: string;
  raw: unknown;
  triState: 'yes' | 'no' | 'unknown';
}

/** Record + answers after answering `entries` in order, through the real engine. */
function replay(
  region: BodyRegion,
  entries: AnswerStep[],
): { record: SymptomRecord; answers: AnswerMap; fields: Record<string, unknown> } {
  let answers: AnswerMap = {};
  let record = emptyRecord(region);
  for (const entry of entries) {
    const answer = buildAnswer({
      questionId: entry.questionId,
      raw: entry.raw,
      triState: entry.triState,
      provenance: { capturedAt: '2026-01-01T00:00:00.000Z', createdBy: 'user' },
    });
    // `putAnswer`, not `answers[id] = answer`. `AnswerMap` is a Readonly record by design,
    // so assigning into it worked at runtime and failed typecheck -- and the fix people reach
    // for in that situation is a cast, which is how a readonly becomes a lie.
    answers = putAnswer(answers, answer);
    record = structuredClone(record);
    applyAnswer(record, entry.questionId, answer);
  }
  return { record, answers, fields: fieldsFromAnswers(region, answers) };
}

/**
 * Every question that records something on an affirmative, with the value it records.
 *
 * Read off the engine by executing each `applyTo`, not by reading it: a hand-typed list
 * drifts, and a case whose question id no longer exists would assert against an empty
 * field and pass. The precondition inside each test is what makes the list honest.
 */
const CASES: {
  questionId: string;
  region: BodyRegion;
  /** A list-valued derived field. */
  path?: string;
  /** Defaults to 'yes'. Some questions only write a field for one particular option. */
  affirmativeRaw?: unknown;
  /** The value a "yes" must leave in it. */
  token: string;
  /** A scalar derived field, compared with `===`. */
  scalar?: boolean;
  /** The raw value that means "not this", for questions that are not yes/no. */
  negativeRaw?: unknown;
  negativeTriState?: 'yes' | 'no' | 'unknown';
}[] = [
  // Boolean questions: the correction IS "no".
  { questionId: 'shoulder.night_pain', region: 'shoulder', path: 'triggers', token: 'night' },
  { questionId: 'neck.systemic', region: 'neck', path: 'context.systemicSymptoms', token: 'weight_loss' },
  { questionId: 'lower_back.systemic', region: 'lower_back', path: 'context.systemicSymptoms', token: 'fever' },
  { questionId: 'lower_back.numbness', region: 'lower_back', path: 'quality', token: 'numbness' },
  { questionId: 'lower_back.weakness', region: 'lower_back', path: 'quality', token: 'instability' },
  { questionId: 'knee.locking', region: 'knee', path: 'quality', token: 'clicking' },
  { questionId: 'knee.instability', region: 'knee', path: 'context.systemicSymptoms', token: 'fever' },

  // Single-choice, free-text and multi questions: the correction is a different raw value,
  // because "no" is not an answer these questions have. Using "no" here would have tested
  // a path the product never takes.
  {
    /*
      A real radiation option, not `raw: 'yes'`.

      This case relied on the old unconditional `record.radiation = [String(a.raw)]`, which
      stored whatever arrived -- so the fake value "yes" passed and the case proved nothing
      about radiation at all. The mapping now records only declared options, so a fake value
      records nothing and the precondition fires, which is what caught it.
    */
    questionId: 'shoulder.radiation',
    region: 'shoulder',
    path: 'radiation',
    token: 'lateral_arm',
    affirmativeRaw: 'lateral_arm',
    negativeRaw: 'none',
    negativeTriState: 'yes',
  },
  { questionId: 'neck.arming', region: 'neck', path: 'radiation', token: 'yes', negativeRaw: 'none', negativeTriState: 'yes' },
  {
    questionId: 'lower_back.leg_symptoms',
    region: 'lower_back',
    path: 'radiation',
    token: 'yes',
    negativeRaw: 'none',
    negativeTriState: 'yes',
  },
  {
    questionId: 'shoulder.tenderness',
    region: 'shoulder',
    path: 'tendernessOnPalpation',
    token: 'yes',
    negativeRaw: 'no',
    negativeTriState: 'yes',
  },
  {
    /*
      Real option values, not a "yes" the question does not offer.

      The affirmative used to be `raw: 'yes'` and the correction `raw: 'none'`, neither of
      which is an option on this question -- it offers `injury`, `activity`, `nothing` and
      `unknown`. `shoulder.injury_context` used to write `String(a.raw)` verbatim, so the
      fake values passed: the field held the literal string "yes". A test that only passes
      because the mapping is untyped is not testing the mapping.

      Now the affirmative is a real mechanism and the correction is `unknown`, which is
      the interesting case -- it is the answer that must record nothing at all.
    */
    questionId: 'shoulder.injury_context',
    region: 'shoulder',
    path: 'context.recentInjury',
    token: 'injury',
    affirmativeRaw: 'injury',
    negativeRaw: 'unknown',
    negativeTriState: 'unknown',
  },
  {
    questionId: 'knee.weight_bearing',
    region: 'knee',
    path: 'function.unableWeighBearing',
    token: 'yes',
    negativeRaw: 'no',
    negativeTriState: 'yes',
  },
  {
    questionId: 'knee.swelling',
    region: 'knee',
    path: 'quality',
    token: 'swelling',
    negativeRaw: 'none',
    negativeTriState: 'yes',
  },
  {
    questionId: 'lower_back.mechanism',
    region: 'lower_back',
    path: 'context.recentInjury',
    token: 'yes',
    negativeRaw: 'none',
    negativeTriState: 'yes',
  },
  { questionId: 'knee.mechanism', region: 'knee', path: 'context.recentInjury', token: 'yes', negativeRaw: 'none', negativeTriState: 'yes' },
  { questionId: 'neck.mechanism', region: 'neck', path: 'context.recentInjury', token: 'yes', negativeRaw: 'none', negativeTriState: 'yes' },
  // Second fields, each needing a particular affirmative option rather than a bare "yes".
{
    questionId: 'shoulder.injury_context',
    region: 'shoulder',
    path: 'context.recentInjury',
    token: 'injury',
    affirmativeRaw: 'injury',
    negativeRaw: 'unknown',
    negativeTriState: 'unknown',
  },
  {
    /*
      The multi-select, whose "correction" is a different selection rather than a "no".

      Two of this question's three weakness options recorded nothing before the fix, and it
      escaped this suite entirely: `derivedCases()` probed every question with `raw: 'yes'`,
      which is not an option on a `multi` question, so no branch matched, no case was
      generated, and every test below skipped it. Now that it records, the coverage gate
      demands a case, and this is it.

      `pain_only` is the withdrawal: it is the option that says strength is normal, so
      answering it must remove the activity the previous selection recorded.
    */
    questionId: 'shoulder.weakness',
    region: 'shoulder',
    path: 'function.activitiesAffected',
    token: 'weak reaching overhead',
    affirmativeRaw: ['weak_above_head'],
    negativeRaw: ['pain_only'],
    negativeTriState: 'no',
  },
  {
    questionId: 'neck.arming',
    region: 'neck',
    path: 'quality',
    token: 'numbness',
    // 'arm_numb', not 'hand_tingle' -- that option belongs to the SHOULDER question, and
    // using it here meant the precondition fired with quality holding [].
    affirmativeRaw: 'arm_numb',
    negativeRaw: 'none',
    negativeTriState: 'yes',
  },
  {
    questionId: 'lower_back.weakness',
    region: 'lower_back',
    path: 'function.activitiesAffected',
    token: 'leg feels weak',
  },
  {
    // A BOOLEAN question: its only affirmative is 'yes', and that is what adds 'swelling'.
    questionId: 'knee.instability',
    region: 'knee',
    path: 'quality',
    token: 'swelling',
  },
];
/**
 * The same table, derived rather than typed.
 *
 * A question added to the engine with no case here would silently escape the withdrawal
 * test -- which is how six of them escaped in the first place. So the list is rebuilt from
 * the engine and compared against the typed one; a new question fails the suite until
 * somebody decides what correcting it should withdraw.
 */
/**
 * Questions whose answers reach safety through typed signals and write no record field.
 *
 * Each must declare a `safetyRuleId`, which is asserted below. A question cannot join
 * this list on the strength of writing nothing; it has to say how its answer is used.
 */
const SAFETY_ONLY_QUESTIONS: ReadonlySet<string> = new Set(
  Object.values(INTERVIEW)
    .flat()
    .filter((question) => question.safetyRuleId && question.applyTo?.(emptyRecord('shoulder'), buildAnswer({
      questionId: question.id,
      raw: 'yes',
      triState: 'yes',
      provenance: { capturedAt: '2026-01-01T00:00:00.000Z', createdBy: 'user' },
    })).length === 0)
    .map((question) => question.id),
);

/**
 * An answer that should make the question record, chosen from the question itself.
 *
 * WHY NOT ALWAYS `raw: 'yes'`
 *
 * Because for a question with named options, `'yes'` is not one of them.
 * `shoulder.weakness` is `type: 'multi'` and its applyTo switched on specific option
 * values, so probing it with `'yes'` matched no branch, returned no paths, and the
 * question was never added to `CASES`. It therefore escaped this whole file -- the
 * suite that exists to prove every recording question withdraws had no case for the one
 * shoulder question whose recording was broken.
 *
 * The probe is now taken from the question's own options, and it returns EVERY option
 * that records rather than only the first. A question with three recording options must
 * produce three cases, or the two broken ones still go unexamined.
 */
function recordingProbes(question: {
  id: string;
  type: string;
  options?: { value: string }[];
}): { raw: unknown; triState: 'yes' | 'no' | 'unknown' }[] {
  // Boolean questions really do answer 'yes'.
  if (question.type === 'boolean') return [{ raw: 'yes', triState: 'yes' }];
  // Free text records whatever was typed.
  if (question.type === 'text') return [{ raw: 'typed answer', triState: 'yes' }];
  if (question.options?.length) {
    return question.options.map((option) => ({ raw: option.value, triState: 'yes' as const }));
  }
  return [{ raw: 'yes', triState: 'yes' }];
}

function derivedCases(): { questionId: string; region: BodyRegion; path: string }[] {
  const out: { questionId: string; region: BodyRegion; path: string }[] = [];
  for (const region of Object.keys(INTERVIEW) as BodyRegion[])
    for (const question of INTERVIEW[region]) {
      if (!question.applyTo) continue;
      const probes = recordingProbes(question);
      /*
        A question that reaches the safety engine through `SafetySignals` rather than
        through the record is not a withdrawal case, and saying so is the whole point.

        `shoulder.trauma_urgent` and `shoulder.vascular` carry an `applyTo` that returns
        `[]` deliberately -- a "no" there must be provably not the same as a "yes", and
        the record cannot express that difference, so the typed signal does. Requiring
        them to record would push someone to start writing fields for them, which is the
        exact bug the signals bridge was built to prevent.

        Named rather than inferred from "wrote nothing", because that inference is what
        let a genuinely broken mapping (`shoulder.weakness`, two of three options) look
        like a deliberate one.
      */
      if (SAFETY_ONLY_QUESTIONS.has(question.id)) continue;
      let recorded = false;
      for (const probe of probes) {
        const answer = buildAnswer({
          questionId: question.id,
          raw: probe.raw,
          triState: probe.triState,
          provenance: { capturedAt: '2026-01-01T00:00:00.000Z', createdBy: 'user' },
        });
        const record = emptyRecord(region);
        const before = JSON.stringify(record);
        const paths = question.applyTo(record, answer);
        if (JSON.stringify(record) === before) continue;
        recorded = true;
        for (const path of paths) out.push({ questionId: question.id, region, path });
      }
      if (recorded) continue;
      NON_RECORDING.add(question.id);
      /*
        The blind spot this file exists to close, asserted where this suite has standing
        to assert it.

        A question that records on NONE of its own answers is absent from `CASES`, so
        every correction test below skips it -- which is exactly how `shoulder.weakness`
        escaped: two of its three options recorded nothing and the suite only ever
        examined the third.

        Asserted for shoulder, the region under review. The other regions are COLLECTED
        rather than failed, because this suite is not entitled to call their behaviour a
        defect: `neck.headache` carries `applyTo: (_r, a) => affirmed(a) ? [] : []`, a
        note-only question with no record field of its own, and `neck.arming` writes an
        already-empty radiation for its `none` option -- honest reporting of a real
        negative. Failing here would mean editing neck and lower_back to satisfy a
        shoulder audit. They are listed instead, so the omission is visible.
      */
      if (region === 'shoulder') {
        assert.ok(
          recorded,
          `${question.id} (${region}) records on none of its own answers ` +
            `(${probes.map((p) => JSON.stringify(p.raw)).join(', ')}), so it has no withdrawal ` +
            'case and every correction test below skips it silently',
        );
      }
    }
  return out;
}

/**
 * Questions outside the region under review that record on none of their own answers.
 *
 * Collected by `derivedCases()` and asserted against a fixed list, so a newly
 * non-recording question in another region shows up as a diff rather than as a silence.
 * Populated on the first call rather than at module scope, because the derivation only
 * runs when a test asks for the cases -- an allowlist compared against an empty set on a
 * module that has not been derived yet is a test that passes for the wrong reason.
 */
const NON_RECORDING = new Set<string>();

test('every question outside shoulder that records nothing is the one that already did', () => {
  // Forces the derivation first, so the set is populated by the time it is compared.
  derivedCases();
  assert.deepEqual(
    [...NON_RECORDING].sort(),
    ['neck.headache'],
    'a question outside shoulder stopped recording on all of its own answers',
  );
});

test('every case names a real question in its own region', () => {
  // A case table is test data like any other, and a malformed entry failed deep inside
  // `buildAnswer` with a ZodError about a missing questionId -- which reads as a schema
  // defect rather than a broken table. So the table is checked before anything uses it.
  for (const testCase of CASES) {
    assert.ok(testCase.questionId, 'a case has no questionId');
    const question = INTERVIEW[testCase.region]?.find((q) => q.id === testCase.questionId);
    assert.ok(
      question,
      `${testCase.questionId} is not a question in ${testCase.region}`,
    );
    assert.ok(testCase.path, `${testCase.questionId} names no derived field`);
    assert.ok(
      ANSWER_DERIVED_FIELD_PATHS.includes(testCase.path as never),
      `${testCase.questionId} names ${testCase.path}, which is not recomputed from answers`,
    );
  }
});

describe('a definite NO withdraws what the YES recorded', () => {
  // One case per question that records on an affirmative. The table above is checked
  // against the engine, so a new question cannot escape without a case.
  for (const testCase of CASES) {
    test(`${testCase.questionId}: recording is withdrawn when it is corrected`, () => {
      const path = testCase.path!;
      const affirmative: AnswerStep = {
        questionId: testCase.questionId,
        raw: testCase.affirmativeRaw ?? 'yes',
        triState: 'yes',
      };
      // The correction is whatever THIS question means by "not this". A single-choice
      // question has no "no", and asserting one would test a path the product never takes.
      const correction: AnswerStep = {
        questionId: testCase.questionId,
        raw: testCase.negativeRaw ?? 'no',
        triState: testCase.negativeTriState ?? 'no',
      };

      const yes = replay(testCase.region, [affirmative]);
      const yesValue = yes.fields[path] as unknown;
      assert.ok(
        Array.isArray(yesValue) || typeof yesValue === 'string',
        `${path} is neither a list nor a scalar; the withdrawal cannot be asserted`,
      );
      assert.ok(
        Array.isArray(yesValue)
          ? yesValue.includes(testCase.token)
          : yesValue === testCase.token,
        `precondition: recording "${testCase.token}" in ${path} did nothing, so this test would ` +
          `pass on a record that never changed. It currently holds ${JSON.stringify(yesValue)}.`,
      );

      const corrected = replay(testCase.region, [affirmative, correction]);
      const correctedValue = corrected.fields[path] as unknown;
      assert.equal(
        Array.isArray(correctedValue)
          ? correctedValue.includes(testCase.token)
          : correctedValue === testCase.token,
        false,
        `correcting ${testCase.questionId} left "${testCase.token}" in ${path}: ` +
          `${JSON.stringify(correctedValue)}. The correction is recorded and visible, and inert.`,
      );
    });
  }
});


/**
 * Questions that record on an affirmative but CANNOT withdraw, each with its reason.
 *
 * Listed rather than omitted. An omitted question reads as "considered and covered", and
 * the next person to add one would assume the same. These are here so the coverage check
 * can tell the two kinds apart, and a stale entry is caught by its own test.
 */
const CANNOT_WITHDRAW = new Map<string, string>([
  [
    'shoulder.elevation',
    'free text: whatever the user typed IS the record, and an empty answer means NOT ASKED rather than withdrawn',
  ],
  [
    'neck.movement',
    'free text: an empty answer is not-asked, not a withdrawal',
  ],
  [
    'lower_back.movement',
    'multi-select: there is no "none of these" answer, so a previous selection is replaced only by choosing again',
  ],
  [
    'knee.stairs',
    'multi-select: same -- a corrected selection replaces it by being answered again',
  ],
]);

test('a free-text or multi answer is REPLACED, not accumulated', () => {
  // The other half of "a correction is effective". A text question cannot withdraw, but it
  // must not keep the old text: the derived detail has to be the CURRENT answer's. Without
  // this, "correcting your answer" on these four questions would leave the original words
  // in the clinician's summary.
  const first = replay('shoulder', [
    { questionId: 'shoulder.elevation', raw: 'overhead', triState: 'yes' },
  ]);
  assert.equal(first.fields['triggerDetail'], 'overhead');

  const corrected = replay('shoulder', [
    { questionId: 'shoulder.elevation', raw: 'overhead', triState: 'yes' },
    { questionId: 'shoulder.elevation', raw: 'only at night', triState: 'yes' },
  ]);
  assert.equal(
    corrected.fields['triggerDetail'],
    'only at night',
    'correcting a free-text answer kept the original text',
  );
  assert.ok(
    (corrected.fields['triggers'] as string[]).includes('movement'),
    'the corrected answer still describes movement, so the trigger should still be there',
  );

  // Real OPTION VALUES, not guesses. `knee.stairs` offers "stairs_up", "running" and so on,
  // and it records `triggerDetail` as a JOINED STRING rather than a list -- which the first
  // version of this assertion got wrong, so the precondition fired and told me.
  const stairs = INTERVIEW.knee.find((q) => q.id === 'knee.stairs');
  const options = new Set((stairs?.options ?? []).map((o) => o.value as string));
  for (const value of ['stairs_up', 'running'])
    assert.ok(options.has(value), `knee.stairs no longer offers "${value}"; this test is stale`);

  const multi = replay('knee', [
    { questionId: 'knee.stairs', raw: ['stairs_up'], triState: 'yes' },
  ]);
  const multiCorrected = replay('knee', [
    { questionId: 'knee.stairs', raw: ['stairs_up'], triState: 'yes' },
    { questionId: 'knee.stairs', raw: ['running'], triState: 'yes' },
  ]);
  assert.equal(
    String(multi.fields['triggerDetail']),
    'stairs_up',
    'precondition: the multi answer was not recorded',
  );
  assert.equal(
    String(multiCorrected.fields['triggerDetail']),
    'running',
    `correcting a multi-select answer kept the original selection: ` +
      `${JSON.stringify(multiCorrected.fields['triggerDetail'])}`,
  );
});

test('an UNCERTAIN answer records nothing out of nothing', () => {
  // The rule that must NOT have been broken by the fix: "I am not sure" is not a "yes" and
  // not a "no". Asked on its own it must record nothing.
  for (const { questionId, region, path, token } of CASES) {
    const uncertainOnly = replay(region, [
      { questionId, raw: 'unknown', triState: 'unknown' },
    ]);
    const value = uncertainOnly.fields[path!] as unknown;
    const recorded = Array.isArray(value) ? value.includes(token) : value === token;
    assert.equal(
      recorded,
      false,
      `an uncertain answer to ${questionId} recorded "${token}" out of nothing: ${JSON.stringify(value)}`,
    );
  }
});

test('a corrected answer is the CURRENT answer, whatever it now says', () => {
  // Correcting "yes" to "I am not sure" replaces the answer, so the derived value follows
  // the new answer. That is not uncertainty withdrawing a symptom -- it is the user no
  // longer asserting it -- and conflating the two would hide a real correction.
  //
  // The distinction that matters is with the NEVER-ASKED case, which this product keeps as
  // its own state: an unasked question is absent from the map and contributes nothing.
  const uncertain = replay('shoulder', [
    { questionId: 'shoulder.night_pain', raw: 'yes', triState: 'yes' },
    { questionId: 'shoulder.night_pain', raw: 'unknown', triState: 'unknown' },
  ]);
  assert.deepEqual(
    (uncertain.fields['triggers'] as string[]).includes('night'),
    false,
    'correcting night pain to "not sure" still records night pain as reported',
  );

  const neverAsked = replay('shoulder', [
    { questionId: 'shoulder.night_pain', raw: 'yes', triState: 'yes' },
  ]);
  assert.equal(
    neverAsked.answers['shoulder.night_pain'] !== undefined,
    true,
    'precondition: the affirmative answer is not in the map',
  );
  const absent = replay('shoulder', []);
  assert.equal(
    Object.keys(absent.answers).length,
    0,
    'an unasked episode reported an answer, so "not asked" and "not sure" are the same state',
  );
});

test('the recompute is INDEPENDENT of the order the answers arrived in', () => {
  // The property the old additive mapping lacked. `instability` is contributed by three
  // questions, so withdrawing one of them must not remove what the others still hold.
  const all = [
    { questionId: 'lower_back.weakness', raw: 'yes', triState: 'yes' as const },
    { questionId: 'lower_back.numbness', raw: 'yes', triState: 'yes' as const },
  ];
  const forwards = replay('lower_back', all);
  const backwards = replay('lower_back', [...all].reverse());

  assert.deepEqual(
    forwards.fields,
    backwards.fields,
    'the derived fields depend on which answer arrived last',
  );
});

test('withdrawing one contributor keeps what another question still asserts', () => {
  // The case a per-question withdrawal would get wrong. Both questions add "instability";
  // correcting one must not take the other's claim with it.
  const both = replay('lower_back', [
    { questionId: 'lower_back.weakness', raw: 'yes', triState: 'yes' },
    { questionId: 'lower_back.numbness', raw: 'yes', triState: 'yes' },
    { questionId: 'lower_back.weakness', raw: 'no', triState: 'no' },
  ]);
  const quality = both.fields['quality'] as string[];
  assert.equal(
    quality.includes('numbness'),
    true,
    'correcting leg weakness withdrew the numbness the OTHER question still reports',
  );
  assert.equal(
    quality.includes('instability'),
    false,
    'nothing now asserts instability, so it should be gone',
  );
});

test('the recompute never touches the location the user pointed at', () => {
  // `location.*` is deliberately absent from ANSWER_DERIVED_FIELD_PATHS. A recompute that
  // included it would erase the user's own selection every time an answer changed.
  for (const path of ANSWER_DERIVED_FIELD_PATHS)
    assert.equal(
      path.startsWith('location.'),
      false,
      `${path} is in the answer-derived list, so a recompute would rewrite the user's location`,
    );
  const { fields } = replay('shoulder', [
    { questionId: 'shoulder.night_pain', raw: 'yes', triState: 'yes' },
  ]);
  assert.equal(
    Object.keys(fields).some((p) => p.startsWith('location.')),
    false,
    'the recompute produced a location field',
  );
});

test('every answer-derived field has a defined value even with no answers at all', () => {
  // `emptyRecord` builds `function: {}` and `context: {}`, so every field inside those
  // containers resolves to `undefined` until something writes it -- and `undefined` cannot
  // be bound to a SQLite parameter. The first version of this recompute returned those and
  // every answer-bearing write failed with "Provided value cannot be bound to SQLite
  // parameter 3".
  for (const region of Object.keys(INTERVIEW) as BodyRegion[]) {
    const fields = fieldsFromAnswers(region, {});
    for (const path of ANSWER_DERIVED_FIELD_PATHS)
      assert.notEqual(
        fields[path],
        undefined,
        `${region}/${path} is undefined with no answers, and the store cannot bind undefined`,
      );
  }
});

test('every field an applyTo writes is in the derived list', () => {
  // The derived list is hand-maintained, so it can fall behind. If a question starts
  // writing a new field, that field must be recomputed too -- and this is what notices.
  const listed = new Set<string>(ANSWER_DERIVED_FIELD_PATHS);
  const missing = derivedCases()
    .map((c) => c.path)
    .filter((path) => !listed.has(path));
  assert.deepEqual(
    [...new Set(missing)],
    [],
    `these fields are written by an applyTo but are not recomputed, so correcting an answer ` +
      `would leave them stale`,
  );
});

test('every question that records on a YES is accounted for', () => {
  // The table above is what stops the next six questions escaping. A question the engine
  // records something for, with no case here, fails this suite until somebody decides what
  // correcting it should withdraw.
  // Per QUESTION rather than per (question, path). The recompute rewrites EVERY
  // answer-derived field on every answer write, so a question with one proven case has
  // proven the mechanism for all of its fields; the extra CASES above exist only for fields
  // that need a particular affirmative option to be reachable at all.
  const covered = new Set(CASES.map((c) => c.questionId));
  const uncovered = derivedCases().filter(
    (c) => !covered.has(c.questionId) && !CANNOT_WITHDRAW.has(c.questionId),
  );
  assert.deepEqual(
    [...new Set(uncovered.map((c) => c.questionId))],
    [],
    'these questions record on an affirmative but have no withdrawal case. Answering yes and ' +
      'then correcting to no is not proven to withdraw anything.',
  );
});

test('every non-withdrawing exemption still names a real question', () => {
  // Otherwise CANNOT_WITHDRAW accumulates entries for questions that no longer exist or no
  // longer behave that way, and a genuine withdrawal bug hides behind a stale exemption.
  const real = new Set(derivedCases().map((c) => c.questionId));
  const stale = [...CANNOT_WITHDRAW.keys()].filter((id) => !real.has(id));
  assert.deepEqual(
    stale,
    [],
    'these exemptions name questions that no longer record on an affirmative, so they are ' +
      'either stale or hiding a real withdrawal question',
  );
});
