/**
 * Pre-visit summary — the doctor-facing artefact.
 *
 * Product plan §3.4: a session should not end with "maybe you have X". It should
 * end with something a clinician can scan in fifteen seconds during a consult.
 * This generator is fully deterministic and offline. No LLM touches the text a
 * doctor reads, because a hallucinated sentence in a medical summary is a
 * different class of harm from a hallucinated chat reply.
 *
 * TWO RULES THAT CHANGED THE OUTPUT:
 *
 * 1. MISSINGNESS IS NEVER A NEGATIVE CLAIM. The record schema is full of
 *    defaults — `sleepAffected: 'no'`, `takesPainkiller: 'no'`,
 *    `systemicSymptoms: ['none']`, `side: 'unknown'`. Those are placeholders,
 *    not answers. Rendering them produced a summary asserting "Systemic
 *    symptoms: none reported" and "Sleep affected: no" to a clinician when the
 *    patient had simply never been asked. Every field is now rendered against
 *    a `coverage` map derived from the field store, and an unrecorded field
 *    says "not asked" — never "no".
 *
 * 2. A VISUAL SELECTION IS NOT A FINDING. `userSelectedStructureIds` means the
 *    user pointed at a location on the body map. It is reported as
 *    "Areas you pointed to on the body map", never as a confirmed structure
 *    and never as a diagnosis site.
 */
import { REGIONS, getStructure } from './anatomy.ts';
import type { BodyRegion } from './anatomy.ts';
import { QUALITY_LABELS, projectUserSelection } from './symptom.ts';
import { INTERVIEW, isGenuinelyUncertain, optionLabel } from './interview/engine.ts';
import type { Episode, Quality, SymptomRecord, Trigger } from './symptom.ts';
import type { SafetyFlag, WithheldFlag } from './rules/redflags.ts';
import type { AnswerMap } from './answers.ts';

/** The only three states a rendered field may have. */
export const NOT_ASKED_LABEL = 'not asked';
export const UNKNOWN_LABEL = 'not established';
export const NO_DATA_LABEL = 'not recorded';

export interface PreVisitSummary {
  episodeId: string;
  generatedAt: string;
  chiefComplaint: string;
  locationLine: string;
  history: { label: string; value: string }[];
  /** Structures the user pointed at. A location, not a finding. */
  visualSelections: string[];
  /** Model suggestions the user did not act on. Not findings, not candidates of disease. */
  unselectedSuggestions: string[];
  priorEpisodes: { id: string; startedAt: string; title: string; status: string }[];
  safetyNotes: { severity: string; title: string; message: string; steps: string[] }[];
  /** Rules that fired but were withheld by the release profile. */
  withheldNotes: { ruleId: string; severity: string; reason: string }[];
  /** True when a time-critical rule fired but could not be shown. */
  safetyGateBlocked: boolean;
  /** Registry fields with no stored value, for the clinician to ask about. */
  outstandingFields: string[];
  dataSources: { sourceType: string; count: number }[];
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
  unknown: 'not established',
};

const ONSET_LABEL: Record<string, string> = {
  sudden: 'sudden onset',
  gradual: 'gradual onset',
  after_activity: 'after physical activity',
  after_injury: 'after an injury',
  insidious: 'insidious, no clear trigger',
  unknown: UNKNOWN_LABEL,
};

const DURATION_UNIT: Record<string, string> = {
  minutes: 'min',
  hours: 'hours',
  days: 'days',
  weeks: 'weeks',
  months: 'months',
  years: 'years',
};

function titleCase(s: string): string {
  return s.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function joinOr(items: string[], empty: string): string {
  return items.length ? items.join(', ') : empty;
}

/* ------------------------------------------------------------------ */
/* Coverage-aware rendering                                            */
/* ------------------------------------------------------------------ */

export type Coverage = Record<string, boolean>;

/**
 * Conservative fallback coverage when no field-store map is supplied.
 *
 * A field counts as recorded only when its value clearly departs from the
 * empty-record placeholder. This is deliberately pessimistic: under-reporting
 * is harmless, whereas claiming "none reported" for something never asked is
 * the exact harm this function exists to prevent.
 */
export function deriveCoverage(record: SymptomRecord): Coverage {
  const r = record as unknown as Record<string, unknown>;
  const get = (p: string): unknown => p.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown>)?.[k], r);
  const c: Coverage = {};
  const recorded = (p: string, v: unknown) => {
    c[p] = v !== undefined && v !== null && v !== 'unknown' && v !== '' && !(Array.isArray(v) && v.length === 0);
  };

  recorded('location.region', get('location.region'));
  recorded('location.side', get('location.side'));
  recorded('location.depth', get('location.depth'));
  recorded('location.subRegionId', get('location.subRegionId'));
  recorded('location.userPhrase', get('location.userPhrase'));
  recorded('location.point', get('location.point'));
  recorded('location.userSelectedStructureIds', get('location.userSelectedStructureIds'));
  recorded('quality', get('quality'));
  recorded('triggers', get('triggers'));
  recorded('triggerDetail', get('triggerDetail'));
  recorded('radiation', get('radiation'));
  recorded('tendernessOnPalpation', get('tendernessOnPalpation'));
  recorded('temporal.onset', get('temporal.onset'));
  recorded('temporal.durationValue', get('temporal.durationValue'));
  recorded('temporal.durationUnit', get('temporal.durationUnit'));
  recorded('temporal.frequency', get('temporal.frequency'));
  recorded('temporal.trend', get('temporal.trend'));
  recorded('function.intensity', get('function.intensity'));
  recorded('function.activitiesAffected', get('function.activitiesAffected'));
  // These three default to a NEGATIVE value in the schema, so "has a value" is
  // never sufficient evidence that it was asked.
  c['function.sleepAffected'] = false;
  c['function.takesPainkiller'] = false;
  c['function.unableWeighBearing'] = false;
  c['context.systemicSymptoms'] = false;
  recorded('context.recentInjury', get('context.recentInjury'));
  recorded('context.recentActivity', get('context.recentActivity'));
  recorded('context.medications', get('context.medications'));
  recorded('context.priorConditions', get('context.priorConditions'));
  return c;
}

/**
 * Render a field, honouring coverage. A negative-looking value is only printed
 * when we know the question was actually put to the patient.
 */
function render(
  coverage: Coverage,
  path: string,
  value: string,
  opts: { negativeLooking?: boolean } = {},
): string {
  if (coverage[path] === false) return NOT_ASKED_LABEL;
  if (opts.negativeLooking) return value;
  return value;
}

function locationLine(record: SymptomRecord): string {
  const region = REGIONS[record.location.region];
  const side =
    record.location.side === 'unknown' || record.location.side === 'midline'
      ? ''
      : `${record.location.side === 'bilateral' ? 'bilateral' : record.location.side[0]!.toUpperCase() + record.location.side.slice(1)} `;
  const depth = record.location.depth === 'unknown' ? '' : `, felt as ${record.location.depth}`;
  const sub = record.location.subRegionId
    ? ` (${titleCase(record.location.subRegionId.split('.').pop() ?? '')})`
    : '';
  return `${side}${region.label}${sub}${depth}`;
}

export interface SummaryOptions {
  flags?: SafetyFlag[];
  priorEpisodes?: Episode[];
  /** Interview answers, used only to explain outstanding safety questions. */
  answers?: AnswerMap;
  /** Which registry fields have a stored value. Preferred over deriveCoverage. */
  coverage?: Coverage;
  withheld?: WithheldFlag[];
  blocked?: boolean;
}

export function buildPreVisitSummary(episode: Episode, opts: SummaryOptions = {}): PreVisitSummary {
  // Projected first, so the two structure lists below can never overlap even if
  // a caller hands us a hand-built record. The canonical set is the id list;
  // the per-candidate flag is derived from it and ignored.
  const record = projectUserSelection(episode.record);
  const region = REGIONS[record.location.region as BodyRegion];
  const t = record.temporal;
  const prior = opts.priorEpisodes ?? [];
  const coverage = opts.coverage ?? deriveCoverage(record);

  const qualities = record.quality.map((q: Quality) => QUALITY_LABELS[q].toLowerCase());
  const duration =
    t.durationValue != null && t.durationUnit && coverage['temporal.durationValue']
      ? `${t.durationValue} ${DURATION_UNIT[t.durationUnit]}`
      : NOT_ASKED_LABEL;

  const chiefComplaint =
    `${region.label} — ${qualities.length ? qualities.join(' and ') : 'character not established'}; ` +
    `${ONSET_LABEL[t.onset] ?? ONSET_LABEL.unknown}; duration ${duration}; ` +
    `frequency ${coverage['temporal.frequency'] === false ? NOT_ASKED_LABEL : t.frequency}; ` +
    `trend ${coverage['temporal.trend'] === false ? NOT_ASKED_LABEL : t.trend}.`;

  const history: { label: string; value: string }[] = [
    { label: 'Location', value: locationLine(record) },
    { label: 'Side', value: coverage['location.side'] ? titleCase(record.location.side) : NOT_ASKED_LABEL },
    { label: 'Depth (patient report)', value: coverage['location.depth'] ? titleCase(record.location.depth) : NOT_ASKED_LABEL },
  ];

  if (record.location.userPhrase) {
    history.push({ label: "Patient's own words", value: `“${record.location.userPhrase}”` });
  }

  const selected = record.location.userSelectedStructureIds
    .map((id) => getStructure(id)?.label ?? id)
    .filter(Boolean);
  if (selected.length) {
    // Wording matters: this is where the old version said "Structures confirmed
    // by patient", which reads as a clinical finding. Pointing at a body map is
    // not confirmation of anything except a location.
    history.push({ label: 'Areas pointed to on the body map', value: selected.join(', ') });
  }
  history.push({ label: 'Quality', value: render(coverage, 'quality', joinOr(qualities, NOT_ASKED_LABEL)) });
  history.push({
    label: 'Triggers',
    value: render(coverage, 'triggers', joinOr(record.triggers.map((x) => TRIGGER_LABEL[x]), NOT_ASKED_LABEL)),
  });
  if (coverage['triggerDetail'] && record.triggerDetail) {
    history.push({ label: 'Trigger detail', value: record.triggerDetail });
  }
  const radiationAnswer = opts.answers?.['shoulder.radiation'];
  const radiationQuestion = INTERVIEW.shoulder.find((question) => question.id === 'shoulder.radiation');
  const radiationUnresolved =
    radiationQuestion && radiationAnswer && isGenuinelyUncertain(radiationQuestion, radiationAnswer);
  history.push({
    label: 'Radiation',
    value:
      record.radiation.length > 0
        ? record.radiation
            .map((value) =>
              record.location.region === 'shoulder'
                ? (optionLabel('shoulder.radiation', value) ?? titleCase(value))
                : titleCase(value),
            )
            .join(', ')
        : radiationUnresolved
          ? UNKNOWN_LABEL
          : coverage['radiation']
            ? 'none'
            : NOT_ASKED_LABEL,
  });
  history.push({
    label: 'Tenderness on palpation',
    value: render(coverage, 'tendernessOnPalpation', titleCase(record.tendernessOnPalpation)),
  });
  history.push({
    label: 'Onset',
    value:
      coverage['temporal.onset'] === false
        ? NOT_ASKED_LABEL
        : `${ONSET_LABEL[t.onset] ?? ONSET_LABEL.unknown}${t.onsetAt ? ` (${t.onsetAt})` : ''}`,
  });
  history.push({ label: 'Duration', value: duration });
  history.push({ label: 'Frequency', value: render(coverage, 'temporal.frequency', titleCase(t.frequency)) });
  history.push({ label: 'Trend', value: render(coverage, 'temporal.trend', titleCase(t.trend)) });

  const earlierCount = Math.max(prior.length, record.context.relatedEpisodeIds.length);
  history.push({
    label: 'Recurrence',
    value: t.isRecurrence
      ? `yes — ${earlierCount} earlier episode(s) recorded in this area`
      : earlierCount
        ? `earlier episodes on file (${earlierCount})`
        : NOT_ASKED_LABEL,
  });

  if (coverage['function.intensity'] && record.function.intensity != null) {
    history.push({ label: 'Patient intensity (0-10)', value: String(record.function.intensity) });
  }
  if (coverage['function.activitiesAffected'] && record.function.activitiesAffected.length) {
    history.push({ label: 'Functional impact', value: record.function.activitiesAffected.map(titleCase).join(', ') });
  }
  // Each of these has a negative schema default, so coverage is the only thing
  // that lets us say "no" instead of "not asked".
  history.push({
    label: 'Sleep affected',
    value: render(coverage, 'function.sleepAffected', titleCase(record.function.sleepAffected), { negativeLooking: true }),
  });
  history.push({
    label: 'Analgesia',
    value: render(coverage, 'function.takesPainkiller', titleCase(record.function.takesPainkiller), { negativeLooking: true }),
  });
  history.push({
    label: 'Weight bearing',
    value: render(coverage, 'function.unableWeighBearing', titleCase(record.function.unableWeighBearing), { negativeLooking: true }),
  });

  const systemic = record.context.systemicSymptoms.filter((s) => s !== 'none').map(titleCase);
  history.push({
    label: 'Systemic symptoms',
    value: render(coverage, 'context.systemicSymptoms', joinOr(systemic, 'none reported'), { negativeLooking: true }),
  });
  if (coverage['context.recentInjury'] && record.context.recentInjury) {
    const mechanism =
      record.location.region === 'shoulder'
        ? (optionLabel('shoulder.injury_context', record.context.recentInjury) ??
          record.context.recentInjury)
        : record.context.recentInjury;
    history.push({ label: 'Recent injury or mechanism', value: mechanism });
  }
  if (coverage['context.recentActivity'] && record.context.recentActivity) {
    history.push({ label: 'Recent activity', value: record.context.recentActivity });
  }
  if (coverage['context.medications']) {
    history.push({ label: 'Current medication', value: joinOr(record.context.medications, NOT_ASKED_LABEL) });
  }
  if (coverage['context.priorConditions']) {
    history.push({ label: 'Prior conditions', value: joinOr(record.context.priorConditions, NOT_ASKED_LABEL) });
  }

  // Derived from the projected flag, so a structure cannot appear in both
  // lists. `selected` above comes from the canonical id set; this is everything
  // the model suggested that the user did not act on.
  const unselected = record.consideredStructures
    .filter((s) => !s.selectedByUser)
    .map((s) => getStructure(s.structureId)?.label ?? s.structureId);

  const flags = opts.flags ?? [];
  const withheld = opts.withheld ?? [];
  const outstanding = Object.entries(coverage)
    .filter(([, has]) => !has)
    .map(([path]) => path);

  return {
    episodeId: episode.id,
    generatedAt: new Date().toISOString(),
    chiefComplaint,
    locationLine: locationLine(record),
    history,
    visualSelections: selected,
    unselectedSuggestions: unselected,
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
    withheldNotes: withheld.map((w) => ({ ruleId: w.ruleId, severity: w.severity, reason: w.reason })),
    safetyGateBlocked: opts.blocked ?? false,
    outstandingFields: outstanding,
    dataSources: tallyProvenance(episode.provenance),
    structured: safeStructured(record, coverage),
  };
}

/**
 * The machine-readable block, with unrecorded fields nulled out.
 *
 * Dumping the raw record here would reintroduce exactly the bug the prose
 * rendering avoids: the schema default for `sleepAffected` is `'no'`, so a
 * never-asked field would serialise as `"sleepAffected": "no"` — a negative
 * claim in the one part of the payload a downstream system would trust without
 * reading the prose. Anything not covered is `null`, which means "not
 * established" rather than "no".
 */
function safeStructured(record: SymptomRecord, coverage: Coverage): Record<string, unknown> {
  const has = (p: string) => coverage[p] !== false;
  return {
    region: record.location.region,
    side: has('location.side') ? record.location.side : null,
    depth: has('location.depth') ? record.location.depth : null,
    subRegionId: has('location.subRegionId') ? record.location.subRegionId : null,
    userSelectedStructureIds: has('location.userSelectedStructureIds')
      ? record.location.userSelectedStructureIds
      : null,
    suggestedStructureIds: record.consideredStructures.map((s) => s.structureId),
    quality: has('quality') ? record.quality : null,
    triggers: has('triggers') ? record.triggers : null,
    radiation: has('radiation') ? record.radiation : null,
    tendernessOnPalpation: has('tendernessOnPalpation') ? record.tendernessOnPalpation : null,
    temporal: {
      onset: has('temporal.onset') ? record.temporal.onset : null,
      durationValue: has('temporal.durationValue') ? record.temporal.durationValue : null,
      durationUnit: has('temporal.durationUnit') ? record.temporal.durationUnit : null,
      frequency: has('temporal.frequency') ? record.temporal.frequency : null,
      trend: has('temporal.trend') ? record.temporal.trend : null,
      isRecurrence: record.temporal.isRecurrence,
    },
    function: {
      intensity: has('function.intensity') ? record.function.intensity : null,
      activitiesAffected: has('function.activitiesAffected') ? record.function.activitiesAffected : null,
      // These three default to a negative. Null, never "no".
      sleepAffected: has('function.sleepAffected') ? record.function.sleepAffected : null,
      takesPainkiller: has('function.takesPainkiller') ? record.function.takesPainkiller : null,
      unableWeighBearing: has('function.unableWeighBearing') ? record.function.unableWeighBearing : null,
    },
    context: {
      systemicSymptoms: has('context.systemicSymptoms') ? record.context.systemicSymptoms : null,
      recentInjury: has('context.recentInjury') ? record.context.recentInjury : null,
      recentActivity: has('context.recentActivity') ? record.context.recentActivity : null,
      medications: has('context.medications') ? record.context.medications : null,
      priorConditions: has('context.priorConditions') ? record.context.priorConditions : null,
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
    lines.push('EARLIER EPISODES IN THIS AREA:');
    for (const p of summary.priorEpisodes) lines.push(`  - ${p.startedAt.slice(0, 10)} — ${p.title} (${p.status})`);
  }
  if (summary.visualSelections.length) {
    lines.push('');
    lines.push('AREAS THE PATIENT POINTED TO ON THE BODY MAP (a location, not a finding):');
    for (const v of summary.visualSelections) lines.push(`  - ${v}`);
  }
  if (summary.unselectedSuggestions.length) {
    lines.push('');
    lines.push('SUGGESTED BY THE TOOL AND NOT ACTED ON BY THE PATIENT (not findings):');
    for (const u of summary.unselectedSuggestions) lines.push(`  - ${u}`);
  }
  if (summary.safetyGateBlocked) {
    lines.push('');
    lines.push('*** SAFETY GATE BLOCKED ***');
    lines.push('One or more safety rules matched but have not completed clinical review,');
    lines.push('so their guidance was withheld. This record has NOT been safely assessed.');
    for (const w of summary.withheldNotes) lines.push(`  - [${w.severity.toUpperCase()}] ${w.ruleId}: ${w.reason}`);
  } else if (summary.safetyNotes.length) {
    lines.push('');
    lines.push('SAFETY NOTES:');
    for (const s of summary.safetyNotes) {
      lines.push(`  [${s.severity.toUpperCase()}] ${s.title}: ${s.message}`);
      // The action steps are the part a reader acts on, and the on-screen summary
      // has always listed them. Omitting them here made the copied artefact -
      // the one a clinician may actually keep - less complete than the screen, so
      // the steps are indented under their own note. Without the indent a step
      // is indistinguishable from the next note's message, and with more than
      // one note the reader cannot tell whose guidance they are looking at.
      for (const step of s.steps) lines.push(`    - ${step}`);
    }
  }
  if (summary.outstandingFields.length) {
    lines.push('');
    lines.push(`NOT ESTABLISHED (${summary.outstandingFields.length} field(s) — consider asking):`);
    for (const f of summary.outstandingFields) lines.push(`  - ${f}`);
  }
  lines.push('');
  lines.push('DATA SOURCES IN THIS SUMMARY:');
  for (const d of summary.dataSources) lines.push(`  - ${d.sourceType}: ${d.count} field(s)`);
  lines.push('');
  lines.push('This summary was produced by a patient self-report tool. It is not a diagnosis.');
  return lines.join('\n');
}
