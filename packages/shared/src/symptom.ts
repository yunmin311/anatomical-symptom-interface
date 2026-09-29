/**
 * Structured symptom record — the artefact the whole product exists to produce.
 *
 * Everything the user could ever say gets funnelled into these fields, and
 * every field keeps its own provenance. This is what makes a symptom
 * comparable across time, summarisable for a doctor, and honest about what is
 * felt vs inferred vs measured.
 */
import { z } from 'zod';
import { BodyRegionSchema, ConsideredStructureSchema, SideSchema, DepthSchema } from './anatomy.ts';

/* ---------------- Symptom attributes (§3.2) ---------------- */

/** Pain / sensation quality. Multi-select: people describe mixtures. */
export const QualitySchema = z.enum([
  'dull',
  'sharp',
  'burning',
  'throbbing',
  'pressure',
  'numbness',
  'tingling',
  'stiffness',
  'pulling',
  'cramping',
  'aching',
  'stabbing',
  'clicking',
  'instability',
  'swelling',
]);
export type Quality = z.infer<typeof QualitySchema>;

export const QUALITY_LABELS: Record<Quality, string> = {
  dull: 'Dull / aching',
  sharp: 'Sharp / knife-like',
  burning: 'Burning',
  throbbing: 'Throbbing / pulsing',
  pressure: 'Pressure / squeezing',
  numbness: 'Numb / dead feeling',
  tingling: 'Tingling / pins & needles',
  stiffness: 'Stiff / tight',
  pulling: 'Pulling / tugging',
  cramping: 'Cramping / spasm',
  aching: 'Aching',
  stabbing: 'Stabbing',
  clicking: 'Clicking / catching',
  instability: 'Giving way / unstable',
  swelling: 'Swelling',
};

/** What brings it on. */
export const TriggerSchema = z.enum([
  'movement',
  'specific_posture',
  'pressure',
  'lifting',
  'repetition',
  'exercise',
  'rest_relief',
  'night',
  'breathing',
  'eating',
  'coughing_sneezing',
  'load_bearing',
  'stairs',
  'unknown',
]);
export type Trigger = z.infer<typeof TriggerSchema>;

/** Symptom timing. */
export const TemporalSchema = z.object({
  onset: z.enum(['sudden', 'gradual', 'after_activity', 'after_injury', 'insidious', 'unknown']).default('unknown'),
  onsetAt: z.string().nullish(),
  durationValue: z.number().nonnegative().nullish(),
  durationUnit: z.enum(['minutes', 'hours', 'days', 'weeks', 'months', 'years']).nullish(),
  frequency: z.enum(['constant', 'most_of_day', 'intermittent', 'episodic', 'unknown']).default('unknown'),
  pattern: z.enum(['steady', 'worse_over_day', 'better_over_day', 'comes_and_goes', 'unknown']).default('unknown'),
  trend: z.enum(['improving', 'stable', 'worsening', 'fluctuating', 'unknown']).default('unknown'),
  /** True when the user reports this is a repeat of a previous episode. */
  isRecurrence: z.boolean().default(false),
});
export type Temporal = z.infer<typeof TemporalSchema>;

/** Functional impact. Deliberately separate from a single pain number (§3.2). */
export const FunctionImpactSchema = z.object({
  /** Free-form: "can't put my socks on", "no sleep", "missed work". */
  activitiesAffected: z.array(z.string()).default([]),
  sleepAffected: z.enum(['no', 'slightly', 'yes', 'severely']).default('no'),
  /** 0..10, user-reported. Kept but never used alone. */
  intensity: z.number().min(0).max(10).nullish(),
  takesPainkiller: z.enum(['no', 'occasional', 'regular', 'unknown']).default('no'),
  unableWeighBearing: z.enum(['no', 'partial', 'yes', 'unknown']).default('no'),
});
export type FunctionImpact = z.infer<typeof FunctionImpactSchema>;

/** Background context. */
export const ClinicalContextSchema = z.object({
  recentInjury: z.string().nullish(),
  recentActivity: z.string().nullish(),
  systemicSymptoms: z.array(z.enum(['fever', 'chills', 'fatigue', 'weight_loss', 'night_sweats', 'nausea', 'dizziness', 'none'])).default(['none']),
  medications: z.array(z.string()).default([]),
  priorConditions: z.array(z.string()).default([]),
  /** Episode ids for the same region, for the timeline. */
  relatedEpisodeIds: z.array(z.string()).default([]),
});
export type ClinicalContext = z.infer<typeof ClinicalContextSchema>;

/* ---------------- The record ---------------- */

export const SymptomRecordSchema = z.object({
  location: z.object({
    region: BodyRegionSchema,
    side: SideSchema,
    depth: DepthSchema,
    subRegionId: z.string().nullish(),
    userPhrase: z.string().nullish(),
    /** The single coordinate the user actually pinned. */
    point: z.object({ x: z.number(), y: z.number() }).nullish(),
    /**
     * Structures the user explicitly confirmed on the model. These are facts.
     * Distinct from `consideredStructures`, which are only candidates.
     */
    userConfirmedStructureIds: z.array(z.string()).default([]),
  }),
  consideredStructures: z.array(ConsideredStructureSchema).default([]),
  quality: z.array(QualitySchema).default([]),
  triggers: z.array(TriggerSchema).default([]),
  /** Free-text trigger detail: "arm up past 90 degrees", "after sitting 2h". */
  triggerDetail: z.string().nullish(),
  radiation: z.array(z.string()).default([]),
  tendernessOnPalpation: z.enum(['no', 'mild', 'moderate', 'severe', 'not_tested', 'unknown']).default('unknown'),
  temporal: TemporalSchema,
  function: FunctionImpactSchema,
  context: ClinicalContextSchema,
  /** Unanswered fields, so the UI can show "3 things we didn't ask about". */
  gaps: z.array(z.string()).default([]),
});
export type SymptomRecord = z.infer<typeof SymptomRecordSchema>;

/** An episode: one episode = one Symptom Record, possibly across many turns. */
export const EpisodeSchema = z.object({
  id: z.string(),
  personId: z.string(),
  region: BodyRegionSchema,
  side: SideSchema,
  status: z.enum(['open', 'resolved', 'ongoing', 'archived']).default('open'),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullish(),
  title: z.string(),
  record: SymptomRecordSchema,
  /** Every field's provenance, keyed by dotted path. */
  provenance: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** Red-flag / safety flags raised for this episode. */
  safetyFlags: z.array(z.object({
    ruleId: z.string(),
    severity: z.enum(['info', 'caution', 'urgent', 'emergency']),
    reason: z.string(),
    ruleReviewStatus: z.string(),
  })).default([]),
});
export type Episode = z.infer<typeof EpisodeSchema>;

/* ---------------- factories ---------------- */

export function emptyRecord(region: z.infer<typeof BodyRegionSchema> = 'shoulder'): SymptomRecord {
  return SymptomRecordSchema.parse({
    location: { region, side: 'unknown', depth: 'unknown', subRegionId: null, userPhrase: null, point: null, userConfirmedStructureIds: [] },
    consideredStructures: [],
    quality: [],
    triggers: [],
    triggerDetail: null,
    radiation: [],
    tendernessOnPalpation: 'unknown',
    temporal: {},
    function: {},
    context: {},
    gaps: [],
  });
}
