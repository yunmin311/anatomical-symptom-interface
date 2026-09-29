import type { PreVisitSummary } from '@asi/shared';

export function readable(value: string | null | undefined): string {
  if (!value || value === 'unknown') return 'Not recorded';
  return value.replaceAll('_', ' ');
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

const SECTIONS = [
  { title: 'Your own words', labels: ["Patient's own words"] },
  { title: 'Anatomical location', labels: ['Location', 'Side', 'Depth (patient report)', 'Structures confirmed by patient'] },
  { title: 'Symptom characteristics', labels: ['Quality', 'Triggers', 'Trigger detail', 'Radiation', 'Tenderness on palpation'] },
  { title: 'Timeline', labels: ['Onset', 'Duration', 'Frequency', 'Trend', 'Recurrence'] },
  { title: 'Functional impact', labels: ['Patient intensity (0-10)', 'Functional impact', 'Sleep affected', 'Analgesia', 'Weight bearing'] },
  { title: 'Additional context', labels: ['Systemic symptoms', 'Recent injury', 'Recent activity', 'Current medication', 'Prior conditions'] },
];

/** Preserve new API labels in an explicit fallback section rather than losing them. */
export function groupSummaryRows(rows: PreVisitSummary['history']) {
  const known = new Set(SECTIONS.flatMap((section) => section.labels));
  return [...SECTIONS.map((section) => ({title: section.title, rows: rows.filter((row) => section.labels.includes(row.label))})),
    {title: 'Other details', rows: rows.filter((row) => !known.has(row.label))}].filter((section) => section.rows.length > 0);
}

/** Copy the same full content displayed, including the rule engine's action steps. */
export function summaryText(summary: PreVisitSummary): string {
  return [
    'PRE-VISIT SYMPTOM SUMMARY', `Generated ${summary.generatedAt}`, summary.chiefComplaint,
    ...groupSummaryRows(summary.history).flatMap((section) => ['', section.title, ...section.rows.map((row) => `${row.label}: ${row.value}`)]),
    ...(summary.unconfirmedConsiderations.length ? ['', 'Unconfirmed candidates — suggestions, not findings', ...summary.unconfirmedConsiderations] : []),
    ...(summary.priorEpisodes.length ? ['', 'Earlier episodes in this area', ...summary.priorEpisodes.map((episode) => `${episode.startedAt}: ${episode.title} (${episode.status})`)] : []),
    ...(summary.safetyNotes.length ? ['', 'Safety information', ...summary.safetyNotes.flatMap((note) => [`[${note.severity}] ${note.title}`, note.message, ...note.steps])] : []),
    '', 'Data sources', ...summary.dataSources.map((source) => `${source.sourceType}: ${source.count} field(s)`),
    '', 'This summary was produced by a patient self-report tool. It is not a diagnosis.',
  ].join('\n');
}
