/**
 * Red-flag rule engine.
 *
 * DESIGN CONSTRAINT (non-negotiable, see product plan §8 and ADR 0003):
 * Emergency and urgent safety messaging is produced by explicit, reviewable
 * rules — NEVER by free-form LLM reasoning. A model may help a user *say*
 * something; it may not decide whether someone should go to an emergency
 * department.
 *
 * Three properties this file guarantees:
 *
 *  1. RULES READ TYPED SIGNALS, NOT TEXT. Every predicate takes a
 *     `SafetySignals` object with four-state values. No rule contains a regex
 *     over user text. Previously rules scraped `record.gaps` and
 *     `activitiesAffected`, which meant a yes and a no were indistinguishable
 *     and an unrelated question id could trigger a rule.
 *
 *  2. RULES CARRY REVIEW METADATA THAT DEFAULTS TO 'unreviewed'. Shipping an
 *     unreviewed safety rule to real users is a clinical safety event.
 *
 *  3. THE RELEASE PROFILE CANNOT SILENTLY DROP A FIRED RULE. In `release`, a
 *     fired-but-unreviewed rule is WITHHELD from user-facing output and
 *     reported in `withheld`, escalating to `blocked` when its severity is
 *     urgent or emergency. Silently returning a shorter flag list would be
 *     worse than failing loudly.
 */
import { z } from 'zod';
import type { SymptomRecord } from '../symptom.ts';
import type { BodyRegion } from '../anatomy.ts';
import type { SafetySignals, SignalName } from '../safety-signals.ts';
import { NO_SIGNALS, SIGNAL_NAMES as ALL_SIGNAL_NAMES, signalsFromAnswers } from '../safety-signals.ts';
import type { AnswerMap } from '../answers.ts';

export const SeveritySchema = z.enum(['info', 'caution', 'urgent', 'emergency']);
export type Severity = z.infer<typeof SeveritySchema>;

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 10,
  caution: 20,
  urgent: 30,
  emergency: 40,
};

/**
 * A rule is a total function over (record, signals). It never reads free text
 * and never returns a probability.
 */
export interface RedFlagRule {
  id: string;
  scope: BodyRegion[] | 'any';
  severity: Severity;
  title: string;
  /**
   * Non-diagnostic, non-alarming, non-patronising wording. Says what to do,
   * never what the user has. A test asserts banned diagnostic phrasings never
   * appear in any userMessage.
   */
  userMessage: string;
  actionSteps: string[];
  /**
   * True means "this presentation warrants prompt human assessment". NEVER
   * "the user has condition X".
   */
  when: (record: SymptomRecord, signals: SafetySignals) => boolean;
  /**
   * Explicitly declared signals this rule reads. Asserted against the rule
   * body by a test, so a rule cannot quietly start (or stop) depending on a
   * signal without the declaration being updated.
   */
  signalsUsed: readonly SignalName[];
  review: {
    status: 'unreviewed' | 'clinically_reviewed';
    reviewedBy?: string;
    reviewedAt?: string;
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

/** A rule that fired but must not be shown to a user in this profile. */
export interface WithheldFlag {
  ruleId: string;
  severity: Severity;
  reviewStatus: RedFlagRule['review']['status'];
  reason: string;
}

export type ReleaseProfile = 'development' | 'release';

export interface SafetyEvaluation {
  /** Safe to render to a user under the active profile. */
  flags: SafetyFlag[];
  /** Fired but deliberately not rendered, with the reason. Never empty silently. */
  withheld: WithheldFlag[];
  /**
   * True when a rule of urgent/emergency severity fired but is not clinically
   * reviewed. In `release` this is a hard stop: the record must not be
   * presented as if it had been safely assessed.
   */
  blocked: boolean;
  profile: ReleaseProfile;
  /** Every signal value the rules saw, for audit. */
  signals: SafetySignals;
}

/* ------------------------------------------------------------------ */
/* Signal helpers                                                      */
/* ------------------------------------------------------------------ */

const yes = (s: SafetySignals, k: keyof SafetySignals) => s[k] === 'yes';

/** Answers were requested but left indeterminate. Rules may use this to be
 * conservative; it is never treated as reassurance. */
const indeterminate = (s: SafetySignals, k: keyof SafetySignals) => s[k] === 'unknown';

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

export const MSK_RULES: RedFlagRule[] = [
  {
    id: 'msk.cauda_equina',
    scope: 'any',
    severity: 'emergency',
    title: 'Possible pressure on the nerves at the base of the spine',
    userMessage:
      'What you have described can be a sign of pressure on the nerves in the lower spine. ' +
      'This needs assessment urgently — waiting can make it harder to treat.',
    actionSteps: [
      'Go to an emergency department now, or call your local emergency number.',
      'Do not wait to see whether it settles on its own.',
      'Bring this summary and any list of medicines you take.',
    ],
    signalsUsed: ['bladder_or_bowel_change', 'saddle_numbness', 'leg_weakness'],
    when: (_r, s) =>
      // Any reported bladder/bowel change is taken at face value. A separate
      // false-positive is far less harmful than a missed presentation.
      yes(s, 'bladder_or_bowel_change') ||
      // Saddle anaesthesia plus leg weakness, the other classic pairing.
      (yes(s, 'saddle_numbness') && yes(s, 'leg_weakness')),
    review: {
      status: 'unreviewed',
      basis:
        'Cauda equina red flags as taught in standard MSK primary care assessment. ' +
        'MUST be verified against current national guidance before any release.',
    },
  },
  {
    id: 'msk.neck_trauma_neuro',
    scope: ['neck', 'shoulder'],
    severity: 'emergency',
    title: 'Injury with weakness or numbness',
    userMessage:
      'An injury together with weakness, numbness, or difficulty moving needs immediate assessment.',
    actionSteps: [
      'Go to an emergency department now.',
      'Keep the injured area still in whatever position is comfortable.',
      'Do not drive yourself if you have any weakness or dizziness.',
    ],
    signalsUsed: ['neck_trauma_with_neuro_symptoms', 'trauma_with_loss_of_movement'],
    when: (r, s) =>
      yes(s, 'neck_trauma_with_neuro_symptoms') ||
      (yes(s, 'trauma_with_loss_of_movement') && r.quality.includes('numbness')),
    /*
      The same severity, the same signals, and the same trigger -- stated in terms of the
      body part the patient actually described.

      `shoulder.trauma_urgent` drives `trauma_with_loss_of_movement`, so this rule fires on
      shoulder episodes, and it used to open with "A neck injury together with...". The
      guidance was right and the subject was wrong: it told a shoulder patient to keep
      their NECK still.

      Neutral wording is enough rather than a per-region message map, because neither
      region needs naming here -- and a mechanism for per-region messages would be an
      unused field, which invites the next person to believe region-specific wording is
      handled when it is not.

      Nothing clinical changed. Same scope, same 'emergency', same two signals, same
      predicate -- so if this rule should have fired for a shoulder patient before, it
      still fires, and still escalates to `blocked` under the release profile. Both are
      asserted in shoulder-interview-semantics.test.ts, because "I only changed a string"
      is not a claim that should be taken on trust for an emergency rule.
    */
    review: {
      status: 'unreviewed',
      basis: 'Trauma with neurological deficit pathway. Verify against current national guidance before release.',
    },
  },
  {
    id: 'msk.trauma_deformity_no_lift',
    scope: ['shoulder', 'knee'],
    severity: 'urgent',
    title: 'Injury with loss of movement',
    userMessage:
      'An injury where you cannot move the joint normally, or where it looks deformed, should be looked at today.',
    actionSteps: [
      'Arrange to be seen today by a clinician or urgent care service.',
      'Do not force the joint to move.',
      'If there is an open wound, bleeding, or visible deformity, go to an emergency department.',
    ],
    signalsUsed: ['trauma_with_loss_of_movement', 'weight_bearing_lost'],
    when: (_r, s) => yes(s, 'trauma_with_loss_of_movement') || yes(s, 'weight_bearing_lost'),
    review: {
      status: 'unreviewed',
      basis: 'Acute joint injury with functional loss. Verify against current national guidance before release.',
    },
  },
  {
    id: 'msk.hot_joint_fever',
    scope: ['knee', 'shoulder'],
    severity: 'urgent',
    title: 'Hot swollen joint with signs of infection',
    userMessage:
      'A hot, swollen joint together with fever or feeling generally unwell can mean an infection inside the joint. ' +
      'That is time-sensitive.',
    actionSteps: [
      'Seek medical assessment today — an urgent care service or an emergency department.',
      'Do not wait for it to settle on its own.',
      'Tell the clinician straight away that you have fever and a swollen joint.',
    ],
    signalsUsed: ['hot_red_swollen_joint', 'fever_or_systemic_unwell'],
    when: (r, s) =>
      // Either the explicit combined question, or the two halves arriving via
      // separate questions. Swelling alone is not enough; a hot swollen joint
      // with fever is the presentation of concern.
      yes(s, 'hot_red_swollen_joint') ||
      (yes(s, 'fever_or_systemic_unwell') && r.quality.includes('swelling')),
    review: {
      status: 'unreviewed',
      basis:
        'Suspected septic arthritis is a time-critical presentation. Verify against current national guidance before release.',
    },
  },
  {
    id: 'msk.cold_pale_hand',
    scope: ['shoulder', 'neck'],
    severity: 'urgent',
    title: 'Cold or pale hand',
    userMessage:
      'A hand that is cold, pale, or markedly numb on one side can mean a problem with blood flow, and should be checked promptly.',
    actionSteps: [
      'Arrange assessment today.',
      'Take rings and tight items off that hand now.',
      'If the hand suddenly turns pale, blue, or cold and painful, go to an emergency department.',
    ],
    signalsUsed: ['cold_pale_or_numb_hand'],
    when: (_r, s) => yes(s, 'cold_pale_or_numb_hand'),
    review: {
      status: 'unreviewed',
      basis: 'Upper-limb vascular compromise. Verify against current national guidance before release.',
    },
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
      'Keep a note of your temperature and any change in weight.',
    ],
    signalsUsed: ['fever_or_systemic_unwell'],
    when: (r, s) =>
      (yes(s, 'fever_or_systemic_unwell') || indeterminate(s, 'fever_or_systemic_unwell')) &&
      (r.temporal.trend === 'worsening' || r.temporal.isRecurrence || r.temporal.durationValue != null),
    review: {
      status: 'unreviewed',
      basis: 'Systemic features alongside MSK pain. Verify against current national guidance before release.',
    },
  },
  {
    id: 'msk.unable_to_bear_weight',
    scope: ['knee', 'lower_back', 'shoulder'],
    severity: 'urgent',
    title: 'Unable to put weight on the limb',
    userMessage:
      'Being unable to take your weight through a leg or joint needs checking, especially alongside injury or pain.',
    actionSteps: [
      'Arrange assessment today.',
      'Do not repeatedly test the limb by loading it.',
    ],
    signalsUsed: ['weight_bearing_lost'],
    when: (_r, s) => yes(s, 'weight_bearing_lost'),
    review: {
      status: 'unreviewed',
      basis: 'Complete loss of weight bearing. Verify against current national guidance before release.',
    },
  },
  {
    id: 'msk.joint_locking',
    scope: ['knee', 'shoulder'],
    severity: 'caution',
    title: 'Joint catching or giving way',
    userMessage:
      'A joint that catches, locks, or gives way can relate to structures inside the joint and is worth having looked at.',
    actionSteps: [
      'Book a routine appointment and mention that the joint catches or gives way.',
      'Avoid the movement that provokes it until you have been assessed.',
    ],
    signalsUsed: ['joint_locking_or_giving_way'],
    when: (_r, s) => yes(s, 'joint_locking_or_giving_way'),
    review: {
      status: 'unreviewed',
      basis: 'Mechanical locking or instability. Verify against current national guidance before release.',
    },
  },
  {
    id: 'msk.numbness_with_dysfunction',
    scope: ['knee', 'shoulder', 'lower_back'],
    severity: 'caution',
    title: 'Numbness together with loss of function',
    userMessage:
      'Numbness alongside a joint you cannot use normally can follow nerve damage or a significant injury, and deserves checking.',
    actionSteps: ['Arrange to be assessed within 24 hours.', 'Do not rely on that limb for balance.'],
    signalsUsed: ['cold_pale_or_numb_hand'],
    when: (r, s) => r.quality.includes('numbness') && r.function.unableWeighBearing !== 'no' && !yes(s, 'cold_pale_or_numb_hand'),
    review: {
      status: 'unreviewed',
      basis: 'Neurological deficit accompanying an MSK presentation. Verify before release.',
    },
  },
  {
    id: 'msk.chronic_persistent',
    scope: 'any',
    severity: 'info',
    title: 'This has been going on a while',
    userMessage:
      'Symptoms lasting more than about six weeks are worth having looked at, even when they are not severe.',
    actionSteps: [
      'Book a routine appointment.',
      'Bring the timeline from this tool so you do not have to reconstruct it from memory.',
    ],
    signalsUsed: [],
    when: (r, _s) =>
      (r.temporal.durationUnit === 'weeks' && (r.temporal.durationValue ?? 0) >= 6) ||
      (r.temporal.durationUnit === 'months' && (r.temporal.durationValue ?? 0) >= 1),
    review: {
      status: 'unreviewed',
      basis: 'Six-week persistent symptom review threshold is widely used. Verify the local threshold before release.',
    },
  },
];

export const ALL_RULES: RedFlagRule[] = MSK_RULES;

const RULE_INDEX = new Map(ALL_RULES.map((r) => [r.id, r] as const));

export function getRule(id: string): RedFlagRule | undefined {
  return RULE_INDEX.get(id);
}

/**
 * Urgent and emergency rules that read no interview signal at all. A test
 * asserts this list is empty, so every time-critical rule must be reachable
 * from a question a user can actually answer.
 */
export const RULES_WITHOUT_QUESTION_SIGNAL: readonly string[] = ALL_RULES.filter(
  (r) => (r.severity === 'urgent' || r.severity === 'emergency') && r.signalsUsed.length === 0,
).map((r) => r.id);

/** Signals that no rule reads. Guarded by a test so the table cannot rot. */
export const UNREAD_SIGNALS: readonly string[] = (() => {
  const used = new Set(ALL_RULES.flatMap((r) => [...r.signalsUsed]));
  return ALL_SIGNAL_NAMES.filter((name) => !used.has(name as (typeof ALL_SIGNAL_NAMES)[number]));
})();

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

export interface EvaluateOptions {
  region?: BodyRegion;
  answers?: AnswerMap;
  signals?: SafetySignals;
  /** 'development' shows unreviewed rules with a visible marker. */
  profile?: ReleaseProfile;
}

export function evaluateSafety(
  record: SymptomRecord,
  opts: EvaluateOptions = {},
): SafetyEvaluation {
  const profile = opts.profile ?? 'development';
  const scope = opts.region ?? record.location.region;
  // Region-scoped: a stale answer to another region's question must not set a
  // signal here. See signalsFromAnswers for why that matters for safety.
  const signals = opts.signals ?? (opts.answers ? signalsFromAnswers(opts.answers, scope) : NO_SIGNALS);

  const flags: SafetyFlag[] = [];
  const withheld: WithheldFlag[] = [];
  let blocked = false;

  for (const rule of ALL_RULES) {
    if (rule.scope !== 'any' && !rule.scope.includes(scope)) continue;

    let fired = false;
    try {
      fired = rule.when(record, signals);
    } catch {
      // A throwing predicate must never take down the session, and must never
      // be reported as "safe". Treat it as not-evaluated, not as not-fired.
      withheld.push({
        ruleId: rule.id,
        severity: rule.severity,
        reviewStatus: rule.review.status,
        reason: 'rule predicate threw; not evaluated',
      });
      if (rule.severity === 'urgent' || rule.severity === 'emergency') blocked = true;
      continue;
    }
    if (!fired) continue;

    const reviewed = rule.review.status === 'clinically_reviewed';
    if (!reviewed && profile === 'release') {
      withheld.push({
        ruleId: rule.id,
        severity: rule.severity,
        reviewStatus: rule.review.status,
        reason: 'rule has not completed clinical review; withheld from user-facing output in the release profile',
      });
      if (rule.severity === 'urgent' || rule.severity === 'emergency') blocked = true;
      continue;
    }

    flags.push({
      ruleId: rule.id,
      severity: rule.severity,
      title: rule.title,
      userMessage: rule.userMessage,
      actionSteps: rule.actionSteps,
      reviewStatus: rule.review.status,
    });
  }

  flags.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  withheld.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  return { flags, withheld, blocked, profile, signals };
}

/** Highest severity present, or null. Drives the UI banner colour. */
export function highestSeverity(flags: SafetyFlag[]): Severity | null {
  if (!flags.length) return null;
  return flags.reduce((acc, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[acc] ? f.severity : acc), flags[0]!.severity);
}

/** Count of rules still awaiting clinical sign-off. */
export function unreviewedRuleCount(): number {
  return ALL_RULES.filter((r) => r.review.status !== 'clinically_reviewed').length;
}

/** Total rule count, so a caller can detect a truncated or empty rule set. */
export function totalRuleCount(): number {
  return ALL_RULES.length;
}

/** Rule ids awaiting review, for the release gate and the admin view. */
export function unreviewedRuleIds(): string[] {
  return ALL_RULES.filter((r) => r.review.status !== 'clinically_reviewed').map((r) => r.id);
}

/**
 * Whether this build may be shown to real users. A release build with any
 * unreviewed rule of urgent or emergency severity is not release-ready, because
 * those rules can be withheld and would then hide a safety signal.
 */
export function releaseReady(): { ready: boolean; unreviewed: number; blocking: string[] } {
  const blocking = ALL_RULES.filter(
    (r) =>
      r.review.status !== 'clinically_reviewed' &&
      (r.severity === 'urgent' || r.severity === 'emergency'),
  ).map((r) => r.id);
  return { ready: blocking.length === 0, unreviewed: unreviewedRuleCount(), blocking };
}
