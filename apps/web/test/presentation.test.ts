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
    unconfirmedConsiderations: ['Candidate A'],
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
    dataSources: [{ sourceType: 'user_statement', count: 2 }],
    structured: {},
  });
  for (const value of [
    'Verbatim action one',
    'Verbatim action two',
    'Verbatim rule message',
    'suggestions, not findings',
    'Candidate A',
    'Prior episode',
    'user_statement: 2',
    'not a diagnosis',
  ])
    assert.ok(text.includes(value), value);
});
