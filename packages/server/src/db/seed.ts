/**
 * Dev seed: one person, a small history in the left knee, so the health map and
 * "you have had this before" path have something to show on first run.
 */
import { emptyRecord } from '@asi/shared';
import { ensurePerson, createEpisode, saveRecord, appendTranscript, putProvenance, closeEpisode } from './store.ts';
import { db } from './client.ts';

const PERSON = 'local';

const userProv = (text?: string) => ({
  sourceType: 'user_statement' as const,
  verificationStatus: 'user_confirmed' as const,
  createdBy: 'user',
  capturedAt: new Date().toISOString(),
  rawText: text ?? null,
});

const clear = () => {
  db.exec('DELETE FROM field_provenance');
  db.exec('DELETE FROM safety_flags');
  db.exec('DELETE FROM transcripts');
  db.exec('DELETE FROM episodes');
  db.exec('DELETE FROM body_regions');
  db.exec('DELETE FROM persons');
};

function seedEpisode(opts: {
  region: 'knee' | 'shoulder' | 'lower_back' | 'neck';
  side: 'left' | 'right' | 'midline';
  subRegionId: string;
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
  phrases: string[];
  closed: boolean;
}) {
  const record = emptyRecord(opts.region);
  record.location = {
    ...record.location,
    side: opts.side,
    depth: 'deep',
    subRegionId: opts.subRegionId,
    point: opts.point,
    userPhrase: opts.phrases[0] ?? null,
    userConfirmedStructureIds: opts.region === 'knee' ? ['asi:knee.meniscus-medial'] : [],
  };
  record.quality = opts.quality as never;
  record.triggers = opts.triggers as never;
  record.triggerDetail = opts.triggerDetail;
  record.temporal = {
    ...record.temporal,
    onset: opts.onset,
    frequency: 'intermittent',
    trend: opts.trend,
    durationValue: opts.durationValue,
    durationUnit: opts.durationUnit,
    isRecurrence: true,
  };
  record.function = {
    ...record.function,
    intensity: 5,
    sleepAffected: 'slightly',
    activitiesAffected: opts.activitiesAffected,
  };

  const ep = createEpisode({
    personId: PERSON,
    displayName: 'Me',
    region: opts.region,
    side: opts.side,
    record,
    title: opts.title,
    userPhrase: opts.phrases[0],
  });

  putProvenance(ep.id, 'location.side', userProv(opts.phrases[0]));
  putProvenance(ep.id, 'location.depth', userProv());
  putProvenance(ep.id, 'quality', userProv());
  putProvenance(ep.id, 'triggers', userProv());
  putProvenance(ep.id, 'location.userConfirmedStructureIds', {
    sourceType: 'user_selection',
    verificationStatus: 'user_confirmed',
    createdBy: 'user',
    capturedAt: new Date().toISOString(),
  });
  putProvenance(ep.id, 'triggerDetail', {
    sourceType: 'ai_inference',
    verificationStatus: 'unverified',
    createdBy: 'seed',
    capturedAt: new Date().toISOString(),
    confidence: 0.5,
  });

  for (const p of opts.phrases) appendTranscript(ep.id, 'user', p);
  if (opts.closed) {
    closeEpisode(ep.id);
  }
  return saveRecord(ep.id, record);
}

clear();
ensurePerson(PERSON, 'Me');

seedEpisode({
  region: 'knee', side: 'left', subRegionId: 'knee.anterior',
  title: 'Left knee pain after long runs',
  quality: ['aching', 'stiffness'], triggers: ['stairs', 'exercise'],
  triggerDetail: 'Worse going down stairs, fine going up',
  durationValue: 2, durationUnit: 'weeks', trend: 'stable', onset: 'after_activity',
  point: { x: 0.41, y: 0.78 },
  activitiesAffected: ['going down stairs', 'sitting down for a long time'],
  phrases: ['左膝盖外侧有点疼', 'downstairs is worse than upstairs'],
  closed: true,
});

seedEpisode({
  region: 'knee', side: 'left', subRegionId: 'knee.anterior',
  title: 'Left knee — recurrence after 4 months',
  quality: ['aching'], triggers: ['stairs'],
  triggerDetail: 'Same spot as before',
  durationValue: 3, durationUnit: 'days', trend: 'worsening', onset: 'gradual',
  point: { x: 0.41, y: 0.78 },
  activitiesAffected: ['going down stairs', 'getting out of a car'],
  phrases: ['又是左膝，同样的地方'],
  closed: false,
});

seedEpisode({
  region: 'lower_back', side: 'midline', subRegionId: 'lower_back.central',
  title: 'Lower back after moving house',
  quality: ['pulling', 'stiffness'], triggers: ['lifting'],
  triggerDetail: 'Worse bending forward, better once moving',
  durationValue: 5, durationUnit: 'days', trend: 'improving', onset: 'after_activity',
  point: { x: 0.5, y: 0.62 },
  activitiesAffected: ['bending to pick things up', 'standing up from a chair'],
  phrases: ['搬完家腰就酸了', 'bending forward is the worst'],
  closed: true,
});

const count = (db.prepare('SELECT COUNT(*) AS n FROM episodes').get() as { n: number }).n;
const prov = (db.prepare('SELECT COUNT(*) AS n FROM field_provenance').get() as { n: number }).n;
console.log(`[seed] ${PERSON}: ${count} episodes, ${prov} provenance rows`);
