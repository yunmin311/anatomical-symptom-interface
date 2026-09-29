/**
 * Pre-visit summary — the doctor-facing artefact.
 *
 * Product plan §3.4: a session should not end with "maybe you have X". It should
 * end with something a clinician can scan in fifteen seconds during a consult.
 * This generator is fully deterministic and offline. No LLM touches the text a
 * doctor reads, because a hallucinated sentence in a medical summary is a
 * different class of harm from a hallucinated chat reply.
 */
import { REGIONS, getStructure } from './anatomy.ts';
import type { BodyRegion } from './anatomy.ts';
import { QUALITY_LABELS } from './symptom.ts';
import type { Episode, Quality, SymptomRecord, Trigger } from './symptom.ts';
import type { SafetyFlag } from './rules/redflags.ts';

export interface PreVisitSummary {
  episodeId: string;
  generatedAt: string;
  /** Section 1: the one-paragraph chief complaint. */
  chiefComplaint: string;
  locationLine: string;
  /** Section 2: bullet facts, clinician-scannable. */
  history: { label: string; value: string }[];
  /** Section 3: what the model considered but the user did NOT confirm. */
  unconfirmedConsiderations: string[];
  /** Section 4: prior episodes in the same region. */
  priorEpisodes: { id: string; startedAt: string; title: string; status: string }[];
  /** Section 5: safety notes, verbatim from the rule engine. */
  safetyNotes: { severity: string; title: string; message: string; steps: string[] }[];
  /** Section 6: explicit data-provenance footer. */
  dataSources: { sourceType: string; count: number }[];
  /** Machine-readable block for EHR import later. Never render this to a doctor as prose. */
  structured: Record<string, unknown>;
}

const TRIGGER_LABEL: Record<Trigger, string> = {
  movement: 'general movement',
  specific_posture: 'holding a posture',
  pressure: 'pressure on the area',
  lifting: 'lifting',
  repetition: 'repeated movement',
  exercise: 'exercise',
  rest_relief: 'relieved by rest',
  night: 'at night',
  breathing: 'breathing',
  eating: 'eating',
  coughing_sneezing: 'coughing or sneezing',
  load_bearing: 'weight-bearing',
  stairs: 'stairs',
  unknown: 'unknown trigger',
};

const ONSET_LABEL: Record<string, string> = {
  sudden: 'sudden onset',
  gradual: 'gradual onset',
  after_activity: 'after physical activity',
  after_injury: 'after an injury',
  insidious: 'insidious, no clear trigger',
  unknown: 'onset unclear',
};

const DURATION_UNIT: Record<string, string> = {
  minutes: 'min',
  hours: 'hours',
  days: 'days',
  weeks: 'weeks',
  months: 'months',
  years: 'years',
};

function listOrDash(items: string[]): string {
  return items.length ? items.join(', ') : '—';
}

function titleCase(s: string): string {
  return s.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function locationLine(record: SymptomRecord): string {
  const region = REGIONS[record.location.region];
  const side =
    record.location.side === 'unknown' || record.location.side === 'midline'
      ? ''
      : `${record.location.side === 'bilateral' ? 'bilateral' : record.location.side[0]!.toUpperCase() + record.location.side.slice(1)} `;
  const depth = record.location.depth === 'unknown' ? '' : `, ${record.location.depth}`;
  const sub = record.location.subRegionId
    ? ` (${titleCase(record.location.subRegionId.split('.').pop() ?? '')})`
    : '';
  return `${side}${region.label}${sub}${depth}`;
}

export function buildPreVisitSummary(
  episode: Episode,
  opts: { flags?: SafetyFlag[]; priorEpisodes?: Episode[] } = {},
): PreVisitSummary {
  const record = episode.record;
  const region = REGIONS[record.location.region as BodyRegion];
  const t = record.temporal;
  const prior = opts.priorEpisodes ?? [];

  const qualities = record.quality.map((q: Quality) => QUALITY_LABELS[q]).map((s) => s.toLowerCase());
  const duration =
    t.durationValue != null && t.durationUnit
      ? `${t.durationValue} ${DURATION_UNIT[t.durationUnit]}`
      : 'not stated';

  const chiefComplaint =
    `${region.label} — ${qualities.length ? qualities.join(' and ') : 'unspecified character'}; ` +
    `${ONSET_LABEL[t.onset]}; ${duration}; ` +
    `frequency ${titleCase(t.frequency)}; trend ${t.trend}.`;

  const history: { label: string; value: string }[] = [
    { label: 'Location', value: locationLine(record) },
    { label: 'Side', value: titleCase(record.location.side) },
    { label: 'Depth (patient report)', value: titleCase(record.location.depth) },
  ];

  if (record.location.userPhrase) {
    history.push({ label: "Patient's own words", value: `“${record.location.userPhrase}”` });
  }

  const confirmed = record.location.userConfirmedStructureIds
    .map((id) => getStructure(id)?.label ?? id)
    .filter(Boolean);
  if (confirmed.length) {
    history.push({ label: 'Structures confirmed by patient', value: listOrDash(confirmed) });
  }

  history.push({ label: 'Quality', value: listOrDash(qualities) });
  history.push({ label: 'Triggers', value: listOrDash(record.triggers.map((x) => TRIGGER_LABEL[x])) });
  if (record.triggerDetail) history.push({ label: 'Trigger detail', value: record.triggerDetail });
  history.push({ label: 'Radiation', value: listOrDash(record.radiation.map(titleCase)) });
  history.push({ label: 'Tenderness on palpation', value: titleCase(record.tendernessOnPalpation) });
  history.push({ label: 'Onset', value: `${ONSET_LABEL[t.onset]}${t.onsetAt ? ` (${t.onsetAt})` : ''}` });
  history.push({ label: 'Duration', value: duration });
  history.push({ label: 'Frequency', value: titleCase(t.frequency) });
  history.push({ label: 'Trend', value: titleCase(t.trend) });
  // Recurrence is asserted only if we can point at an actual earlier episode,
  // not merely because the user ticked "this has happened before".
  const earlierCount = Math.max(prior.length, record.context.relatedEpisodeIds.length);
  history.push({
    label: 'Recurrence',
    value: t.isRecurrence
      ? `yes — ${earlierCount} earlier episode(s) recorded in this area`
      : earlierCount
        ? `earlier episodes on file (${earlierCount})`
        : 'no',
  });

  if (record.function.intensity != null) {
    history.push({ label: 'Patient intensity (0-10)', value: String(record.function.intensity) });
  }
  if (record.function.activitiesAffected.length) {
    history.push({ label: 'Functional impact', value: listOrDash(record.function.activitiesAffected.map(titleCase)) });
  }
  history.push({ label: 'Sleep affected', value: titleCase(record.function.sleepAffected) });
  history.push({ label: 'Analgesia', value: titleCase(record.function.takesPainkiller) });
  if (record.function.unableWeighBearing !== 'no') {
    history.push({ label: 'Weight bearing', value: titleCase(record.function.unableWeighBearing) });
  }

  const systemic = record.context.systemicSymptoms.filter((s) => s !== 'none').map(titleCase);
  history.push({ label: 'Systemic symptoms', value: systemic.length ? listOrDash(systemic) : 'none reported' });
  if (record.context.recentInjury) history.push({ label: 'Recent injury', value: record.context.recentInjury });
  if (record.context.recentActivity) history.push({ label: 'Recent activity', value: record.context.recentActivity });
  if (record.context.medications.length) history.push({ label: 'Current medication', value: listOrDash(record.context.medications) });
  if (record.context.priorConditions.length) history.push({ label: 'Prior conditions', value: listOrDash(record.context.priorConditions) });

  const unconfirmed = record.consideredStructures
    .filter((s) => !s.confirmedByUser)
    .map((s) => getStructure(s.structureId)?.label ?? s.structureId);

  const flags = opts.flags ?? [];
  const dataSources = tallyProvenance(episode.provenance);

  return {
    episodeId: episode.id,
    generatedAt: new Date().toISOString(),
    chiefComplaint,
    locationLine: locationLine(record),
    history,
    unconfirmedConsiderations: unconfirmed,
    priorEpisodes: prior.map((e) => ({
      id: e.id,
      startedAt: e.startedAt,
      title: e.title,
      status: e.status,
    })),
    safetyNotes: flags.map((f) => ({
      severity: f.severity,
      title: f.title,
      message: f.userMessage,
      steps: f.actionSteps,
    })),
    dataSources,
    structured: {
      region: record.location.region,
      side: record.location.side,
      depth: record.location.depth,
      userConfirmedStructureIds: record.location.userConfirmedStructureIds,
      consideredStructureIds: record.consideredStructures.map((s) => s.structureId),
      quality: record.quality,
      triggers: record.triggers,
      radiation: record.radiation,
      temporal: record.temporal,
      function: record.function,
      context: record.context,
    },
  };
}

function tallyProvenance(provenance: Record<string, unknown>): { sourceType: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of Object.values(provenance)) {
    const sourceType =
      typeof entry === 'object' && entry !== null && 'sourceType' in entry
        ? String((entry as { sourceType: unknown }).sourceType)
        : 'unknown';
    counts.set(sourceType, (counts.get(sourceType) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([sourceType, count]) => ({ sourceType, count }))
    .sort((a, b) => b.count - a.count);
}

/** Plain-text render, for pasting into an email or printing. */
export function renderPlainText(summary: PreVisitSummary): string {
  const lines: string[] = [];
  lines.push('PRE-VISIT SYMPTOM SUMMARY');
  lines.push(`Generated ${summary.generatedAt}`);
  lines.push('');
  lines.push(summary.chiefComplaint);
  lines.push('');
  for (const h of summary.history) lines.push(`${h.label}: ${h.value}`);
  if (summary.priorEpisodes.length) {
    lines.push('');
    lines.push('PRIOR EPISODES IN THIS AREA:');
    for (const p of summary.priorEpisodes) lines.push(`  - ${p.startedAt.slice(0, 10)} — ${p.title} (${p.status})`);
  }
  if (summary.unconfirmedConsiderations.length) {
    lines.push('');
    lines.push('CONSIDERED BUT NOT CONFIRMED BY PATIENT (AI candidates, not findings):');
    for (const u of summary.unconfirmedConsiderations) lines.push(`  - ${u}`);
  }
  if (summary.safetyNotes.length) {
    lines.push('');
    lines.push('SAFETY NOTES:');
    for (const s of summary.safetyNotes) lines.push(`  [${s.severity.toUpperCase()}] ${s.title}: ${s.message}`);
  }
  lines.push('');
  lines.push('DATA SOURCES IN THIS SUMMARY:');
  for (const d of summary.dataSources) lines.push(`  - ${d.sourceType}: ${d.count} field(s)`);
  lines.push('');
  lines.push('This summary was produced by a patient self-report tool. It is not a diagnosis.');
  return lines.join('\n');
}
