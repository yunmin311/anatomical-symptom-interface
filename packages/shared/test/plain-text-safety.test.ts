/**
 * The plain-text summary is the artefact a clinician may actually keep: it gets
 * pasted into an email or printed. It is rendered by ONE function, the domain's
 * `renderPlainText`, and the clipboard and the manual-copy fallback both consume
 * it verbatim.
 *
 * That makes it the last point before a clinician reads safety guidance, so the
 * action steps have to be in it. They used to be missing: the renderer emitted
 * `[SEVERITY] title: message` and dropped `safetyNotes[].steps`, even though the
 * on-screen summary has always listed them. The pasted text was therefore LESS
 * complete than the screen, and the steps are the part a reader acts on.
 *
 * These tests pin both halves of that contract: the steps are present and
 * attributed to their own note, and the blocked-gate path is untouched by the
 * change that added them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlainText } from '../src/summary.ts';
import type { PreVisitSummary } from '../src/summary.ts';

type SafetyNote = PreVisitSummary['safetyNotes'][number];

const note = (over: Partial<SafetyNote> = {}): SafetyNote => ({
  severity: 'urgent',
  title: 'Rule title',
  message: 'Rule message.',
  steps: [],
  ...over,
});

function summaryWith(
  safetyNotes: SafetyNote[],
  over: Partial<PreVisitSummary> = {},
): PreVisitSummary {
  return {
    episodeId: 'e1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    chiefComplaint: 'Test complaint.',
    locationLine: 'Test location',
    history: [{ label: 'Location', value: 'Test location' }],
    visualSelections: [],
    unselectedSuggestions: [],
    priorEpisodes: [],
    safetyNotes,
    withheldNotes: [],
    safetyGateBlocked: false,
    outstandingFields: [],
    dataSources: [{ sourceType: 'user_statement', count: 1 }],
    structured: {},
    ...over,
  };
}

/** The lines of the SAFETY NOTES block, so a test can assert on grouping. */
function safetyBlock(text: string): string[] {
  const start = text.indexOf('SAFETY NOTES:');
  if (start === -1) return [];
  const rest = text.slice(start).split('\n').slice(1);
  const end = rest.findIndex((line) => line.trim() === '' || /^[A-Z][A-Z ]+:$/.test(line.trim()));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => line.trim() !== '');
}

test('a safety note emits all of its action steps', () => {
  const text = renderPlainText(
    summaryWith([note({ steps: ['Stop the activity.', 'Get it assessed today.'] })]),
  );
  assert.match(text, /SAFETY NOTES:/);
  for (const step of ['Stop the activity.', 'Get it assessed today.']) {
    assert.ok(text.includes(step), `missing action step: ${step}`);
  }
});

test('severity, title and message still accompany the steps', () => {
  const text = renderPlainText(
    summaryWith([note({ severity: 'emergency', title: 'Sudden severe change', message: 'Describe it now.', steps: ['Seek care now.'] })]),
  );
  assert.match(text, /\[EMERGENCY\] Sudden severe change: Describe it now\./);
  assert.ok(text.includes('Seek care now.'));
});

test('action steps keep their original order', () => {
  const steps = ['First, do this.', 'Second, do that.', 'Third, and this.', 'Fourth, finally.'];
  const text = renderPlainText(summaryWith([note({ steps })]));
  const positions = steps.map((step) => text.indexOf(step));
  for (const p of positions) assert.notEqual(p, -1, 'a step was dropped');
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'steps were reordered');
});

test('each step is indented under the note it belongs to, so notes cannot cross', () => {
  const text = renderPlainText(
    summaryWith([
      note({ title: 'First rule', message: 'First message.', steps: ['Alpha one.', 'Alpha two.'] }),
      note({ title: 'Second rule', message: 'Second message.', steps: ['Beta one.', 'Beta two.'] }),
    ]),
  );
  const block = safetyBlock(text);
  assert.deepEqual(block, [
    '  [URGENT] First rule: First message.',
    '    - Alpha one.',
    '    - Alpha two.',
    '  [URGENT] Second rule: Second message.',
    '    - Beta one.',
    '    - Beta two.',
  ]);
  // Each step sits after its own note and before the next one.
  assert.ok(text.indexOf('Alpha two.') < text.indexOf('Second rule'));
  assert.ok(text.indexOf('Second rule') < text.indexOf('Beta one.'));
});

test('a note with no steps still renders, with no stray bullet', () => {
  const text = renderPlainText(summaryWith([note({ steps: [] })]));
  assert.match(text, /SAFETY NOTES:/);
  assert.match(text, /\[URGENT\] Rule title: Rule message\./);
  assert.equal(safetyBlock(text).length, 1);
});

test('a mix of notes with and without steps stays grouped', () => {
  const text = renderPlainText(
    summaryWith([
      note({ title: 'No steps', steps: [] }),
      note({ title: 'Has steps', steps: ['Only step.'] }),
    ]),
  );
  const block = safetyBlock(text);
  assert.deepEqual(block, [
    '  [URGENT] No steps: Rule message.',
    '  [URGENT] Has steps: Rule message.',
    '    - Only step.',
  ]);
});

test('three notes keep all twelve steps, three per note, in order', () => {
  const notes = ['A', 'B', 'C'].map((id) =>
    note({ title: `Rule ${id}`, steps: [`${id}1`, `${id}2`, `${id}3`] }),
  );
  const block = safetyBlock(renderPlainText(summaryWith(notes)));
  assert.equal(block.length, 3 + 9);
  for (const id of ['A', 'B', 'C']) {
    const stepLines = block.filter((l) => l.includes(`${id}1`) || l.includes(`${id}2`) || l.includes(`${id}3`));
    assert.deepEqual(stepLines, [`    - ${id}1`, `    - ${id}2`, `    - ${id}3`]);
  }
});

/* ================================================================== */
/* The blocked gate must be untouched by the action-steps change.     */
/* ================================================================== */

const BLOCKED = {
  safetyGateBlocked: true,
  withheldNotes: [{ ruleId: 'msk.cauda_equina', severity: 'emergency', reason: 'not clinically reviewed' }],
};

test('a blocked gate still reports the block, not safety notes', () => {
  const text = renderPlainText(
    summaryWith([note({ title: 'Leaked', message: 'Leaked body', steps: ['Leaked step.'] })], { ...BLOCKED }),
  );
  assert.match(text, /\*\*\* SAFETY GATE BLOCKED \*\*\*/);
  assert.match(text, /has NOT been safely assessed/);
  assert.doesNotMatch(text, /SAFETY NOTES:/);
});

test('blocked output still carries severity, ruleId and reason', () => {
  const text = renderPlainText(summaryWith([], { ...BLOCKED }));
  assert.match(text, /\[EMERGENCY\] msk\.cauda_equina: not clinically reviewed/);
});

test('a blocked gate withholds the guidance instead of printing it', () => {
  const text = renderPlainText(
    summaryWith(
      [note({ title: 'Leaked title', message: 'Leaked message.', steps: ['Leaked step one.', 'Leaked step two.'] })],
      { ...BLOCKED },
    ),
  );
  for (const leaked of ['Leaked title', 'Leaked message.', 'Leaked step one.', 'Leaked step two.']) {
    assert.equal(text.includes(leaked), false, `withheld guidance leaked into the export: ${leaked}`);
  }
});

test('every withheld rule is listed, not just the first', () => {
  const text = renderPlainText(
    summaryWith([], {
      safetyGateBlocked: true,
      withheldNotes: [
        { ruleId: 'msk.cauda_equina', severity: 'emergency', reason: 'first reason' },
        { ruleId: 'msk.croupse', severity: 'urgent', reason: 'second reason' },
      ],
    }),
  );
  assert.match(text, /\[EMERGENCY\] msk\.cauda_equina: first reason/);
  assert.match(text, /\[URGENT\] msk\.croupse: second reason/);
});

test('withheld severity is upper-cased and never down-graded by the steps change', () => {
  const text = renderPlainText(
    summaryWith([note({ severity: 'caution', steps: ['A caution step.'] })], { ...BLOCKED, withheldNotes: [{ ruleId: 'r.caution', severity: 'caution', reason: 'caution reason' }] }),
  );
  assert.match(text, /\[CAUTION\] r\.caution: caution reason/);
  // The blocked gate still wins, so the caution note's own step stays withheld.
  assert.equal(text.includes('A caution step.'), false);
});

test('no safety notes means no empty SAFETY NOTES heading', () => {
  const text = renderPlainText(summaryWith([]));
  assert.doesNotMatch(text, /SAFETY NOTES:/);
});
