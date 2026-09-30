/**
 * Writable field registry.
 *
 * The bug this fixes: `POST /api/episodes` and `PATCH /api/episodes/:id/record`
 * accepted a whole client-supplied `SymptomRecord` and wrote it to
 * `record_json` verbatim, while `POST .../confirm` wrote provenance rows
 * SEPARATELY. Nothing tied the two together, so:
 *
 *   - a client could persist values with no provenance at all, and
 *   - a client could persist values and then separately assert "user_confirmed"
 *     provenance for fields it had merely guessed at.
 *
 * Value and provenance were two independent writes, so they could diverge.
 *
 * The fix: this registry is the ONLY place a field can be named, and it binds
 * each field to a validator and an explicit provenance strategy. The single
 * atomic mutation path in the store consults it, validates the value, validates
 * the provenance, and writes both in one transaction.
 *
 * FIELDS WITH NO PROVENANCE are listed explicitly in DERIVED_FIELD_PATHS with a
 * reason. A field is either here with a strategy, or in that list with a reason.
 * There is no third option, and a test enforces completeness.
 */
import { z } from 'zod';
import type { ClaimClass, Provenance, SourceType } from './provenance.ts';
import {
  BodyRegionSchema,
  ConsideredStructureSchema,
  DepthSchema,
  SideSchema,
} from './anatomy.ts';
import { QualitySchema, TriggerSchema } from './symptom.ts';

export type ProvenanceStrategy =
  | 'user_grounded' // must come from a real user action; cannot be AI-sourced
  | 'user_stated' // user said it; AI may propose but cannot own it
  | 'rule_derived' // written only by our own deterministic code
  | 'mixed'; // genuinely several sources, ranked by claim class

export interface FieldPolicy {
  /** Dotted path into SymptomRecord. */
  path: string;
  /** Runtime validator. Rejects unknown shapes before anything is written. */
  schema: z.ZodTypeAny;
  claimClass: ClaimClass;
  strategy: ProvenanceStrategy;
  /**
   * When true, a value may only be written with a source type that can
   * legitimately produce a user-grounded fact. This is the switch that stops a
   * client from manufacturing "the user confirmed this".
   */
  requiresUserSource: boolean;
  /** Source types accepted for a write to this field. */
  allowedSources: readonly SourceType[];
  /** Why this field exists / what it means. Surfaced in the docs. */
  note: string;
}

const nullishString = z.string().nullish();
const pointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullish();
const structureIdList = z.array(z.string()).max(64);
const stringList = z.array(z.string().max(2000)).max(64);

/** Every field a client may write. Anything not listed is rejected. */
export const FIELD_POLICIES: readonly FieldPolicy[] = Object.freeze([
  {
    path: 'location.region',
    schema: BodyRegionSchema,
    claimClass: 'location_anatomical',
    strategy: 'user_grounded',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_selection', 'user_edited', 'ai_inference'],
    note: 'Which body region. AI may propose; the user must land on it. Never defaulted server-side.',
  },
  {
    path: 'location.side',
    schema: SideSchema,
    claimClass: 'location_anatomical',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_selection', 'user_edited', 'ai_inference'],
    note: 'Left/right/midline. "unknown" is a real, displayable value and must not be a silent default.',
  },
  {
    path: 'location.depth',
    schema: DepthSchema,
    claimClass: 'location_anatomical',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_selection', 'user_edited', 'ai_inference'],
    note: 'Patient-reported depth. Perception of depth is not a measurement and must not be stored as one.',
  },
  {
    path: 'location.subRegionId',
    schema: z.string().nullish(),
    claimClass: 'location_anatomical',
    strategy: 'user_grounded',
    requiresUserSource: true,
    allowedSources: ['user_selection', 'user_statement', 'user_edited'],
    note: 'Set by clicking the body map. The most user-grounded field in the record.',
  },
  {
    path: 'location.userPhrase',
    schema: z.string().max(2000).nullish(),
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'ai_inference'],
    note: "The patient's own words, kept verbatim. AI may transcribe but may not rewrite it.",
  },
  {
    path: 'location.point',
    schema: pointSchema,
    claimClass: 'location_anatomical',
    strategy: 'user_grounded',
    requiresUserSource: true,
    allowedSources: ['user_selection', 'user_edited'],
    note: 'Normalised map coordinate. Only ever set by a map interaction.',
  },
  {
    path: 'location.userSelectedStructureIds',
    schema: structureIdList,
    claimClass: 'location_anatomical',
    strategy: 'user_grounded',
    requiresUserSource: true,
    allowedSources: ['user_selection', 'user_edited'],
    note:
      'VISUAL SELECTION ONLY: structures the user pointed at on the model. ' +
      'Not a finding, not a diagnosis site. AI may never write this field.',
  },
  {
    path: 'consideredStructures',
    schema: z.array(ConsideredStructureSchema).max(32),
    claimClass: 'derived',
    strategy: 'mixed',
    requiresUserSource: false,
    allowedSources: ['ai_inference', 'system_rule', 'user_selection', 'user_edited'],
    note: 'Model candidates plus their selection state. Candidates are never promoted here implicitly.',
  },
  {
    path: 'quality',
    schema: z.array(QualitySchema).max(16),
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited', 'ai_inference', 'clinician_confirmed'],
    note: 'Sensation descriptors. Subjective: a device or lab result may never overwrite this.',
  },
  {
    path: 'triggers',
    schema: z.array(TriggerSchema).max(16),
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited', 'ai_inference', 'clinician_confirmed'],
    note: 'Provoking factors. Subjective.',
  },
  {
    path: 'triggerDetail',
    schema: z.string().max(2000).nullish(),
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited', 'ai_inference'],
    note: 'Free text, usually the user\'s own phrasing of the provoking movement.',
  },
  {
    path: 'radiation',
    schema: stringList,
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited', 'ai_inference', 'clinician_confirmed'],
    note: 'Where the sensation travels. Subjective.',
  },
  {
    path: 'tendernessOnPalpation',
    schema: z.enum(['no', 'mild', 'moderate', 'severe', 'not_tested', 'unknown']),
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited'],
    note: "The user's own palpation finding. 'not_tested' is distinct from 'no'.",
  },
  {
    path: 'temporal.onset',
    schema: z.enum(['sudden', 'gradual', 'after_activity', 'after_injury', 'insidious', 'unknown']),
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited', 'ai_inference'],
    note: 'Onset pattern as recalled. Subjective.',
  },
  {
    path: 'temporal.durationValue',
    schema: z.number().nonnegative().nullish(),
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited'],
    note: 'How long. Null means not established, which must render as "not asked", never "0".',
  },
  {
    path: 'temporal.durationUnit',
    schema: z.enum(['minutes', 'hours', 'days', 'weeks', 'months', 'years']).nullish(),
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited'],
    note: 'Unit for durationValue. Independent of whether a duration was ever given.',
  },
  {
    path: 'temporal.frequency',
    schema: z.enum(['constant', 'most_of_day', 'intermittent', 'episodic', 'unknown']),
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited', 'ai_inference'],
    note: 'How often. ' + "'unknown' means not established.",
  },
  {
    path: 'temporal.trend',
    schema: z.enum(['improving', 'stable', 'worsening', 'fluctuating', 'unknown']),
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited', 'ai_inference'],
    note: 'Direction over time. Subjective.',
  },
  {
    path: 'temporal.isRecurrence',
    schema: z.boolean(),
    claimClass: 'symptom_subjective',
    strategy: 'mixed',
    requiresUserSource: false,
    allowedSources: ['user_statement', 'user_edited', 'system_rule'],
    note: 'The user may say yes; the store also sets it when a prior episode exists. Never AI-asserted.',
  },
  {
    path: 'function.intensity',
    schema: z.number().min(0).max(10).nullish(),
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited'],
    note: 'Self-reported 0-10. Never used alone and never treated as a measurement.',
  },
  {
    path: 'function.activitiesAffected',
    schema: stringList,
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited', 'ai_inference'],
    note: 'Functional impact in the user\'s own terms.',
  },
  {
    path: 'function.sleepAffected',
    schema: z.enum(['no', 'slightly', 'yes', 'severely']),
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited'],
    note: 'Sleep impact. The default "no" is a placeholder, not an answer — see summary coverage.',
  },
  {
    path: 'function.takesPainkiller',
    schema: z.enum(['no', 'occasional', 'regular', 'unknown']),
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited'],
    note: 'Analgesia use. Default "no" is a placeholder, not an answer.',
  },
  {
    path: 'function.unableWeighBearing',
    schema: z.enum(['no', 'partial', 'yes', 'unknown']),
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited'],
    note: 'Weight bearing. Default "no" is a placeholder, not an answer, and it is read by a safety rule.',
  },
  {
    path: 'context.recentInjury',
    schema: nullishString,
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited', 'ai_inference'],
    note: 'Mechanism. Free text, but never regex-matched by a safety rule.',
  },
  {
    path: 'context.recentActivity',
    schema: nullishString,
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited', 'ai_inference'],
    note: 'Preceding activity.',
  },
  {
    path: 'context.systemicSymptoms',
    schema: z.array(z.enum(['fever', 'chills', 'fatigue', 'weight_loss', 'night_sweats', 'nausea', 'dizziness', 'none'])).max(8),
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited', 'ai_inference'],
    note: 'Systemic features. The ["none"] default is a placeholder that must never be shown as "none reported".',
  },
  {
    path: 'context.medications',
    schema: stringList,
    claimClass: 'symptom_subjective',
    strategy: 'user_stated',
    requiresUserSource: true,
    allowedSources: ['user_statement', 'user_edited', 'external_record', 'clinician_confirmed'],
    note: 'Current medication. The one subjective field a clinician or record may legitimately contribute to.',
  },
  {
    path: 'context.priorConditions',
    schema: stringList,
    claimClass: 'clinical_conclusion',
    strategy: 'mixed',
    requiresUserSource: false,
    allowedSources: ['user_statement', 'user_edited', 'external_record', 'clinician_confirmed'],
    note: 'Prior conditions. A clinician or record outranks the user here — this is the opposite of a symptom.',
  },
  {
    path: 'context.relatedEpisodeIds',
    schema: z.array(z.string()).max(64),
    claimClass: 'derived',
    strategy: 'rule_derived',
    requiresUserSource: false,
    allowedSources: ['system_rule'],
    note: 'Computed by the store from the body-region index. A client may not write this.',
  },
]);

/**
 * Fields that legitimately carry no provenance, each with the reason. A client
 * can never write any of these.
 */
export const DERIVED_FIELD_PATHS: Readonly<Record<string, string>> = Object.freeze({
  'gaps':
    'Computed by the store from which registry fields have no stored value. ' +
    'Represents MISSING INFORMATION ONLY; a client may not write it.',
  'temporal.onsetAt':
    'Reserved for Phase 2 device import. Unused in V1, so it has no write path at all.',
  'temporal.pattern':
    'Reserved for Phase 2 device import (e.g. diurnal pattern from a wearable). Unused in V1.',
});

const POLICY_INDEX = new Map(FIELD_POLICIES.map((p) => [p.path, p] as const));

export function getFieldPolicy(path: string): FieldPolicy | undefined {
  return POLICY_INDEX.get(path);
}

/**
 * Parameter properties (`constructor(readonly x)`) are not supported by the
 * strip-only TypeScript mode this project runs under, so fields are declared
 * explicitly.
 */
export class FieldPolicyError extends Error {
  readonly path: string;
  constructor(message: string, path: string) {
    super(message);
    this.name = 'FieldPolicyError';
    this.path = path;
  }
}

/**
 * Validate a candidate write against the registry: the path must exist, the
 * value must satisfy the field's schema, and the provenance must be compatible.
 * Throws FieldPolicyError on any violation. Returns the validated value.
 */
export function assertFieldWrite(
  path: string,
  value: unknown,
  provenance: Provenance,
): unknown {
  const policy = getFieldPolicy(path);
  if (!policy) {
    throw new FieldPolicyError(
      `[field-policy] "${path}" is not a writable field. ` +
        `Every persisted field needs a declared provenance strategy.`,
      path,
    );
  }

  // The core of the anti-manufacture rule: a field the user must ground cannot
  // be written as a user fact by a source that is not the user. Checked before
  // the general allow-list so a model attempt gets the informative message.
  if (policy.requiresUserSource && provenance.sourceType === 'ai_inference') {
    throw new FieldPolicyError(
      `[field-policy] "${path}" is a user-grounded field and cannot be written by a model.`,
      path,
    );
  }
  if (policy.requiresUserSource && provenance.verificationStatus === 'clinician_confirmed'
      && provenance.sourceType !== 'clinician_confirmed' && provenance.sourceType !== 'external_record') {
    throw new FieldPolicyError(
      `[field-policy] "${path}": clinician_confirmed requires a clinician source type ` +
        `or an external record asserting it.`,
      path,
    );
  }

  if (!policy.allowedSources.includes(provenance.sourceType)) {
    throw new FieldPolicyError(
      `[field-policy] "${path}": sourceType "${provenance.sourceType}" may not write this field. ` +
        `Allowed: ${policy.allowedSources.join('|')}`,
      path,
    );
  }

  const parsed = policy.schema.safeParse(value);
  if (!parsed.success) {
    throw new FieldPolicyError(
      `[field-policy] "${path}": value rejected — ${parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`,
      path,
    );
  }
  return parsed.data;
}

/** All writable paths, for docs and for the completeness test. */
export function writablePaths(): string[] {
  return FIELD_POLICIES.map((p) => p.path).sort();
}

/**
 * A request to write one field. This is the ONLY shape a client may use to
 * change a record: a value plus its own provenance, validated together.
 *
 * It lives in shared rather than the server because the browser builds these
 * too, and both sides must agree on the shape or the client would be sending
 * something the store cannot validate.
 */
export interface FieldMutation {
  fieldPath: string;
  value: unknown;
  provenance: Omit<Provenance, 'capturedAt'> & { capturedAt?: string };
}
