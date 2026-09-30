import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPreVisitSummary, deriveCoverage, NOT_ASKED_LABEL, renderPlainText } from '../src/summary.ts';
import { emptyRecord } from '../src/symptom.ts';
import type { Episode } from '../src/symptom.ts';

const NOW = '2026-09-20T09:00:00.000Z';

/** An episode with a completely untouched record: nothing asked, nothing set. */
function untouchedEpisode(): Episode {
  return {
    id: 'ep_bare',
    personId: 'p1',
    region: 'lower_back',
    side: 'unknown',
    status: 'open',
    title: 'Lower back',
    record: emptyRecord('lower_back'),
    provenance: {},
    startedAt: NOW,
    endedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    safetyFlags: [],
  };
}

const valueOf = (s: ReturnType<typeof buildPreVisitSummary>, label: string) =>
  s.history.find((h) => h.label === label)?.value;

test('ISSUE 5: a completely unanswered record never claims a negative', () => {
  const summary = buildPreVisitSummary(untouchedEpisode(), { coverage: deriveCoverage(emptyRecord('lower_back')) });

  // These four all default to a NEGATIVE value in the schema. None of them may
  // be rendered as that negative, because nothing was ever asked.
  assert.equal(valueOf(summary, 'Systemic symptoms'), NOT_ASKED_LABEL, 'must not claim "none reported"');
  assert.equal(valueOf(summary, 'Sleep affected'), NOT_ASKED_LABEL, 'must not claim "no"');
  assert.equal(valueOf(summary, 'Analgesia'), NOT_ASKED_LABEL, 'must not claim "no"');
  assert.equal(valueOf(summary, 'Weight bearing'), NOT_ASKED_LABEL, 'must not claim "no"');

  const text = JSON.stringify(summary);
  assert.doesNotMatch(text, /none reported/i, 'must not claim "none reported" for an unanswered field');
  // The machine-readable block must not serialise a schema default as a fact.
  const structured = JSON.stringify(summary.structured);
  for (const leaked of ['"no"', '"none"', '"unknown"']) {
    assert.doesNotMatch(structured, new RegExp(leaked), `structured block leaked default ${leaked}`);
  }
});

test('ISSUE 5: an explicit negative IS reported when coverage says we asked', () => {
  const record = emptyRecord('lower_back');
  record.context.systemicSymptoms = ['none'];
  record.function.sleepAffected = 'no';
  const ep = { ...untouchedEpisode(), record };
  const coverage = {
    ...deriveCoverage(record),
    'context.systemicSymptoms': true,
    'function.sleepAffected': true,
  };
  const summary = buildPreVisitSummary(ep, { coverage });
  assert.equal(valueOf(summary, 'Systemic symptoms'), 'none reported');
  assert.equal(valueOf(summary, 'Sleep affected'), 'No');
});

test('ISSUE 5: duration renders as "not asked" rather than "0 minutes"', () => {
  const summary = buildPreVisitSummary(untouchedEpisode(), { coverage: deriveCoverage(emptyRecord('lower_back')) });
  assert.equal(valueOf(summary, 'Duration'), NOT_ASKED_LABEL);
  assert.doesNotMatch(summary.chiefComplaint, /0 min/);
});

test('ISSUE 5: the chief complaint does not assert a settled character', () => {
  const summary = buildPreVisitSummary(untouchedEpisode(), { coverage: deriveCoverage(emptyRecord('lower_back')) });
  assert.match(summary.chiefComplaint, /character not established/);
});

test('ISSUE 5: outstanding fields are listed so a clinician knows what to ask', () => {
  const summary = buildPreVisitSummary(untouchedEpisode(), { coverage: deriveCoverage(emptyRecord('lower_back')) });
  assert.ok(summary.outstandingFields.length > 5, 'a bare record should list many outstanding fields');
  assert.ok(summary.outstandingFields.includes('temporal.trend'));
});

test('ISSUE 3: a visual selection is reported as a location, never as a finding', () => {
  const record = emptyRecord('shoulder');
  record.location.userSelectedStructureIds = ['asi:shoulder.biceps-long-head-tendon'];
  const ep = { ...untouchedEpisode(), region: 'shoulder' as const, record };
  const summary = buildPreVisitSummary(ep, { coverage: deriveCoverage(record) });

  assert.equal(valueOf(summary, 'Areas pointed to on the body map'), 'Long head of biceps tendon');
  assert.deepEqual(summary.visualSelections, ['Long head of biceps tendon']);

  // The old wording claimed confirmation. It must not reappear.
  const text = JSON.stringify(summary);
  assert.doesNotMatch(text, /confirmed by patient/i);
  assert.doesNotMatch(text, /Structures confirmed/i);
});

test('ISSUE 3: the plain-text export labels suggestions as not findings', () => {
  const record = emptyRecord('shoulder');
  record.location.userSelectedStructureIds = ['asi:shoulder.deltoid'];
  record.consideredStructures = [
    { structureId: 'asi:shoulder.supraspinatus-tendon', rationale: null, confidence: 0.5, selectedByUser: false },
  ];
  const ep = { ...untouchedEpisode(), region: 'shoulder' as const, record };
  const summary = buildPreVisitSummary(ep, { coverage: deriveCoverage(record) });
  const text = renderPlainText(summary);
  assert.match(text, /NOT ACTED ON BY THE PATIENT \(not findings\)/);
  assert.match(text, /a location, not a finding/);
  assert.doesNotMatch(text, /confirmed/i);
});

test('ISSUE 8: a blocked safety gate is stated in the plain-text export', () => {
  const summary = buildPreVisitSummary(untouchedEpisode(), {
    coverage: deriveCoverage(emptyRecord('lower_back')),
    blocked: true,
    withheld: [
      { ruleId: 'msk.cauda_equina', severity: 'emergency', reviewStatus: 'unreviewed', reason: 'not clinically reviewed' },
    ],
  });
  const text = renderPlainText(summary);
  assert.match(text, /SAFETY GATE BLOCKED/);
  assert.match(text, /has NOT been safely assessed/);
});

test('deriveCoverage is pessimistic about schema placeholders', () => {
  const record = emptyRecord('lower_back');
  record.function.sleepAffected = 'no'; // a negative placeholder, not an answer
  const c = deriveCoverage(record);
  assert.equal(c['function.sleepAffected'], false, 'a default "no" must never count as recorded');
  assert.equal(c['location.region'], true, 'the region is structurally known');
});
