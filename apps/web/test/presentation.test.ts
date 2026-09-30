import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupSummaryRows, summaryText } from '../src/ui/presentation.ts';

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

test('copy retains safety action steps, uncertainty, earlier episodes and source counts', () => {
  const text = summaryText({
    episodeId: 'test',
    generatedAt: '2026-09-29T00:00:00Z',
    chiefComplaint: 'Test complaint',
    locationLine: 'Test location',
    history: [{ label: 'Location', value: 'Test location' }],
    visualSelections: ['Structure the user pointed at'],
    unselectedSuggestions: ['Candidate A'],
    priorEpisodes: [
      {
        id: 'prior',
        startedAt: '2026-01-01T00:00:00Z',
        title: 'Prior episode',
        status: 'open',
      },
    ],
    safetyNotes: [
      {
        severity: 'caution',
        title: 'Rule title',
        message: 'Verbatim rule message',
        steps: ['Verbatim action one', 'Verbatim action two'],
      },
    ],
    withheldNotes: [
      { ruleId: 'rule.withheld', severity: 'urgent', reason: 'Withheld reason' },
    ],
    safetyGateBlocked: true,
    outstandingFields: ['temporal.onset'],
    dataSources: [{ sourceType: 'user_statement', count: 2 }],
    structured: {},
  });
  for (const value of [
    'Verbatim action one',
    'Verbatim action two',
    'Verbatim rule message',
    'not findings',
    'Candidate A',
    'Structure the user pointed at',
    'location, not a finding',
    'Prior episode',
    'user_statement: 2',
    'not a diagnosis',
  ])
    assert.ok(text.includes(value), value);

  // A withheld urgent rule and a blocked gate must never be copied out as if the
  // record were safe; missing fields must read as missing, not as a negative.
  assert.ok(text.includes('SAFETY GATE BLOCKED'));
  assert.ok(text.includes('Withheld [urgent]: Withheld reason'));
  assert.ok(text.includes('Not established'));
  assert.ok(text.includes('temporal.onset'));
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
