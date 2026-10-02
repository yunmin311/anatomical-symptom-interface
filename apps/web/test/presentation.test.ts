import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnswer,
  emptyRecord,
  INTERVIEW,
  renderPlainText,
} from '@asi/shared';
import type { AnswerMap, PreVisitSummary } from '@asi/shared';
import * as presentation from '../src/ui/presentation.ts';
import {
  answersInSection,
  answerSections,
  groupSummaryRows,
  readable,
  sectionTitleFor,
} from '../src/ui/presentation.ts';

const base: PreVisitSummary = {
  episodeId: 'e1',
  generatedAt: '2026-01-01T00:00:00Z',
  chiefComplaint: 'Left shoulder — aching; sudden onset; duration 2 days.',
  locationLine: 'Left Shoulder (Anterior)',
  history: [{ label: 'Location', value: 'Left Shoulder (Anterior)' }],
  visualSelections: [],
  unselectedSuggestions: [],
  priorEpisodes: [],
  safetyNotes: [],
  withheldNotes: [],
  safetyGateBlocked: false,
  outstandingFields: [],
  dataSources: [{ sourceType: 'user_statement', count: 2 }],
  structured: {},
};

test('summary grouping preserves unfamiliar fields and every original value', () => {
  const rows = [
    { label: 'Location', value: 'Right knee' },
    { label: 'A future API field', value: 'verbatim value' },
    { label: "Patient's own words", value: 'My words' },
  ];
  const grouped = groupSummaryRows(rows);
  assert.deepEqual(
    grouped.find((section) => section.title === 'Other details')?.rows,
    [rows[1]],
  );
  assert.equal(grouped.flatMap((section) => section.rows).length, rows.length);
  for (const row of rows)
    assert.ok(grouped.some((section) => section.rows.includes(row)));
});

test('explicit unknown is never reported as unrecorded', () => {
  const side = readable('unknown');
  const depth = readable('unknown');
  for (const value of [side, depth]) {
    assert.ok(
      !/not recorded/i.test(value),
      `explicit uncertainty must not read as unrecorded: ${value}`,
    );
    assert.match(value, /not established/i);
  }
  assert.equal(side, depth);
});

test('missing information stays distinct from explicit uncertainty', () => {
  const unknown = readable('unknown');
  for (const absent of [null, undefined, '']) {
    const missing = readable(absent);
    assert.match(missing, /not asked/i);
    assert.notEqual(missing, unknown);
  }
  // A recorded value is still rendered plainly, underscores and all.
  assert.equal(readable('left'), 'left');
  assert.equal(readable('weight_bearing'), 'weight bearing');
});

test('pre-save review keeps an unestablished location distinct from an unasked one', async () => {
  const { emptyRecord, buildAnswer } = await import('@asi/shared');
  const { answerSections } = await import('../src/ui/presentation.ts');
  // The real pre-save review record: nothing answered yet, so the location is
  // explicitly unestablished rather than absent.
  const record = emptyRecord('shoulder');
  assert.equal(record.location.side, 'unknown');
  assert.equal(record.location.depth, 'unknown');

  const locationRows = [
    { label: 'Side', value: readable(record.location.side) },
    { label: 'Depth', value: readable(record.location.depth) },
  ];
  assert.ok(locationRows.every((row) => /not established/i.test(row.value)));
  assert.ok(locationRows.every((row) => !/not recorded/i.test(row.value)));

  // The answer groups on the same screen must not collapse the two either.
  const rows = answerSections(record, {
    'shoulder.vascular': buildAnswer({
      questionId: 'shoulder.vascular',
      raw: 'unknown',
      triState: 'unknown',
      provenance: { capturedAt: '2026-01-01T00:00:00Z', createdBy: 'user' },
    }),
  })
    .flatMap((section) => section.rows)
    .map((row) => row.value);
  assert.ok(rows.some((value) => /not established/i.test(value)));
  assert.ok(rows.some((value) => /not asked/i.test(value)));
  assert.ok(!rows.some((value) => /not recorded/i.test(value)));
});

test('review keeps no, yes, unknown and not asked separate without record defaults', async () => {
  const { emptyRecord, buildAnswer } = await import('@asi/shared');
  const { answerSections } = await import('../src/ui/presentation.ts');
  const record = emptyRecord('shoulder');
  for (const state of ['yes', 'no', 'unknown'] as const) {
    const answer = buildAnswer({
      questionId: 'shoulder.vascular',
      raw: state,
      triState: state,
      provenance: { capturedAt: '2026-09-30T00:00:00Z', createdBy: 'user' },
    });
    const rows = answerSections(record, {
      'shoulder.vascular': answer,
    }).flatMap((section) => section.rows);
    const row = rows.find((row) => row.label.includes('cold'));
    assert.ok(row);
    assert.equal(
      row.value,
      state === 'unknown' ? 'Not established — I am not sure' : state,
    );
    assert.ok(rows.some((row) => row.value === 'Not asked'));
  }
});

test('the frontend no longer carries its own plain-text summary renderer', () => {
  // renderPlainText in @asi/shared is the single source of truth. A second
  // frontend implementation is how the copied text drifts from the canonical
  // summary, so its absence is part of the contract.
  assert.equal('summaryText' in presentation, false);
  assert.equal(
    Object.values(presentation).some(
      (value) => typeof value === 'function' && /PRE-VISIT/.test(String(value)),
    ),
    false,
  );
});

test('copied plain text is exactly the canonical renderPlainText output', () => {
  assert.equal(
    renderPlainText(base),
    [
      'PRE-VISIT SYMPTOM SUMMARY',
      'Generated 2026-01-01T00:00:00Z',
      '',
      'Left shoulder — aching; sudden onset; duration 2 days.',
      '',
      'Location: Left Shoulder (Anterior)',
      '',
      'DATA SOURCES IN THIS SUMMARY:',
      '  - user_statement: 2 field(s)',
      '',
      'This summary was produced by a patient self-report tool. It is not a diagnosis.',
    ].join('\n'),
  );
});

test('canonical blocked-safety output preserves severity, ruleId and reason', () => {
  const text = renderPlainText({
    ...base,
    safetyGateBlocked: true,
    withheldNotes: [
      { ruleId: 'msk.cauda_equina', severity: 'emergency', reason: 'Not clinically reviewed' },
    ],
    // Present but must not leak: a blocked gate withholds rather than reports.
    safetyNotes: [
      { severity: 'urgent', title: 'Leaked note', message: 'Leaked body', steps: ['Leaked step'] },
    ],
  });
  assert.match(text, /\*\*\* SAFETY GATE BLOCKED \*\*\*/);
  assert.match(text, /This record has NOT been safely assessed/);
  assert.match(text, /\[EMERGENCY\] msk\.cauda_equina: Not clinically reviewed/);
  for (const leaked of ['Leaked note', 'Leaked body', 'Leaked step'])
    assert.equal(text.includes(leaked), false, `withheld rule leaked: ${leaked}`);
});

test('every answer a section renders also has an edit control', () => {
  // The grouping rule decides BOTH the rendered rows and the edit links. If they were
  // separate copies of the rule, a section could show a row with no way to correct it,
  // and the record would quietly keep a value the user has already disowned.
  const record = emptyRecord('shoulder');
  const answered: AnswerMap = {};
  for (const q of INTERVIEW.shoulder)
    answered[q.id] = buildAnswer({
      questionId: q.id,
      raw: q.type === 'boolean' ? 'yes' : (q.options?.[0]?.value ?? 'x'),
      triState: 'yes',
      provenance: { capturedAt: '2026-01-01T00:00:00.000Z', createdBy: 'user' },
    });

  const sections = answerSections(record, answered);
  const covered = sections.flatMap((section) =>
    answersInSection(record, answered, section.title).map((a) => a.questionId),
  );

  assert.deepEqual(
    [...covered].sort(),
    Object.keys(answered).sort(),
    'some answers are in a rendered section with no edit control, or in no section at all',
  );
});

test('answersInSection keeps question order and reports only what was asked', () => {
  const record = emptyRecord('knee');
  const answered: AnswerMap = {};
  for (const id of ['knee.swelling', 'knee.locking'] as const)
    answered[id] = buildAnswer({
      questionId: id,
      raw: 'yes',
      triState: 'yes',
      provenance: { capturedAt: '2026-01-01T00:00:00.000Z', createdBy: 'user' },
    });

  assert.deepEqual(
    answersInSection(record, answered, sectionTitleFor('quality')).map(
      (a) => a.questionId,
    ),
    // INTERVIEW order, not insertion order.
    INTERVIEW.knee
      .filter(
        (q) =>
          sectionTitleFor(q.field, q.safetyRuleId) === sectionTitleFor('quality') &&
          answered[q.id] !== undefined,
      )
      .map((q) => q.id),
  );
});
