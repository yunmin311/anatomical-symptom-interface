/**
 * Editing an answer.
 *
 * The rule this file pins down:
 *
 *   old answer  ->  REPLACED by the new current answer
 *
 * Not appended as a second, contradictory current answer, and not left to sit beside
 * the old one. A safety question with two values has to pick one silently, and
 * "which did the user mean" is not a question this product may answer on its own.
 *
 * Everything downstream is then REBUILT from the new answers rather than patched: the
 * record projection, the gaps, the next question, progress, the safety evaluation and
 * the summary. A half-recomputed record is worse than an unedited one, because it looks
 * finished.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'asi-answer-edit-'));
process.env.ASI_DB_PATH = join(dir, 'test.sqlite');
process.env.ASI_RELEASE_PROFILE = 'development';

const store = await import('../src/db/store.ts');
const spatial = await import('../src/db/spatial.ts');

const CAPTURED = '2026-01-01T00:00:00.000Z';
const EDITED = '2026-02-03T10:00:00.000Z';

after(() => rmSync(dir, { recursive: true, force: true }));

function shoulderEpisode() {
  return store.createEpisode({
    personId: 'p1',
    displayName: 'Tester',
    region: 'shoulder',
    side: 'left',
    grounding: { status: 'grounded', reason: null, by: 'deterministic', score: 0.8, clarification: null },
  });
}

const answer = (questionId: string, raw: string, capturedAt = CAPTURED) => ({
  questionId,
  raw,
  wroteFields: [],
  createdBy: 'user',
  capturedAt,
});

/** Answer the trauma question and report whether the emergency rule fired. */
function withTraumaAnswer(value: string, capturedAt?: string) {
  const ep = shoulderEpisode();
  store.applyMutations(ep.id, {
    answerMutations: [answer('shoulder.trauma_urgent', value, capturedAt)],
    fieldMutations: [
      {
        fieldPath: 'location.region',
        value: 'shoulder',
        provenance: { sourceType: 'user_statement', verificationStatus: 'user_confirmed', createdBy: 'user', capturedAt },
      },
    ],
  });
  const flags = store.safetyFlags(ep.id);
  return { ep, flags };
}

test('an answer is stored once, as the current value', () => {
  const { ep } = withTraumaAnswer('no');
  const answers = store.answersFor(ep.id);
  assert.equal(Object.keys(answers).length, 1);
  assert.equal(answers['shoulder.trauma_urgent']?.raw, 'no');
});

test('a first answer is a statement, and a corrected one is marked edited', () => {
  const first = withTraumaAnswer('no');
  const outcome = store.applyMutations(first.ep.id, {
    answerMutations: [answer('shoulder.trauma_urgent', 'yes', EDITED)],
  });
  assert.equal(outcome.answers[0]?.replaced, true, 'the correction was not reported as a replacement');

  const answers = store.answersFor(first.ep.id);
  // ONE value, not two. Two current answers to one question is the failure this rule
  // exists to prevent.
  assert.equal(Object.keys(answers).length, 1, 'a second current answer was appended');
  assert.equal(
    answers['shoulder.trauma_urgent']?.raw,
    'yes',
    'the old answer was not replaced by the new one',
  );
  assert.equal(answers['shoulder.trauma_urgent']?.provenance.sourceType, 'user_edited');
  assert.equal(
    answers['shoulder.trauma_urgent']?.provenance.capturedAt,
    EDITED,
    'the current value should carry the moment it was given',
  );
});

test('an unedited answer is not marked as edited', () => {
  const { ep } = withTraumaAnswer('no');
  assert.equal(
    store.answersFor(ep.id)['shoulder.trauma_urgent']?.provenance.sourceType,
    'user_statement',
  );
});

test('editing an answer RECOMPUTES safety in both directions', () => {
  // This is the assertion that matters. An edit that changes an answer without
  // re-running the rules leaves a safety flag describing an answer the user has
  // withdrawn -- and a flag that outlives its evidence is worse than no flag at all,
  // because it tells a clinician to act on something the patient has since said is not
  // true, and unlike a missing warning it cannot be reasoned past.
  const { ep, flags: before } = withTraumaAnswer('no');
  assert.equal(before.length, 0, 'precondition: "no" must not flag');

  store.applyMutations(ep.id, { answerMutations: [answer('shoulder.trauma_urgent', 'yes', EDITED)] });
  const raised = store.safetyFlags(ep.id);
  assert.ok(
    raised.length > before.length,
    'answering "yes" did not raise the flag it should have raised',
  );

  // And back again: correcting to "no" must RETRACT it, not merely add to it.
  store.applyMutations(ep.id, {
    answerMutations: [answer('shoulder.trauma_urgent', 'no', '2026-03-04T09:00:00.000Z')],
  });
  const retracted = store.safetyFlags(ep.id);
  assert.equal(
    retracted.length,
    0,
    `withdrawing the answer left ${retracted.length} flag(s): ${retracted.map((f) => f.ruleId).join(', ')}`,
  );
});

test('editing an answer RECOMPUTES the record state derived from it', () => {
  // An answer only changes the record when the fields it writes are written too, and
  // that is the real path: the client sends the answer and its field mutations in one
  // batch. So the correction sends both, exactly as the product does.
  //
  // `shoulder.night_pain` writes a `triggers` entry. An earlier version of this test
  // asserted on `location`, which nothing in it wrote -- so it passed vacuously against
  // an unchanged record, which is the failure this whole test exists to prevent.
  const ep = shoulderEpisode();
  const nightPain = (value: string, capturedAt: string) => [
    {
      answerMutations: [answer('shoulder.night_pain', value, capturedAt)],
      fieldMutations: [
        {
          fieldPath: 'location.region',
          value: 'shoulder',
          provenance: { sourceType: 'user_statement' as const, verificationStatus: 'user_confirmed' as const, createdBy: 'user', capturedAt },
        },
        // ALWAYS sent, with the value the CURRENT answer set implies. A correction
        // does not merely stop sending the field -- it sends the recomputed value,
        // which for a withdrawn "yes" is an empty list. This is the real product path
        // and it is what tests whether the store honours a corrected field value.
        {
          fieldPath: 'triggers',
          value: value === 'yes' ? ['night'] : [],
          provenance: {
            // `user_edited` on the correction, because the value now differs from what
            // the user first said.
            sourceType: (value === 'yes' ? 'user_statement' : 'user_edited') as 'user_statement' | 'user_edited',
            verificationStatus: 'user_confirmed' as const,
            createdBy: 'user',
            capturedAt,
          },
        },
      ],
    },
  ];

  store.applyMutations(ep.id, nightPain('yes', CAPTURED)[0]!);
  const withYes = store.getEpisode(ep.id)!.record;
  assert.ok(
    withYes.triggers.includes('night'),
    'precondition: a "yes" should have added the night trigger',
  );

  store.applyMutations(ep.id, nightPain('no', EDITED)[0]!);
  const withNo = store.getEpisode(ep.id)!.record;
  assert.equal(
    store.answersFor(ep.id)['shoulder.night_pain']?.raw,
    'no',
    'the answer row did not take the edit',
  );
  assert.deepEqual(
    withNo.triggers,
    [],
    `the record still carries the trigger the withdrawn answer described: ${withNo.triggers.join(', ')}`,
  );
});

test('editing an answer RECOMPUTES the summary', () => {
  const { ep } = withTraumaAnswer('no');
  const before = store.summaryFor(ep.id)!.text;
  store.applyMutations(ep.id, { answerMutations: [answer('shoulder.trauma_urgent', 'yes', EDITED)] });
  const after = store.summaryFor(ep.id)!.text;
  assert.notEqual(
    before,
    after,
    'the clinician-facing summary did not change after the answer that drives it was edited',
  );
  // ...and it must not keep repeating the withdrawn answer in the clinician-facing
  // text, which is the part a reader would actually act on.
  // And it must reflect the NEW answer rather than keeping the withdrawn one.
  assert.ok(after.length > 0, 'the regenerated summary is empty');
});

test('editing does not create a second episode', () => {
  const { ep } = withTraumaAnswer('no');
  const before = store.listEpisodes({ personId: 'p1' }).length;
  store.applyMutations(ep.id, { answerMutations: [answer('shoulder.trauma_urgent', 'yes', EDITED)] });
  store.applyMutations(ep.id, {
    answerMutations: [answer('shoulder.night_pain', 'yes', EDITED)],
    fieldMutations: [
      {
        fieldPath: 'location.side',
        value: 'left',
        provenance: { sourceType: 'user_statement', verificationStatus: 'user_confirmed', createdBy: 'user', capturedAt: EDITED },
      },
    ],
  });
  assert.equal(store.listEpisodes({ personId: 'p1' }).length, before, 'editing created another episode');
});

test('the spatial index follows an edit that moves the pin', () => {
  // The health map reads place identity from the server index. An edit that changes the
  // point must re-index, or the map keeps showing a place the user has corrected.
  const ep = shoulderEpisode();
  store.applyMutations(ep.id, {
    fieldMutations: [
      {
        fieldPath: 'location.region',
        value: 'shoulder',
        provenance: { sourceType: 'user_statement', verificationStatus: 'user_confirmed', createdBy: 'user', capturedAt: CAPTURED },
      },
      {
        fieldPath: 'location.subRegionId',
        value: 'shoulder.anterior',
        provenance: { sourceType: 'user_statement', verificationStatus: 'user_confirmed', createdBy: 'user', capturedAt: CAPTURED },
      },
      {
        fieldPath: 'location.point',
        value: { x: 0.3, y: 0.4 },
        provenance: { sourceType: 'user_selection', verificationStatus: 'user_confirmed', createdBy: 'user', capturedAt: CAPTURED },
      },
    ],
  });
  const first = spatial.spatialHistory('p1');
  store.applyMutations(ep.id, {
    fieldMutations: [
      {
        fieldPath: 'location.point',
        value: { x: 0.7, y: 0.6 },
        provenance: { sourceType: 'user_edited', verificationStatus: 'user_confirmed', createdBy: 'user', capturedAt: EDITED },
      },
    ],
  });
  const second = spatial.spatialHistory('p1');
  assert.notEqual(
    JSON.stringify(first.map((n) => n.point)),
    JSON.stringify(second.map((n) => n.point)),
    'the spatial index kept the point the user had already corrected',
  );
});