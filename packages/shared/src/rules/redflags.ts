/**
 * Red-flag rule engine.
 *
 * DESIGN CONSTRAINT (non-negotiable, see product plan §8):
 * Emergency and urgent safety messaging is produced by explicit, reviewable
 * rules — NEVER by free-form LLM reasoning. A model may help a user *say*
 * something; it may not decide whether someone should go to an emergency
 * department.
 *
 * Every rule therefore carries review metadata. `reviewStatus` starts as
 * 'unreviewed' and the server refuses to surface un-reviewed emergency rules in
 * a production profile. This is deliberate friction: shipping an unreviewed
 * red-flag rule to real users is a clinical safety event.
 */
import { z } from 'zod';
import type { SymptomRecord } from '../symptom.ts';
import type { BodyRegion } from '../anatomy.ts';

export const SeveritySchema = z.enum(['info', 'caution', 'urgent', 'emergency']);
export type Severity = z.infer<typeof SeveritySchema>;

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 10,
  caution: 20,
  urgent: 30,
  emergency: 40,
};

export interface RedFlagRule {
  id: string;
  /** Which regions this rule can fire in. 'any' = applies everywhere. */
  scope: BodyRegion[] | 'any';
  severity: Severity;
  title: string;
  /** Plain, non-alarming, non-diagnostic wording. What to do, not what it is. */
  userMessage: string;
  /** What to do next, in order. */
  actionSteps: string[];
  /**
   * Predicate over the record. MUST be a pure, total function. Returning true
   * means "ask the user to seek care", never "the user has condition X".
   */
  when: (record: SymptomRecord) => boolean;
  review: {
    status: 'unreviewed' | 'clinically_reviewed';
    reviewedBy?: string;
    reviewedAt?: string;
    /** Guideline / source this rule was derived from. Be specific. */
    basis: string;
  };
}

export interface SafetyFlag {
  ruleId: string;
  severity: Severity;
  title: string;
  userMessage: string;
  actionSteps: string[];
  reviewStatus: RedFlagRule['review']['status'];
}

/* ------------------------------------------------------------------ */
/* MSK rules                                                           */
/* ------------------------------------------------------------------ */

const isTrue = (v: unknown) => v === true;
const hasSystemic = (record: SymptomRecord) =>
  record.context.systemicSymptoms.some((s) =>
    ['fever', 'chills', 'weight_loss', 'night_sweats'].includes(s),
  );
const isNumbnessPresent = (record: SymptomRecord) =>
  record.quality.includes('numbness') ||
  record.radiation.some((r) => /numb|tingl|saddle|saddle/i.test(r)) ||
  record.gaps.includes('asked:numbness');

export const MSK_RULES: RedFlagRule[] = [
  {
    id: 'msk.cauda_equina',
    scope: 'any',
    severity: 'emergency',
    title: 'Possible pressure on the nerves at the base of the spine',
    userMessage:
      'The combination you have described can be a sign of pressure on the nerves in the lower spine. This needs assessment urgently — waiting can make it worse and harder to treat.',
    actionSteps: [
      'Go to an emergency department now, or call your local emergency number.',
      'Do not wait to see whether it improves by itself.',
      'Bring this summary and any list of medicines you take.',
    ],
    when: (r) =>
      (isNumbnessPresent(r) && /saddle|between.*legs|groin.*numb|bottom/i.test(r.gaps.join(' ') + r.radiation.join(' '))) ||
      /bladder|bowel|urinat|continence|toilet/i.test(r.gaps.join(' ') + r.function.activitiesAffected.join(' ')) ||
      /bladder|bowel|urinat|continence/i.test(r.triggerDetail ?? ''),
    review: { status: 'unreviewed', basis: 'Cauda equina red flags as taught in standard MSK primary care assessment; MUST be verified against current national guidance before release.' },
  },
  {
    id: 'msk.neck_trauma_neuro',
    scope: ['neck', 'shoulder'],
    severity: 'emergency',
    title: 'Neck injury with neurological symptoms',
    userMessage:
      'A neck injury together with weakness, numbness, or trouble walking needs immediate assessment.',
    actionSteps: [
      'Go to an emergency department now.',
      'Avoid moving your neck; keep it still in whatever position is comfortable.',
      'Do not drive yourself if you have any weakness or dizziness.',
    ],
    when: (r) =>
      /whiplash|fall|jolt|injur/i.test(r.context.recentInjury ?? r.context.recentActivity ?? '') &&
      (isNumbnessPresent(r) || r.quality.includes('instability') || r.function.unableWeighBearing !== 'no'),
    review: { status: 'unreviewed', basis: 'Trauma + neurological deficit pathway; verify against current national guidance before release.' },
  },
  {
    id: 'msk.trauma_deformity_no_lift',
    scope: ['shoulder', 'knee'],
    severity: 'urgent',
    title: 'Trauma with loss of movement',
    userMessage:
      'An injury where you cannot move the joint normally, or where it looks deformed, should be looked at today.',
    actionSteps: [
      'Arrange to be seen today by a clinician or urgent care service.',
      'Do not force the joint to move.',
      'If there is an open wound, bleeding, or visible deformity, go to an emergency department.',
    ],
    when: (r) =>
      /injur|fall|hit|tackle|pop|knock/i.test(r.context.recentInjury ?? r.context.recentActivity ?? '') &&
      (r.function.unableWeighBearing !== 'no' || r.function.activitiesAffected.length > 0),
    review: { status: 'unreviewed', basis: 'Acute joint injury with functional loss; verify against current national guidance before release.' },
  },
  {
    id: 'msk.hot_joint_fever',
    scope: ['knee', 'shoulder'],
    severity: 'urgent',
    title: 'Hot swollen joint with signs of infection',
    userMessage:
      'A hot, swollen joint together with fever or feeling generally unwell can mean an infection inside the joint. That is time-sensitive.',
    actionSteps: [
      'Seek medical assessment today — an urgent care service or emergency department.',
      'Do not wait for it to settle on its own.',
      'Tell the clinician straight away that you have fever and a swollen joint.',
    ],
    when: (r) => isTrue(hasSystemic(r)) && (r.quality.includes('swelling') || r.gaps.includes('asked:hot_joint')),
    review: { status: 'unreviewed', basis: 'Suspected septic arthritis is a time-critical presentation; verify against current national guidance before release.' },
  },
  {
    id: 'msk.cold_pale_hand',
    scope: ['shoulder', 'neck'],
    severity: 'urgent',
    title: 'Cold or pale hand',
    userMessage:
      'A hand that is cold, pale, or markedly numb on one side can indicate a problem with blood flow that should be checked promptly.',
    actionSteps: [
      'Arrange assessment today.',
      'Remove rings and tight items from that hand immediately.',
      'If the hand suddenly goes pale, blue, or cold and painful, go to an emergency department.',
    ],
    when: (r) =>
      isNumbnessPresent(r) && /cold|pale|white|blue/i.test(r.triggerDetail ?? r.quality.join(' ')) ||
      /cold|pale/i.test(r.radiation.join(' ')),
    review: { status: 'unreviewed', basis: 'Vascular compromise of the upper limb; verify against current national guidance before release.' },
  },
  {
    id: 'msk.systemic_symptoms',
    scope: 'any',
    severity: 'urgent',
    title: 'Musculoskeletal pain with systemic symptoms',
    userMessage:
      'Pain in a muscle or joint together with unexplained weight loss, fever, or night sweats is not routine and should be checked by a clinician.',
    actionSteps: [
      'Book to see a clinician soon, and mention these symptoms explicitly.',
      'Keep a note of your temperature and any weight change.',
    ],
    when: (r) =>
      hasSystemic(r) && (r.temporal.trend === 'worsening' || r.temporal.isRecurrence || r.temporal.durationValue != null),
    review: { status: 'unreviewed', basis: 'Systemic features with MSK pain; verify against current national guidance before release.' },
  },
  {
    id: 'msk.silent_tear',
    scope: ['knee', 'shoulder'],
    severity: 'caution',
    title: 'An inability to feel this area at all',
    userMessage:
      'Not being able to feel a limb or joint at all can happen with nerve damage or a severe injury, and deserves checking.',
    actionSteps: ['Arrange to be assessed within 24 hours.', 'Do not rely on that limb for balance.'],
    when: (r) => r.quality.includes('numbness') && r.function.unableWeighBearing !== 'no',
    review: { status: 'unreviewed', basis: 'Neurological deficit accompanying MSK presentation.' },
  },
  {
    id: 'msk.chronic_persistent',
    scope: 'any',
    severity: 'info',
    title: 'This has been going on a while',
    userMessage:
      'Symptoms lasting more than about six weeks are worth having looked at, even if they are not severe.',
    actionSteps: ['Book a routine appointment.', 'Bring the timeline from this app so you do not have to reconstruct it.'],
    when: (r) =>
      (r.temporal.durationUnit === 'weeks' && (r.temporal.durationValue ?? 0) >= 6) ||
      (r.temporal.durationUnit === 'months' && (r.temporal.durationValue ?? 0) >= 1),
    review: { status: 'unreviewed', basis: 'Six-week persistent pain is a widely used review threshold; verify locally.' },
  },
];

export const ALL_RULES: RedFlagRule[] = MSK_RULES;

const RULE_INDEX = new Map(ALL_RULES.map((r) => [r.id, r] as const));

export function getRule(id: string): RedFlagRule | undefined {
  return RULE_INDEX.get(id);
}

/**
 * Evaluate all applicable rules. Deterministic, offline, <1ms.
 *
 * NOTE ON WHAT THIS IS NOT: a positive rule match means "this presentation
 * warrants prompt human assessment". It is NOT a diagnosis, NOT a probability,
 * and must never be rendered as "you probably have X".
 */
export function evaluateRedFlags(
  record: SymptomRecord,
  opts: { region?: BodyRegion; requireReviewed?: boolean } = {},
): SafetyFlag[] {
  const scope = opts.region ?? record.location.region;
  const flags: SafetyFlag[] = [];

  for (const rule of ALL_RULES) {
    if (rule.scope !== 'any' && !rule.scope.includes(scope)) continue;
    if (opts.requireReviewed && rule.review.status !== 'clinically_reviewed') continue;
    let fired = false;
    try {
      fired = rule.when(record);
    } catch {
      // A throwing predicate must never take down the session.
      fired = false;
    }
    if (!fired) continue;
    flags.push({
      ruleId: rule.id,
      severity: rule.severity,
      title: rule.title,
      userMessage: rule.userMessage,
      actionSteps: rule.actionSteps,
      reviewStatus: rule.review.status,
    });
  }

  return flags.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

/** Highest severity present, or null. Drives the UI banner colour. */
export function highestSeverity(flags: SafetyFlag[]): Severity | null {
  if (!flags.length) return null;
  return flags.reduce((acc, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[acc] ? f.severity : acc), flags[0]!.severity);
}

/** Count of rules still awaiting clinical sign-off. Surfaced in the admin panel. */
export function unreviewedRuleCount(): number {
  return ALL_RULES.filter((r) => r.review.status !== 'clinically_reviewed').length;
}
