import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyRecord } from '../src/symptom.ts';
import type { Episode } from '../src/symptom.ts';
import { INTERVIEW, nextQuestion, impliedStructures, questionProgress } from '../src/interview/engine.ts';
import { buildPreVisitSummary, renderPlainText } from '../src/summary.ts';

const ctxFor = (region: 'shoulder' | 'neck' | 'lower_back' | 'knee', asked: string[] = []) => {
  const record = emptyRecord(region);
  return { record, asked: new Set(asked) };
};

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
  const second = nextQuestion(ctxFor('shoulder', [first.id]))!;
  assert.notEqual(first.id, second.id);
});

test('the cauda equina question is mandatory for lower back, not optional', () => {
  const rule = INTERVIEW.lower_back.find((q) => q.safetyRuleId === 'msk.cauda_equina');
  assert.ok(rule, 'lower back must gate on the cauda equina question');
  assert.equal(rule.required, true);
});

test('progress accounting reflects the dynamic queue', () => {
  const ctx = ctxFor('knee', [INTERVIEW.knee[0]!.id]);
  const p = questionProgress(ctx);
  assert.equal(p.answered, 1);
  assert.ok(p.requiredLeft > 0);
  assert.equal(p.total, INTERVIEW.knee.length);
});

test('answer options imply candidate structures only', () => {
  // "twisting in" is the real option value on knee.stairs; the returned
  // structures are candidates, never confirmations.
  const hits = impliedStructures('knee', ['twisting_in']);
  assert.ok(hits.length > 0, 'expected the twisting-in option to imply a structure');
  assert.ok(hits.every((s) => s.id.startsWith('asi:knee.')));
  assert.ok(hits.some((s) => s.id.includes('mcl')));
});

test('an option cannot imply a structure from a different region', () => {
  assert.equal(impliedStructures('knee', ['weak_external_rotation']).length, 0);
});

function sampleEpisode(): Episode {
  const record = emptyRecord('shoulder');
  record.location = { ...record.location, side: 'right', depth: 'deep', subRegionId: 'shoulder.anterior', userPhrase: 'right shoulder inside hurts' };
  record.quality = ['pulling', 'sharp'];
  record.triggers = ['movement'];
  record.triggerDetail = 'arm up past about 90 degrees';
  record.consideredStructures = [
    { structureId: 'asi:shoulder.biceps-long-head-tendon', confidence: 0.4, confirmedByUser: false },
    { structureId: 'asi:shoulder.glenohumeral-joint', confidence: 0.3, confirmedByUser: false },
  ];
  record.temporal = { ...record.temporal, onset: 'after_activity', frequency: 'intermittent', trend: 'stable', isRecurrence: true, durationValue: 2, durationUnit: 'days' };
  record.function = { ...record.function, intensity: 5, sleepAffected: 'yes', activitiesAffected: ['reaching overhead'] };
  return {
    id: 'ep_test',
    personId: 'p1',
    region: 'shoulder',
    side: 'right',
    status: 'open',
    startedAt: '2026-09-20T09:00:00.000Z',
    endedAt: null,
    title: 'Right shoulder pain after tennis',
    record,
    provenance: {
      'location.side': { sourceType: 'user_statement', verificationStatus: 'user_confirmed', createdBy: 'user' },
      'quality': { sourceType: 'ai_inference', verificationStatus: 'unverified', createdBy: 'claude', confidence: 0.7 },
    },
    createdAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-20T09:30:00.000Z',
    safetyFlags: [],
  };
}

test('pre-visit summary keeps user words and separates confirmed from considered', () => {
  const s = buildPreVisitSummary(sampleEpisode());
  assert.match(s.chiefComplaint, /Shoulder/);
  assert.ok(s.history.some((h) => h.label === "Patient's own words"));
  assert.equal(s.unconfirmedConsiderations.length, 2);
  assert.ok(s.dataSources.some((d) => d.sourceType === 'ai_inference'));
});

test('plain text export is self-limiting about being a diagnosis', () => {
  const text = renderPlainText(buildPreVisitSummary(sampleEpisode()));
  assert.match(text, /not a diagnosis/i);
});
