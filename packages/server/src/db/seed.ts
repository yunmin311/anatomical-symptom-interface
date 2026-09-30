/**
 * Seed: one person, a small history in the left knee, so the health map and
 * "you have had this before" path have something to show on first run.
 *
 * Every write goes through the same validated mutation path the API uses, so
 * the seed cannot create a state the API would refuse.
 */
import { renderPlainText } from '@asi/shared';
import type { Provenance } from '@asi/shared';
import { db } from './client.ts';
import { answersFor, applyMutations, createEpisode, fieldStoreFor, summaryFor } from './store.ts';

const PERSON = 'local';

void answersFor;
void fieldStoreFor;

const userProv = (rawText?: string): Omit<Provenance, 'capturedAt'> => ({
  sourceType: 'user_statement',
  verificationStatus: 'user_confirmed',
  createdBy: 'user',
  rawText: rawText ?? null,
});

const selectionProv = (): Omit<Provenance, 'capturedAt'> => ({
  sourceType: 'user_selection',
  verificationStatus: 'user_confirmed',
  createdBy: 'user',
});

const aiProv = (): Omit<Provenance, 'capturedAt'> => ({
  sourceType: 'ai_inference',
  verificationStatus: 'unverified',
  createdBy: 'seed',
  confidence: 0.5,
});

void aiProv;

const reset = () => {
  for (const t of [
    'episode_answers', 'episode_assertions', 'episode_fields', 'safety_flags', 'transcripts',
    'episodes', 'body_regions', 'persons',
  ]) {
    db.exec(`DELETE FROM ${t}`);
  }
};

const CAPTURED = new Date().toISOString();

function seedEpisode(opts: {
  region: 'knee' | 'shoulder' | 'lower_back' | 'neck';
  side: 'left' | 'right' | 'midline';
  title: string;
  quality: string[];
  triggers: string[];
  triggerDetail: string;
  durationValue: number;
  durationUnit: 'days' | 'weeks' | 'months';
  trend: 'improving' | 'stable' | 'worsening';
  onset: 'sudden' | 'gradual' | 'after_activity' | 'after_injury' | 'insidious';
  point: { x: number; y: number };
  activitiesAffected: string[];
  selectedStructureIds: string[];
  phrases: string[];
  closed: boolean;
}) {
  const ep = createEpisode({
    personId: PERSON,
    displayName: 'Me',
    region: opts.region,
    side: opts.side,
    title: opts.title,
    grounding: { status: 'grounded', reason: null, by: 'deterministic', score: 0.8, clarification: null },
  });

  const m = (fieldPath: string, value: unknown, provenance: Omit<Provenance, 'capturedAt'>) => ({
    fieldPath,
    value,
    provenance: { ...provenance, capturedAt: CAPTURED },
  });

  applyMutations(ep.id, {
    fieldMutations: [
      m('location.region', opts.region, userProv(opts.phrases[0])),
      m('location.side', opts.side, userProv(opts.phrases[0])),
      m('location.depth', 'deep', userProv()),
      m('location.userPhrase', opts.phrases[0] ?? null, userProv(opts.phrases[0])),
      m('location.point', opts.point, selectionProv()),
      m('location.userSelectedStructureIds', opts.selectedStructureIds, selectionProv()),
      m('quality', opts.quality, userProv()),
      m('triggers', opts.triggers, userProv()),
      m('triggerDetail', opts.triggerDetail, userProv()),
      m('temporal.onset', opts.onset, userProv()),
      m('temporal.durationValue', opts.durationValue, userProv()),
      m('temporal.durationUnit', opts.durationUnit, userProv()),
      m('temporal.frequency', 'intermittent', userProv()),
      m('temporal.trend', opts.trend, userProv()),
      m('temporal.isRecurrence', true, userProv()),
      m('function.intensity', 5, userProv()),
      m('function.activitiesAffected', opts.activitiesAffected, userProv()),
      m('function.sleepAffected', 'slightly', userProv()),
      m('context.systemicSymptoms', ['none'], userProv()),
    ],
    answerMutations: opts.phrases.map((p, i) => ({
      questionId: `${opts.region}.mechanism`,
      raw: p,
      wroteFields: [],
      capturedAt: CAPTURED,
      createdBy: 'user',
      rawText: p,
    })).slice(0, 1).map((a) => ({ ...a, questionId: `${opts.region}.mechanism` })),
  });

  if (opts.closed) {
    applyMutations(ep.id, { status: 'resolved' });
  }
  return ep;
}

reset();

seedEpisode({
  region: 'knee', side: 'left',
  title: 'Left knee pain after long runs',
  quality: ['aching', 'stiffness'], triggers: ['stairs', 'exercise'],
  triggerDetail: 'Worse going down stairs, fine going up',
  durationValue: 2, durationUnit: 'weeks', trend: 'stable', onset: 'after_activity',
  point: { x: 0.41, y: 0.78 },
  activitiesAffected: ['going down stairs', 'sitting down for a long time'],
  selectedStructureIds: [],
  phrases: ['左膝盖外侧有点疼'],
  closed: true,
});

seedEpisode({
  region: 'knee', side: 'left',
  title: 'Left knee — recurrence after 4 months',
  quality: ['aching'], triggers: ['stairs'],
  triggerDetail: 'Same spot as before',
  durationValue: 3, durationUnit: 'days', trend: 'worsening', onset: 'gradual',
  point: { x: 0.41, y: 0.78 },
  activitiesAffected: ['going down stairs', 'getting out of a car'],
  selectedStructureIds: ['asi:knee.meniscus-medial'],
  phrases: ['又是左膝，同样的地方'],
  closed: false,
});

seedEpisode({
  region: 'lower_back', side: 'midline',
  title: 'Lower back after moving house',
  quality: ['pulling', 'stiffness'], triggers: ['lifting'],
  triggerDetail: 'Worse bending forward, better once moving',
  durationValue: 5, durationUnit: 'days', trend: 'improving', onset: 'after_activity',
  point: { x: 0.5, y: 0.62 },
  activitiesAffected: ['bending to pick things up', 'standing up from a chair'],
  selectedStructureIds: [],
  phrases: ['搬完家腰就酸了'],
  closed: true,
});

const episodes = (db.prepare('SELECT COUNT(*) AS n FROM episodes').get() as { n: number }).n;
const fields = (db.prepare('SELECT COUNT(*) AS n FROM episode_fields').get() as { n: number }).n;
const answers = (db.prepare('SELECT COUNT(*) AS n FROM episode_answers').get() as { n: number }).n;
const preserved = (db.prepare('SELECT COUNT(*) AS n FROM episode_assertions').get() as { n: number }).n;

console.log(`[seed] ${PERSON}: ${episodes} episodes, ${fields} field rows, ${answers} answers, ${preserved} preserved conflicts`);

// Print one summary so a developer can see the missingness behaviour for real:
// unasked fields must read "not asked", never a negative.
const rows = db.prepare('SELECT id FROM episodes ORDER BY started_at DESC').all() as { id: string }[];
const sample = rows[0];
if (sample) {
  const out = summaryFor(sample.id, 'development');
  if (out) console.log(renderPlainText(out.summary).split('\n').slice(0, 20).join('\n'));
}
