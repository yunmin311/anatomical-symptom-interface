import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyRecord } from '../src/symptom.ts';
import type { Episode } from '../src/symptom.ts';
import { INTERVIEW, nextQuestion, impliedStructures, questionProgress, applyAnswer } from '../src/interview/engine.ts';
import { buildAnswer, putAnswer } from '../src/answers.ts';
import type { AnswerMap } from '../src/answers.ts';
import { buildPreVisitSummary, renderPlainText } from '../src/summary.ts';
import { getFieldPolicy } from '../src/field-policy.ts';
import { REGIONS } from '../src/anatomy.ts';
import type { BodyRegion } from '../src/anatomy.ts';

const ans = (questionId: string, raw: unknown, tri: 'yes' | 'no' | 'unknown' = 'yes') =>
  buildAnswer({
    questionId,
    raw,
    triState: tri,
    provenance: { capturedAt: '2026-01-01T00:00:00.000Z', createdBy: 'user' },
  });

const ctxFor = (region: BodyRegion, answers: AnswerMap = {}) => ({
  record: emptyRecord(region),
  answers,
});

test('every V1 region has an interview', () => {
  for (const region of ['shoulder', 'neck', 'lower_back', 'knee'] as const) {
    assert.ok(INTERVIEW[region].length > 0, `${region} has no questions`);
  }
});

test('interview questions are region-specific, not one shared questionnaire', () => {
  const shoulderFirst = nextQuestion(ctxFor('shoulder'))!.id;
  const kneeFirst = nextQuestion(ctxFor('knee'))!.id;
  assert.notEqual(shoulderFirst, kneeFirst);
});

test('asking a question advances the queue', () => {
  const first = nextQuestion(ctxFor('shoulder'))!;
  const answers = putAnswer({}, ans(first.id, 'x'));
  const second = nextQuestion(ctxFor('shoulder', answers))!;
  assert.notEqual(first.id, second.id);
});

test('a "don\'t know" answer is not re-asked but is still reported outstanding', () => {
  const first = nextQuestion(ctxFor('shoulder'))!;
  const answers = putAnswer({}, ans(first.id, "don't know", 'unknown'));
  const next = nextQuestion(ctxFor('shoulder', answers));
  assert.ok(next);
  assert.notEqual(next!.id, first.id, 'an unknown answer must not loop the same question');
  const progress = questionProgress(ctxFor('shoulder', answers));
  assert.ok(progress.outstanding.includes(first.id), 'it must still be reported as outstanding');
});

test('the cauda equina gate is mandatory for lower back, not optional', () => {
  const gates = INTERVIEW.lower_back.filter((q) => q.safetyRuleId === 'msk.cauda_equina');
  assert.ok(gates.length >= 1);
  assert.ok(gates.every((q) => q.required));
});

test('progress accounting reflects the dynamic queue', () => {
  const first = INTERVIEW.knee[0]!;
  const answers = putAnswer({}, ans(first.id, 'x'));
  const p = questionProgress(ctxFor('knee', answers));
  assert.equal(p.answered, 1);
  assert.ok(p.requiredLeft > 0);
  assert.equal(p.total, INTERVIEW.knee.length);
});

test('answer options imply candidate structures only', () => {
  const hits = impliedStructures('knee', ['twisting_in']);
  assert.ok(hits.length > 0);
  assert.ok(hits.every((s) => s.id.startsWith('asi:knee.')));
  assert.ok(hits.some((s) => s.id.includes('mcl')));
});

test('an option cannot imply a structure from a different region', () => {
  assert.equal(impliedStructures('knee', ['weak_external_rotation']).length, 0);
});

test('every applyTo returns only registry-writable field paths', () => {
  for (const [region, questions] of Object.entries(INTERVIEW)) {
    for (const q of questions) {
      if (!q.applyTo) continue;
      const record = emptyRecord(region as BodyRegion);
      const written = q.applyTo(record, ans(q.id, 'x'));
      for (const path of written) {
        assert.ok(getFieldPolicy(path), `${region}.${q.id} wrote unregistered field "${path}"`);
      }
    }
  }
});

test('applyAnswer on a question with no mapping writes nothing', () => {
  const record = emptyRecord('lower_back');
  const before = JSON.stringify(record);
  applyAnswer(record, 'lower_back.bladder', ans('lower_back.bladder', 'yes'));
  assert.equal(JSON.stringify(record), before);
});

test('applyAnswer on an unknown question id is a no-op, not a throw', () => {
  const record = emptyRecord('knee');
  assert.deepEqual(applyAnswer(record, 'knee.does_not_exist', ans('knee.does_not_exist', 'yes')), []);
});

/* ---------------- summary ---------------- */

function sampleEpisode(): Episode {
  const record = emptyRecord('shoulder');
  record.location = {
    ...record.location,
    side: 'right',
    depth: 'deep',
    subRegionId: 'shoulder.anterior',
    userPhrase: 'right shoulder inside hurts',
  };
  record.quality = ['pulling', 'sharp'];
  record.triggers = ['movement'];
  record.triggerDetail = 'arm up past about 90 degrees';
  record.location.userSelectedStructureIds = ['asi:shoulder.biceps-long-head-tendon'];
  record.consideredStructures = [
    { structureId: 'asi:shoulder.glenohumeral-joint', confidence: 0.4, selectedByUser: false },
  ];
  record.temporal = {
    ...record.temporal,
    onset: 'after_activity',
    frequency: 'intermittent',
    trend: 'stable',
    isRecurrence: true,
    durationValue: 2,
    durationUnit: 'days',
  };
  record.function = { ...record.function, intensity: 5, sleepAffected: 'yes', activitiesAffected: ['reaching overhead'] };
  const coverage: Record<string, boolean> = {};
  for (const p of [
    'location.region', 'location.side', 'location.depth', 'location.subRegionId', 'location.userPhrase',
    'location.point', 'location.userSelectedStructureIds', 'quality', 'triggers', 'triggerDetail',
    'radiation', 'tendernessOnPalpation', 'temporal.onset', 'temporal.durationValue', 'temporal.durationUnit',
    'temporal.frequency', 'temporal.trend', 'function.intensity', 'function.activitiesAffected',
    'function.sleepAffected', 'function.takesPainkiller', 'function.unableWeighBearing',
    'context.systemicSymptoms', 'context.recentInjury', 'context.recentActivity',
    'context.medications', 'context.priorConditions',
  ]) coverage[p] = true;

  return {
    id: 'ep_test',
    personId: 'p1',
    region: 'shoulder',
    side: 'right',
    status: 'open',
    title: 'Right shoulder pain after tennis',
    record,
    provenance: {
      'location.side': { sourceType: 'user_statement', verificationStatus: 'user_confirmed', createdBy: 'user', capturedAt: '2026-09-20T09:00:00.000Z' },
      'quality': { sourceType: 'ai_inference', verificationStatus: 'unverified', createdBy: 'claude', confidence: 0.7, capturedAt: '2026-09-20T09:00:00.000Z' },
    },
    startedAt: '2026-09-20T09:00:00.000Z',
    endedAt: null,
    createdAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-20T09:30:00.000Z',
    safetyFlags: [],
  };
}

test('pre-visit summary keeps user words and separates selection from suggestion', () => {
  const s = buildPreVisitSummary(sampleEpisode(), {
    coverage: {
      'location.region': true, 'location.side': true, 'location.depth': true, 'location.subRegionId': true,
      'location.userPhrase': true, 'location.userSelectedStructureIds': true, 'quality': true,
      'triggers': true, 'triggerDetail': true, 'temporal.onset': true, 'temporal.durationValue': true,
      'temporal.frequency': true, 'temporal.trend': true, 'function.intensity': true,
      'function.activitiesAffected': true, 'function.sleepAffected': true,
    },
  });
  assert.match(s.chiefComplaint, /Shoulder/);
  assert.ok(s.history.some((h) => h.label === "Patient's own words"));
  assert.deepEqual(s.visualSelections, ['Long head of biceps tendon']);
  assert.equal(s.unselectedSuggestions.length, 1);
  assert.ok(s.dataSources.some((d) => d.sourceType === 'ai_inference'));
});

test('plain text export is self-limiting about being a diagnosis', () => {
  const text = renderPlainText(buildPreVisitSummary(sampleEpisode(), { coverage: {} }));
  assert.match(text, /not a diagnosis/i);
});

test('region definitions stay consistent with the interview registry', () => {
  for (const region of Object.keys(REGIONS) as BodyRegion[]) {
    assert.ok(INTERVIEW[region], `no interview for published region ${region}`);
  }
});
