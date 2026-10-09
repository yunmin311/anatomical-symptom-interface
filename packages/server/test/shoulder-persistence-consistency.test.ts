/**
 * Answer → Record → Persistence → Summary, for the right shoulder.
 *
 * ## Why this is not the same question as shoulder-interview-semantics.test.ts
 *
 * That file asks "what does this answer record", and it proves it by calling the engine
 * on a scratch record. That is necessary and it is not sufficient.
 *
 * The browser and the server compute the record by DIFFERENT means:
 *
 *   browser   `recordAnswer()` calls `applyAnswer()` on the live record, once per answer.
 *             Each answer only knows what IT wrote, so a correction can only withdraw what
 *             the same question wrote.
 *   server    `answerDerivedMutations()` calls `fieldsFromAnswers()`, which replays the
 *             WHOLE answer set into an empty record and takes the result.
 *
 * Those agree only if every withdrawal is expressible within one question. When they do
 * not, the browser shows one thing and the stored record says another -- and the stored
 * record is the one a clinician reads.
 *
 * So every case here goes through the real persistence path: create an episode, apply
 * answer mutations, read the record back, REOPEN it, and read the summary. A green scratch
 * record proves the mapping is right, not that the product is.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'asi-shoulder-persist-'));
process.env.ASI_DB_PATH = join(dir, 'test.sqlite');
process.env.ASI_RELEASE_PROFILE = 'development';

const store = await import('../src/db/store.ts');
const { db } = await import('../src/db/client.ts');
const { episodeForReopen } = await import('../src/db/episode-lifecycle.ts');
const { recordAnswer, selectStructure } = await import('../../../apps/web/src/state/logic.ts');
const { emptyRecord, fieldsFromAnswers, mutationsForAnswer, NOT_ASKED_LABEL, UNKNOWN_LABEL } = await import('@asi/shared');

const CAPTURED = '2026-01-01T00:00:00.000Z';

after(() => {
  // Windows cannot remove a SQLite file while the process still has it open.
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const answer = (questionId: string, raw: unknown, capturedAt = CAPTURED) => ({
  questionId,
  raw,
  wroteFields: [],
  createdBy: 'user',
  capturedAt,
});

import type { PreVisitSummary } from '@asi/shared';

/** Read the summary through the same route behaviour the product uses. */
function summarized(id: string): { summary: PreVisitSummary; text: string } {
  const result = store.summaryFor(id);
  assert.ok(result, 'the summary was not produced');
  return result;
}

function newEpisode() {
  return store.createEpisode({
    personId: 'p1',
    displayName: 'Tester',
    region: 'shoulder',
    side: 'right',
    grounding: { status: 'grounded', reason: null, by: 'deterministic', score: 0.8, clarification: null },
  });
}

/** The answer-derived fields, as the STORE holds them after the write. */
const stored = (id: string) => {
  const episode = store.getEpisode(id);
  assert.ok(episode, 'the episode was not persisted');
  const r = episode.record;
  return {
    mechanism: r.context.recentInjury,
    radiation: r.radiation,
    quality: r.quality,
    triggers: r.triggers,
    activities: r.function.activitiesAffected,
  };
};

/**
 * Answer a sequence through the browser's own state function, then push the SAME answers
 * at the server exactly as the app does.
 *
 * Both halves matter. Running only the browser half would let a divergence between
 * `applyAnswer` and `fieldsFromAnswers` pass unnoticed; running only the server half would
 * miss the fact that the screen the patient is looking at disagrees.
 */
function journey(steps: { questionId: string; raw: unknown }[]) {
  const ep = newEpisode();
  let clientRecord = emptyRecord('shoulder');
  let clientAnswers = {} as Record<string, never>;
  let lastWroteFields: string[] = [];

  for (const step of steps) {
    const result = recordAnswer(clientRecord, clientAnswers, step.questionId, step.raw);
    clientRecord = result.record;
    clientAnswers = result.answers as Record<string, never>;
    lastWroteFields = result.wroteFields;
    /*
      Send both halves exactly as the app does. The browser does not send answers alone:
      it also sends the field mutations implied by the record it just updated. Omitting them
      would let the server's independent recompute conceal a client record that had already
      diverged -- which was the original failure.
    */
    store.applyMutations(ep.id, {
      answerMutations: [{ ...answer(step.questionId, step.raw), wroteFields: result.wroteFields }],
      fieldMutations: mutationsForAnswer(result.record, result.answer, result.wroteFields),
    });
  }

  const reopen = episodeForReopen(ep.id, 'development');
  assert.ok(reopen, 'the episode could not be reopened');
  return {
    id: ep.id,
    client: {
      mechanism: clientRecord.context.recentInjury,
      radiation: clientRecord.radiation,
      quality: clientRecord.quality,
      triggers: clientRecord.triggers,
      activities: clientRecord.function.activitiesAffected,
    },
    server: stored(ep.id),
    reopen,
    wroteFields: lastWroteFields,
  };
}

/* ------------------------------------------------------------------ */

describe('the browser and the store agree, and the reopened episode agrees with both', () => {
  test('injury corrected to "I am not sure" leaves nothing recorded', () => {
    const j = journey([
      { questionId: 'shoulder.injury_context', raw: 'injury' },
      { questionId: 'shoulder.injury_context', raw: 'unknown' },
    ]);
    assert.deepEqual(j.server.mechanism, null, 'the store still holds a mechanism');
    assert.deepEqual(
      j.client.mechanism,
      j.server.mechanism,
      `the screen says ${JSON.stringify(j.client.mechanism)} and the store says ${JSON.stringify(j.server.mechanism)}`,
    );
    assert.deepEqual(j.reopen.episode.record.context.recentInjury, null, 'reopen resurrected the mechanism');
  });

  test('radiation corrected to unsure leaves no radiation and no numbness', () => {
    const j = journey([
      { questionId: 'shoulder.radiation', raw: 'hand_tingle' },
      { questionId: 'shoulder.radiation', raw: 'unsure' },
    ]);
    assert.deepEqual(j.server.radiation, [], 'the store still holds a radiation');
    assert.deepEqual(j.server.quality, [], 'the store still holds the numbness');
    assert.deepEqual(j.client.radiation, j.server.radiation, 'screen and store disagree on radiation');
    assert.deepEqual(j.client.quality, j.server.quality, 'screen and store disagree on quality');
    assert.deepEqual(j.reopen.episode.record.radiation, [], 'reopen resurrected the radiation');
    assert.deepEqual(j.reopen.episode.record.quality, [], 'reopen resurrected the numbness');
  });

  test('radiation corrected to none withdraws numbness but keeps the explicit negative', () => {
    const j = journey([
      { questionId: 'shoulder.radiation', raw: 'hand_tingle' },
      { questionId: 'shoulder.radiation', raw: 'none' },
    ]);
    assert.deepEqual(j.server.radiation, [], 'a real negative must record as empty');
    assert.deepEqual(j.server.quality, [], 'the numbness survived being withdrawn');
    assert.deepEqual(j.client.quality, j.server.quality, 'screen and store disagree on quality');
  });

  test('radiation corrected to another option replaces the radiation and drops numbness', () => {
    const j = journey([
      { questionId: 'shoulder.radiation', raw: 'hand_tingle' },
      { questionId: 'shoulder.radiation', raw: 'lateral_arm' },
    ]);
    assert.deepEqual(j.server.radiation, ['lateral_arm']);
    assert.deepEqual(j.server.quality, [], 'numbness survived moving to a different radiation');
    assert.deepEqual(j.client.radiation, j.server.radiation, 'screen and store disagree on radiation');
    assert.deepEqual(j.client.quality, j.server.quality, 'screen and store disagree on quality');
  });

  test('a correction never touches the pointed-to location', () => {
    const located = selectStructure(emptyRecord('shoulder'), 'asi:shoulder.biceps-long-head-tendon');
    const before = structuredClone(located.location);
    const first = recordAnswer(located, {}, 'shoulder.radiation', 'hand_tingle');
    const second = recordAnswer(first.record, first.answers, 'shoulder.radiation', 'none');
    assert.deepEqual(second.record.location, before, 'reconciling answers rewrote the user-pointed location');
    assert.deepEqual([...second.wroteFields].sort(), ['quality', 'radiation']);
  });

  test('weakness A -> B -> pain_only ends empty, everywhere', () => {
    const j = journey([
      { questionId: 'shoulder.weakness', raw: ['weak_above_head'] },
      { questionId: 'shoulder.weakness', raw: ['weak_external_rotation'] },
      { questionId: 'shoulder.weakness', raw: ['pain_only'] },
    ]);
    assert.deepEqual(j.server.activities, [], 'the store still holds a weakness');
    assert.deepEqual(j.client.activities, j.server.activities, 'screen and store disagree');
    assert.deepEqual(j.reopen.episode.record.function.activitiesAffected, [], 'reopen resurrected it');
  });

  test('weakness A -> B replaces rather than accumulating, everywhere', () => {
    const j = journey([
      { questionId: 'shoulder.weakness', raw: ['weak_above_head'] },
      { questionId: 'shoulder.weakness', raw: ['weak_external_rotation'] },
    ]);
    assert.deepEqual(j.server.activities, ['weak turning out to the side']);
    assert.deepEqual(j.client.activities, j.server.activities);
  });
});

describe('an explicit negative is not the same as never asked', () => {
  test('radiation "none" is recorded as an answer, so coverage says it was asked', () => {
    const j = journey([
      { questionId: 'shoulder.radiation', raw: 'hand_tingle' },
      { questionId: 'shoulder.radiation', raw: 'none' },
    ]);
    const coverage = store.coverageFor(j.id);
    assert.equal(
      coverage['radiation'],
      true,
      'coverage says radiation was never asked, so "no radiation" is indistinguishable from silence',
    );
  });

  test('and the summary says so in words, values, and fields rather than "not asked"', () => {
    const j = journey([
      { questionId: 'shoulder.radiation', raw: 'hand_tingle' },
      { questionId: 'shoulder.radiation', raw: 'none' },
    ]);
    const { summary, text } = summarized(j.id);
    const radiation = summary.history.find((h) => h.label === 'Radiation');
    assert.ok(radiation, 'the summary has no Radiation row at all');
    assert.equal(radiation.value, 'none', 'an explicit denial is not worded as an explicit denial');
    assert.deepEqual(
      (summary.structured as { radiation: unknown }).radiation,
      [],
      'an explicit denial is missing from the machine-readable summary',
    );
    assert.ok(!summary.outstandingFields.includes('radiation'), 'an explicit denial is still outstanding');
    assert.match(text, /Radiation: none/, 'the copied summary does not carry the explicit denial');
    assert.ok(
      !j.reopen.progress.outstanding.includes('shoulder.radiation'),
      'an explicit denial is reported as outstanding',
    );
  });

  test('an unasked radiation is still reported as not asked', () => {
    // The other half, and the one that must not change: fixing the negative must not turn
    // silence into a reported negative for everybody.
    const j = journey([{ questionId: 'shoulder.weakness', raw: ['pain_only'] }]);
    const coverage = store.coverageFor(j.id);
    const { summary, text } = summarized(j.id);
    const radiation = summary.history.find((h) => h.label === 'Radiation');
    assert.equal(coverage['radiation'], false, 'silence is covered as though it had been asked');
    assert.equal(radiation?.value, NOT_ASKED_LABEL, 'silence is being reported as an answer');
    assert.deepEqual(
      (summary.structured as { radiation: unknown }).radiation,
      null,
      'silence is serialised as a radiation finding',
    );
    assert.ok(summary.outstandingFields.includes('radiation'), 'silence is missing from outstanding fields');
    assert.match(text, new RegExp(`Radiation: ${NOT_ASKED_LABEL}`), 'the copied summary invents a radiation answer');
  });

  test('an unsure answer is not reported as a recorded negative', () => {
    // `unsure` is not a "no". It must read as open, not as reassurance.
    const j = journey([
      { questionId: 'shoulder.radiation', raw: 'hand_tingle' },
      { questionId: 'shoulder.radiation', raw: 'unsure' },
    ]);
    const coverage = store.coverageFor(j.id);
    const { summary, text } = summarized(j.id);
    const radiation = summary.history.find((h) => h.label === 'Radiation');
    assert.notEqual(
      radiation?.value,
      'none',
      'an unsure answer is being summarised as an explicit negative',
    );
    assert.equal(coverage['radiation'], false, 'uncertainty marks the field as though it were resolved');
    assert.equal(radiation?.value, UNKNOWN_LABEL, 'uncertainty is not reported as open');
    assert.deepEqual(
      (summary.structured as { radiation: unknown }).radiation,
      null,
      'uncertainty is serialised as a radiation finding',
    );
    assert.ok(summary.outstandingFields.includes('radiation'), 'uncertainty is missing from outstanding fields');
    assert.match(text, new RegExp(`Radiation: ${UNKNOWN_LABEL}`), 'the copied summary hides the open question');
    assert.ok(
      j.reopen.progress.outstanding.includes('shoulder.radiation'),
      'uncertainty is reported as resolved',
    );
  });
});

describe('coverage follows recorded facts, not question metadata', () => {
  test('a vascular denial does not establish systemic symptoms', () => {
    // The vascular question declares `context.systemicSymptoms` as its field, but its
    // mapping deliberately writes nothing. Coverage must follow the mapping, not the label.
    const j = journey([{ questionId: 'shoulder.vascular', raw: 'no' }]);
    const coverage = store.coverageFor(j.id);
    const { summary, text } = summarized(j.id);
    const systemic = summary.history.find((h) => h.label === 'Systemic symptoms');
    assert.equal(
      coverage['context.systemicSymptoms'],
      false,
      'an unrelated safety answer marked systemic symptoms as asked',
    );
    assert.equal(
      Object.hasOwn(store.fieldStoreFor(j.id), 'context.systemicSymptoms'),
      false,
      'an unrelated safety answer created a systemic-symptom value row',
    );
    assert.equal(systemic?.value, NOT_ASKED_LABEL, 'silence about systemic symptoms became a negative');
    assert.match(text, /Systemic symptoms: not asked/, 'the copied summary reports an unasked negative');
  });

  test('a trauma denial does not establish a mechanism', () => {
    // The trauma question also declares `context.recentInjury` while writing nothing. Its
    // denial is a safety answer, not an onset history.
    const j = journey([{ questionId: 'shoulder.trauma_urgent', raw: 'no' }]);
    const coverage = store.coverageFor(j.id);
    const { summary } = summarized(j.id);
    assert.equal(
      coverage['context.recentInjury'],
      false,
      'a trauma denial marked the mechanism as asked',
    );
    assert.equal(
      Object.hasOwn(store.fieldStoreFor(j.id), 'context.recentInjury'),
      false,
      'a trauma denial created a mechanism value row',
    );
    assert.equal(
      summary.history.some((h) => h.label === 'Recent injury or mechanism'),
      false,
      'an unasked mechanism appeared in the summary',
    );
  });

  test('an uncertain answer does not hide another answer’s established fact', () => {
    // `night_pain` declares `quality` but writes `triggers`; radiation writes `quality`.
    // Coverage must keep the numbness that radiation actually recorded, even though night
    // pain is unresolved.
    const j = journey([
      { questionId: 'shoulder.night_pain', raw: 'unknown' },
      { questionId: 'shoulder.radiation', raw: 'hand_tingle' },
    ]);
    const coverage = store.coverageFor(j.id);
    const { summary } = summarized(j.id);
    const quality = summary.history.find((h) => h.label === 'Quality');
    assert.equal(coverage['quality'], true, 'an unresolved answer hid an established fact');
    assert.ok(
      quality && quality.value !== NOT_ASKED_LABEL,
      'an established symptom is reported as never asked',
    );
    assert.ok(!summary.outstandingFields.includes('quality'), 'an established fact is still outstanding');
    assert.ok(
      j.reopen.progress.outstanding.includes('shoulder.night_pain'),
      'the genuinely uncertain question stopped being outstanding',
    );
    assert.ok(
      !j.reopen.progress.outstanding.includes('shoulder.radiation'),
      'the definite answer is reported as outstanding',
    );
  });
});

describe('a definite movement description is recorded, covered, and summarised', () => {
  test('non-empty elevation text leaves outstanding, enters coverage, and reaches the summary', () => {
    const j = journey([{ questionId: 'shoulder.elevation', raw: 'reaching overhead' }]);
    const coverage = store.coverageFor(j.id);
    const { summary, text } = summarized(j.id);
    const detail = summary.history.find((h) => h.label === 'Trigger detail');
    assert.equal(coverage['triggerDetail'], true, 'a definite description did not mark its field asked');
    assert.equal(detail?.value, 'reaching overhead', 'the recorded description did not reach the summary');
    assert.match(text, /Trigger detail: reaching overhead/, 'the copied summary lost the recorded description');
    assert.ok(
      !j.reopen.progress.outstanding.includes('shoulder.elevation'),
      'a definite description is reported as outstanding',
    );
  });

  test('blank elevation text establishes no fact and stays outstanding', () => {
    // Blankness is the absence of an answer, not a finding that no movement provokes pain.
    const j = journey([{ questionId: 'shoulder.elevation', raw: '   ' }]);
    const coverage = store.coverageFor(j.id);
    const { summary } = summarized(j.id);
    assert.equal(
      Object.hasOwn(store.fieldStoreFor(j.id), 'triggerDetail'),
      false,
      'blank text created a trigger-detail value row',
    );
    assert.equal(coverage['triggerDetail'], false, 'blank text marked its field asked');
    assert.equal(
      summary.history.some((h) => h.label === 'Trigger detail'),
      false,
      'blank text appeared in the summary',
    );
    assert.ok(
      j.reopen.progress.outstanding.includes('shoulder.elevation'),
      'blank text is being treated as a resolved answer',
    );
  });

  test('explicit elevation uncertainty stays outstanding without inventing a movement', () => {
    const j = journey([{ questionId: 'shoulder.elevation', raw: "I don't know" }]);
    const coverage = store.coverageFor(j.id);
    const { summary } = summarized(j.id);
    assert.equal(coverage['triggerDetail'], false, 'uncertainty marked its field asked');
    assert.equal(
      summary.history.some((h) => h.label === 'Trigger detail'),
      false,
      'uncertainty invented a movement description',
    );
    assert.ok(
      j.reopen.progress.outstanding.includes('shoulder.elevation'),
      'explicit uncertainty stopped being outstanding',
    );
  });
});

describe('a single-choice answer is not silently treated as "I do not know"', () => {
  test('a definite option is not counted as still outstanding', () => {
    // `normaliseYesNo` has no yes/no token for 'lateral_arm', so it returns 'unknown' for
    // every option value on a non-boolean question. `questionProgress.outstanding` counts
    // an 'unknown' answer as open, so after answering every shoulder question with a
    // definite choice the panel still says nothing was answered.
    const j = journey([
      { questionId: 'shoulder.injury_context', raw: 'nothing' },
      { questionId: 'shoulder.night_pain', raw: 'yes' },
      { questionId: 'shoulder.elevation', raw: 'reaching up' },
      { questionId: 'shoulder.weakness', raw: ['pain_only'] },
      { questionId: 'shoulder.radiation', raw: 'none' },
      { questionId: 'shoulder.tenderness', raw: 'mild' },
      { questionId: 'shoulder.trauma_urgent', raw: 'no' },
      { questionId: 'shoulder.vascular', raw: 'no' },
    ]);
    const outstanding = j.reopen.progress.outstanding;
    for (const id of [
      'shoulder.injury_context',
      'shoulder.weakness',
      'shoulder.radiation',
      'shoulder.tenderness',
    ]) {
      assert.ok(
        !outstanding.includes(id),
        `${id} was answered with a definite option and is still reported as outstanding: ${outstanding.join(', ')}`,
      );
    }
  });

  test('a boolean "I am not sure" is STILL outstanding', () => {
    // The compatibility half. A real uncertainty must keep being counted as open, or the
    // product starts telling people their own uncertainty is settled.
    const j = journey([{ questionId: 'shoulder.night_pain', raw: 'unknown' }]);
    assert.ok(
      j.reopen.progress.outstanding.includes('shoulder.night_pain'),
      'a genuine "I am not sure" stopped being outstanding',
    );
  });

  test('definite single-choice answers do not rewrite safety input', () => {
    // Every definite single/multi option normalises to triState `unknown`. That must remain
    // a compatibility artifact: Boolean safety questions are the only signal drivers here,
    // and no selection above can turn an absent safety answer into an indeterminate one.
    const j = journey([
      { questionId: 'shoulder.injury_context', raw: 'nothing' },
      { questionId: 'shoulder.radiation', raw: 'none' },
    ]);
    const evaluation = store.safetyFor(j.id, 'development');
    assert.ok(evaluation, 'safety was not evaluated');
    assert.equal(evaluation.signals.trauma_with_loss_of_movement, 'not_asked');
    assert.equal(evaluation.signals.cold_pale_or_numb_hand, 'not_asked');
    assert.deepEqual(evaluation.flags, [], 'a non-safety answer reached the safety engine');
  });

  test('and boolean safety semantics are untouched', () => {
    // `shoulder.trauma_urgent` reads a signal, and the signal must still be driven by the
    // boolean answer alone.
    const ep = newEpisode();
    store.applyMutations(ep.id, {
      answerMutations: [answer('shoulder.trauma_urgent', 'yes')],
      fieldMutations: [],
    });
    const flags = store.safetyFlags(ep.id);
    assert.ok(
      flags.some((f) => f.ruleId === 'msk.trauma_deformity_no_lift'),
      'the trauma safety rule stopped firing on a yes',
    );
    const quiet = newEpisode();
    store.applyMutations(quiet.id, {
      answerMutations: [answer('shoulder.trauma_urgent', 'no')],
      fieldMutations: [],
    });
    assert.ok(
      !store.safetyFlags(quiet.id).some((f) => f.ruleId === 'msk.trauma_deformity_no_lift'),
      'the trauma safety rule fired on a no',
    );
  });
});

describe('the recompute is what the store would have said anyway', () => {
  test('a correction withdraws only what the current answer set no longer supports', () => {
    const j = journey([
      { questionId: 'shoulder.night_pain', raw: 'yes' },
      { questionId: 'shoulder.radiation', raw: 'hand_tingle' },
      { questionId: 'shoulder.radiation', raw: 'none' },
    ]);
    assert.deepEqual(j.server.triggers, ['night'], 'withdrawing numbness removed another question’s trigger');
    assert.deepEqual(j.client.triggers, j.server.triggers, 'screen and store disagree on an unrelated answer');
    assert.deepEqual(j.server.quality, [], 'the withdrawn numbness survived');
    assert.deepEqual(j.reopen.episode.record.triggers, ['night'], 'reopen lost the unrelated trigger');
  });

  test('a correction payload reports exactly the fields it changed', () => {
    const j = journey([
      { questionId: 'shoulder.radiation', raw: 'hand_tingle' },
      { questionId: 'shoulder.radiation', raw: 'none' },
    ]);
    // A no-op must still report nothing: provenance must not be invented for an unchanged
    // field. The correction above does move both values, so both paths are real writes.
    assert.deepEqual(
      [...j.wroteFields].sort(),
      ['quality', 'radiation'],
      'the payload reports a field that did not change, or omits one that did',
    );
    const repeated = journey([{ questionId: 'shoulder.radiation', raw: 'none' }]);
    assert.deepEqual(
      repeated.wroteFields,
      [],
      'an explicit negative on an absent field must not fabricate an unrelated mutation',
    );
    assert.equal(
      Object.hasOwn(store.fieldStoreFor(repeated.id), 'radiation'),
      false,
      'coverage was implemented by inventing a value row for an absent field',
    );
  });

  test('the persisted record equals a recompute from the stored answers', () => {
    // Guards the fix from being a second source of truth: whatever makes the browser agree
    // must not make the STORE disagree with its own answer set.
    const j = journey([
      { questionId: 'shoulder.injury_context', raw: 'activity' },
      { questionId: 'shoulder.night_pain', raw: 'yes' },
      { questionId: 'shoulder.weakness', raw: ['weak_above_head', 'weak_internal_rotation'] },
      { questionId: 'shoulder.radiation', raw: 'hand_tingle' },
      { questionId: 'shoulder.injury_context', raw: 'unknown' },
      { questionId: 'shoulder.radiation', raw: 'none' },
    ]);
    const answers = store.answersFor(j.id);
    const derived = fieldsFromAnswers('shoulder', answers);
    const persisted = j.reopen.episode.record;
    assert.deepEqual(persisted.radiation, derived.radiation, 'radiation disagrees with the recompute');
    assert.deepEqual(persisted.quality, derived.quality, 'quality disagrees with the recompute');
    assert.deepEqual(
      persisted.context.recentInjury,
      derived['context.recentInjury'],
      'the mechanism disagrees with the recompute',
    );
    assert.deepEqual(
      persisted.function.activitiesAffected,
      derived['function.activitiesAffected'],
      'activities disagree with the recompute',
    );
  });
});