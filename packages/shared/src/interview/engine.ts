/**
 * Dynamic, region-specific symptom interview.
 *
 * The point (product plan §3.2): a shoulder is not a knee. We never show the
 * same questionnaire to everyone. Questions are selected by region, then
 * further filtered by what the user has already told us, so a 2–3 minute
 * session only asks what is still unknown and actually relevant.
 *
 * Questions are data, not code. Adding a region or rewriting a question should
 * never require touching the orchestrator.
 */
import { z } from 'zod';
import type { BodyRegion, Structure } from '../anatomy.ts';
import { getStructure, structureBelongsToRegion } from '../anatomy.ts';
import type { SymptomRecord } from '../symptom.ts';
import type { QuestionAnswer, AnswerMap } from '../answers.ts';
import { isUncertain } from '../answers.ts';

export const QuestionTypeSchema = z.enum(['single', 'multi', 'scale', 'boolean', 'text']);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export interface AnswerOption {
  value: string;
  label: string;
  /** Shown small under the label; used to teach, not to diagnose. */
  hint?: string;
  /** Set when picking this option should reveal specific structures. */
  impliesStructureIds?: string[];
  /** Free-form follow-up the LLM should ask if this option is chosen. */
  followUpHint?: string;
}

export interface InterviewQuestion {
  id: string;
  region: BodyRegion;
  /** Which record fields this writes to, for provenance bookkeeping. */
  field: string;
  /** Why we're asking — shown in the UI to build trust, not hidden. */
  rationale: string;
  type: QuestionType;
  prompt: string;
  options?: AnswerOption[];
  required: boolean;
  /** Only ask if this predicate passes. */
  showIf?: (record: SymptomRecord, asked: ReadonlySet<string>) => boolean;
  /** Structures to highlight on the model while this question is on screen. */
  highlightStructureIds?: string[];
  /** Safety gating: answering this feeds a rule. See safety-signals.ts. */
  safetyRuleId?: string;
  /**
   * Record fields this answer writes, when the answer is affirmative or a
   * non-negative option. Used by the provenance strategy and by tests.
   */
  writesOnYes?: string[];
  /**
   * THE ANSWER → RECORD MAPPING.
   *
   * This used to live in `apps/web/src/state/session.ts` as a `switch` on
   * question id, which meant the mapping was untested, could silently drift
   * from the question list, and — worst — collapsed yes and no into the same
   * side effects. It is colocated with the question it belongs to, is a pure
   * mutation, and is applied only through `applyAnswer`.
   *
   * MUST NOT touch anything a safety rule reads. Safety rules read
   * `SafetySignals` derived from the answer map, never from record fields, so
   * that a yes and a no can never be confused.
   */
  applyTo?: (record: SymptomRecord, answer: QuestionAnswer) => string[];
}

/** Everything already known, for predicate and queue decisions. */
export interface InterviewContext {
  record: SymptomRecord;
  /** The answer map. A question is asked iff its id is a key here. */
  answers: AnswerMap;
}

/** Ids of questions that have been asked. */
export function askedIds(answers: AnswerMap): ReadonlySet<string> {
  return new Set(Object.keys(answers));
}

const q = (question: InterviewQuestion): InterviewQuestion => question;

/** Append without duplicating, preserving the element type. */
const add = <T,>(arr: readonly T[], ...items: T[]): T[] => [...new Set([...arr, ...items])];

/**
 * Remove items, preserving order.
 *
 * Needed because an answer can WITHDRAW something. A user who corrects "yes, it wakes me
 * at night" to "no" has told us the symptom is not there, and a record that keeps the
 * night trigger after that correction is reporting a symptom the user has disowned.
 */
const without = <T,>(arr: readonly T[], ...items: T[]): T[] => [
  ...new Set(arr.filter((item) => !items.includes(item))),
];

/**
 * Apply one answer to a record, returning the field paths written.
 *
 * This is the single place an interview answer changes the record. It is pure:
 * it mutates the record it is given and returns the touched paths, so the
 * caller can create exactly those mutations with the right provenance.
 */
export function applyAnswer(
  record: SymptomRecord,
  questionId: string,
  answer: QuestionAnswer,
): string[] {
  const question = getQuestionAnyRegion(questionId);
  if (!question?.applyTo) {
    // A question with no mapping is still a real answer; it just writes nothing.
    return [];
  }
  return question.applyTo(record, answer);
}

function getQuestionAnyRegion(questionId: string): InterviewQuestion | undefined {
  const region = questionId.split('.')[0] as BodyRegion;
  return INTERVIEW[region]?.find((x) => x.id === questionId);
}

/** Yes/no helper for applyTo bodies: an affirmative that is genuinely an affirmative. */
export const affirmed = (a: QuestionAnswer): boolean => a.triState === 'yes';
export const denied = (a: QuestionAnswer): boolean => a.triState === 'no';
export const uncertain = (a: QuestionAnswer): boolean => a.triState === 'unknown';

/* ================================================================== */
/* SHOULDER                                                            */
/* ================================================================== */

const SHOULDER_QUESTIONS: InterviewQuestion[] = [
  q({
    id: 'shoulder.injury_context',
    region: 'shoulder',
    field: 'context.recentInjury',
    rationale: 'A clear injury changes what a clinician looks for first.',
    type: 'single',
    prompt: 'Did this start after something specific?',
    required: true,
    options: [
      { value: 'injury', label: 'An injury or fall', hint: 'Something you could name — a hit, a tackle, a fall' },
      { value: 'activity', label: 'After physical activity', hint: 'Sport, lifting, a long drive, painting a ceiling' },
      { value: 'nothing', label: 'Nothing in particular', hint: 'It just started on its own' },
      { value: 'unknown', label: 'I am not sure' },
    ],
    showIf: () => true,
    applyTo: (record, a) => {
      record.context.recentInjury = String(a.raw);
      return ['context.recentInjury'];
    },
  }),
  q({
    id: 'shoulder.night_pain',
    region: 'shoulder',
    field: 'quality',
    rationale: 'Night pain is the single most discriminating shoulder question clinicians ask.',
    type: 'boolean',
    prompt: 'Does it wake you from sleep, or stop you falling asleep?',
    required: true,
    highlightStructureIds: ['asi:shoulder.supraspinatus-tendon', 'asi:shoulder.subacromial-bursa', 'asi:shoulder.acromion'],
    applyTo: (record, a) => {
      // UNCERTAINTY NEVER CHANGES THE RECORD. 'I am not sure' and 'not asked' must not add
      // a trigger and must not remove one -- that is rule 4 of this product, and it is why
      // `unknown` is a first-class answer rather than a synonym for no.
      //
      // A definite NO is different, and used to behave the same way, which was wrong. The
      // original comment said "only an explicit yes adds a trigger" and returned early for
      // `denied` as well, so a user who corrected "yes" to "no" kept a night trigger the
      // record still claimed they reported. The correction was accepted, marked
      // `user_edited`, and had no effect on anything a clinician reads -- which makes the
      // whole correction feature cosmetic for this question.
      if (uncertain(a)) return [];
      if (denied(a)) {
        // Only touch the field when there is something to withdraw, so a "no" on a fresh
        // record does not write an unchanged value and manufacture provenance for it.
        if (!record.triggers.includes('night')) return [];
        record.triggers = without(record.triggers, 'night');
        return ['triggers'];
      }
      record.triggers = add(record.triggers, 'night');
      return ['triggers'];
    },
  }),
  q({
    id: 'shoulder.elevation',
    region: 'shoulder',
    field: 'triggerDetail',
    rationale: 'Shoulder pain is almost always described by the movement that provokes it.',
    type: 'text',
    prompt: 'Which arm movements set it off? Try to be specific about the point where it starts.',
    required: true,
    highlightStructureIds: ['asi:shoulder.supraspinatus-tendon', 'asi:shoulder.biceps-long-head-tendon', 'asi:shoulder.glenohumeral-joint'],
    applyTo: (record, a) => {
      const text = typeof a.raw === 'string' ? a.raw.trim() : '';
      if (!text) return [];
      record.triggerDetail = text;
      record.triggers = add(record.triggers, 'movement');
      return ['triggerDetail', 'triggers'];
    },
  }),
  q({
    id: 'shoulder.weakness',
    region: 'shoulder',
    field: 'function.activitiesAffected',
    rationale: 'Weakness points at the tendon or cuff; pain alone points at the bursa or joint.',
    type: 'multi',
    prompt: 'Is it weakness, or only pain? Select everything that applies.',
    required: true,
    options: [
      { value: 'weak_above_head', label: 'Weak reaching overhead', impliesStructureIds: ['asi:shoulder.supraspinatus-tendon'] },
      { value: 'weak_external_rotation', label: 'Weak turning out to the side', impliesStructureIds: ['asi:shoulder.infraspinatus', 'asi:shoulder.teres-minor'] },
      { value: 'weak_internal_rotation', label: 'Weak turning in behind my back', impliesStructureIds: ['asi:shoulder.subscapularis'] },
      { value: 'pain_only', label: 'Just pain, strength feels normal' },
    ],
    highlightStructureIds: ['asi:shoulder.supraspinatus-tendon', 'asi:shoulder.infraspinatus', 'asi:shoulder.subscapularis'],
    applyTo: (record, a) => {
      const picked = Array.isArray(a.raw) ? (a.raw as string[]) : [String(a.raw)];
      const wrote: string[] = [];
      if (picked.includes('weak_above_head')) {
        record.quality = add(record.quality, 'instability');
        record.function.activitiesAffected = add(record.function.activitiesAffected, 'weak reaching overhead');
        wrote.push('quality', 'function.activitiesAffected');
      }
      if (picked.length === 1 && picked[0] === 'pain_only') {
        record.function.activitiesAffected = record.function.activitiesAffected.filter(
          (x) => x !== 'leg feels weak',
        );
        wrote.push('function.activitiesAffected');
      }
      return wrote;
    },
  }),
  q({
    id: 'shoulder.radiation',
    region: 'shoulder',
    field: 'radiation',
    rationale: 'Referred pain down the arm is meaningfully different from local shoulder pain.',
    type: 'single',
    prompt: 'Does the feeling travel anywhere else?',
    required: true,
    options: [
      { value: 'none', label: 'No, it stays in the shoulder' },
      { value: 'lateral_arm', label: 'Down the outside of my arm', impliesStructureIds: ['asi:shoulder.supraspinatus-tendon'] },
      { value: 'front_arm', label: 'Down the front of my arm', impliesStructureIds: ['asi:shoulder.biceps-long-head-tendon'] },
      { value: 'hand_tingle', label: 'Into my hand with tingling or numbness' },
      { value: 'neck_related', label: 'It comes from my neck', impliesStructureIds: ['asi:neck.brachial-plexus'] },
    ],
    applyTo: (record, a) => {
      const v = String(a.raw);
      // 'none' is a real negative: record it as an explicitly empty radiation
      // rather than leaving the field looking unasked.
      record.radiation = v === 'none' ? [] : [v];
      if (v === 'hand_tingle') record.quality = add(record.quality, 'numbness');
      return ['radiation', 'quality'];
    },
  }),
  q({
    id: 'shoulder.tenderness',
    region: 'shoulder',
    field: 'tendernessOnPalpation',
    rationale: 'Tenderness on the bony shelf is a different structure from tenderness in the muscle.',
    type: 'single',
    prompt: 'If you press on the sore spot, how does it feel?',
    required: false,
    options: [
      { value: 'no', label: 'No particular tenderness' },
      { value: 'mild', label: 'A bit tender' },
      { value: 'moderate', label: 'Quite tender' },
      { value: 'severe', label: 'Very tender, I flinch' },
      { value: 'not_tested', label: 'I have not tried' },
    ],
    applyTo: (record, a) => {
      record.tendernessOnPalpation = String(a.raw) as SymptomRecord['tendernessOnPalpation'];
      return ['tendernessOnPalpation'];
    },
  }),
  q({
    id: 'shoulder.trauma_urgent',
    region: 'shoulder',
    field: 'context.recentInjury',
    rationale: 'A deformed joint after trauma needs same-day assessment.',
    type: 'boolean',
    prompt: 'Do you have a fall or injury where the shoulder looks deformed, or you cannot lift the arm at all?',
    required: true,
    safetyRuleId: 'msk.trauma_deformity_no_lift',
    // Deliberately writes NOTHING. This answer reaches the safety rule through
    // SafetySignals, so a 'no' here is provably not the same as a 'yes'.
    applyTo: () => [],
  }),
  q({
    id: 'shoulder.vascular',
    region: 'shoulder',
    field: 'context.systemicSymptoms',
    rationale: 'A cold or pale hand suggests a circulation problem, not a tendon problem.',
    type: 'boolean',
    prompt: 'Is the hand on that side cold, pale, or numb compared with the other?',
    required: true,
    safetyRuleId: 'msk.cold_pale_hand',
    // No record write. The previous version set systemicSymptoms:['fever'] here,
    // which was simply wrong — the question is about a hand, not a fever.
    applyTo: () => [],
  }),
];

/* ================================================================== */
/* NECK                                                                */
/* ================================================================== */

const NECK_QUESTIONS: InterviewQuestion[] = [
  q({
    id: 'neck.mechanism',
    region: 'neck',
    field: 'context.recentInjury',
    rationale: 'Whiplash and a general "stiff neck" are handled completely differently.',
    type: 'single',
    prompt: 'How did this start?',
    required: true,
    options: [
      { value: 'whiplash', label: 'After a sudden jolt, fall or whiplash' },
      { value: 'posture', label: 'Slowly, from sitting or screens' },
      { value: 'sleep', label: 'After a bad night of sleep or a new pillow' },
      { value: 'effort', label: 'After lifting or exertion' },
      { value: 'unknown', label: 'No clear cause' },
    ],
    applyTo: (record, a) => {
      record.context.recentInjury = String(a.raw);
      return ['context.recentInjury'];
    },
  }),
  q({
    id: 'neck.arming',
    region: 'neck',
    field: 'radiation',
    rationale: 'Neck pain travelling into the arm involves the nerve roots, which changes the pathway.',
    type: 'single',
    prompt: 'Does anything go down your arm?',
    required: true,
    options: [
      { value: 'none', label: 'No, it stays in the neck' },
      { value: 'shoulder_only', label: 'Into the top of the shoulder but not the arm' },
      { value: 'arm_pain', label: 'Down the arm', impliesStructureIds: ['asi:neck.brachial-plexus'] },
      { value: 'arm_numb', label: 'Down the arm with numbness or tingling', impliesStructureIds: ['asi:neck.brachial-plexus'] },
      { value: 'hand_specific', label: 'Into specific fingers' },
    ],
    highlightStructureIds: ['asi:neck.brachial-plexus', 'asi:neck.scalenes'],
    applyTo: (record, a) => {
      const v = String(a.raw);
      record.radiation = v === 'none' ? [] : [v];
      if (v === 'arm_numb') record.quality = add(record.quality, 'numbness');
      return ['radiation', 'quality'];
    },
  }),
  q({
    id: 'neck.headache',
    region: 'neck',
    field: 'quality',
    rationale: 'Neck-related headache is a common and easily missed pattern.',
    type: 'boolean',
    prompt: 'Do you get a headache that starts at the back of your head or behind your eyes when this is bad?',
    required: false,
    applyTo: (_record, a) => {
      // Recorded as a note only; it carries no record field of its own.
      return affirmed(a) ? [] : [];
    },
  }),
  q({
    id: 'neck.movement',
    region: 'neck',
    field: 'triggerDetail',
    rationale: 'Which neck movement reproduces it is more useful than a pain score.',
    type: 'text',
    prompt: 'Which neck movements bring it on — turning, looking down, tilting, holding a posture?',
    required: true,
    applyTo: (record, a) => {
      const text = typeof a.raw === 'string' ? a.raw.trim() : '';
      if (!text) return [];
      record.triggerDetail = text;
      record.triggers = add(record.triggers, 'movement');
      return ['triggerDetail', 'triggers'];
    },
  }),
  q({
    id: 'neck.trauma_urgent',
    region: 'neck',
    field: 'context.recentInjury',
    rationale: 'Trauma plus neurological symptoms is an emergency pathway.',
    type: 'boolean',
    prompt: 'After the injury, do you also have weakness, numbness, or trouble walking?',
    required: true,
    safetyRuleId: 'msk.neck_trauma_neuro',
    applyTo: () => [],
  }),
  q({
    id: 'neck.systemic',
    region: 'neck',
    field: 'context.systemicSymptoms',
    rationale: 'Neck pain with fever or unexplained weight loss needs prompt review.',
    type: 'boolean',
    prompt: 'Do you have a fever, night sweats, or weight loss you cannot explain?',
    required: true,
    safetyRuleId: 'msk.systemic_symptoms',
    applyTo: (record, a) => {
      // Only a yes adds systemic features. The previous version set 'fever' for
      // four unrelated questions including the cold/pale hand one.
      if (!affirmed(a)) return [];
      record.context.systemicSymptoms = add(
        record.context.systemicSymptoms.filter((s) => s !== 'none'),
        'fever',
        'weight_loss',
        'night_sweats',
      );
      return ['context.systemicSymptoms'];
    },
  }),
];

/* ================================================================== */
/* LOWER BACK                                                          */
/* ================================================================== */

const LOWER_BACK_QUESTIONS: InterviewQuestion[] = [
  q({
    id: 'lower_back.mechanism',
    region: 'lower_back',
    field: 'context.recentInjury',
    rationale: 'Lifting and bending history is the highest-yield history question for low back pain.',
    type: 'single',
    prompt: 'What were you doing when it started?',
    required: true,
    options: [
      { value: 'lifting', label: 'Lifting or carrying something heavy' },
      { value: 'bending', label: 'Bending or twisting' },
      { value: 'posture', label: 'Sitting a long time, or gradually over weeks' },
      { value: 'fall', label: 'A fall or slip' },
      { value: 'nothing', label: 'Nothing in particular' },
    ],
    applyTo: (record, a) => {
      record.context.recentInjury = String(a.raw);
      return ['context.recentInjury'];
    },
  }),
  q({
    id: 'lower_back.leg_symptoms',
    region: 'lower_back',
    field: 'radiation',
    rationale: 'Leg symptoms change the pathway entirely — this is the discriminant.',
    type: 'single',
    prompt: 'Does anything go down your leg, or into your buttock or groin?',
    required: true,
    options: [
      { value: 'none', label: 'No, it stays in the back' },
      { value: 'buttock', label: 'Into the buttock' },
      { value: 'back_of_leg', label: 'Down the back of the leg' },
      { value: 'front_of_leg', label: 'Down the front of the leg' },
      { value: 'below_knee', label: 'Past the knee' },
      { value: 'groin', label: 'Into the groin' },
    ],
    applyTo: (record, a) => {
      const v = String(a.raw);
      record.radiation = v === 'none' ? [] : [v];
      return ['radiation'];
    },
  }),
  q({
    id: 'lower_back.numbness',
    region: 'lower_back',
    field: 'quality',
    rationale: 'Numbness changes the symptom from nociceptive to neurological.',
    type: 'boolean',
    prompt: 'Any numbness, tingling or "pins and needles" in your leg, foot, or the saddle area?',
    required: true,
    highlightStructureIds: ['asi:lower-back.lumbar-spine'],
    // Reaches msk.cauda_equina only in combination with leg weakness, via
    // SafetySignals. Alone it records the sensation.
    applyTo: (record, a) => {
      if (!affirmed(a)) return [];
      record.quality = add(record.quality, 'numbness', 'tingling');
      return ['quality'];
    },
  }),
  q({
    id: 'lower_back.weakness',
    region: 'lower_back',
    field: 'function.activitiesAffected',
    rationale: 'Foot drop and walking changes are the functional signs that matter most.',
    type: 'boolean',
    prompt: 'Is your leg weak, or does your walking feel different from usual?',
    required: true,
    safetyRuleId: 'msk.cauda_equina',
    applyTo: (record, a) => {
      if (!affirmed(a)) return [];
      record.quality = add(record.quality, 'instability');
      record.function.activitiesAffected = add(record.function.activitiesAffected, 'leg feels weak');
      return ['quality', 'function.activitiesAffected'];
    },
  }),
  q({
    id: 'lower_back.bladder',
    region: 'lower_back',
    field: 'function.activitiesAffected',
    rationale: 'This is the red-flag question that must never be skipped.',
    type: 'boolean',
    prompt: 'Have you had difficulty starting to urinate, or new trouble controlling your bladder or bowels?',
    required: true,
    safetyRuleId: 'msk.cauda_equina',
    // THE critical question. Writes nothing. Its only effect is the
    // bladder_or_bowel_change signal, which is why 'no' can never fire the rule.
    applyTo: () => [],
  }),
  q({
    id: 'lower_back.movement',
    region: 'lower_back',
    field: 'triggerDetail',
    rationale: 'Flexion vs extension pattern is the most informative functional test users can self-report.',
    type: 'multi',
    prompt: 'Which of these make it worse or better?',
    required: true,
    options: [
      { value: 'worse_flexion', label: 'Worse bending forward' },
      { value: 'worse_extension', label: 'Worse leaning back' },
      { value: 'worse_sitting', label: 'Worse sitting down' },
      { value: 'worse_standing', label: 'Worse standing up' },
      { value: 'worse_cough', label: 'Worse coughing or sneezing' },
      { value: 'better_movement', label: 'Easier once I start moving' },
      { value: 'better_walking', label: 'Easier walking' },
      { value: 'better_rest', label: 'Easier lying down' },
    ],
    applyTo: (record, a) => {
      const picked = Array.isArray(a.raw) ? (a.raw as string[]) : [String(a.raw)];
      record.triggerDetail = picked.join(', ');
      record.triggers = add(record.triggers, 'movement');
      if (picked.includes('worse_cough')) record.triggers = add(record.triggers, 'coughing_sneezing');
      return ['triggerDetail', 'triggers'];
    },
  }),
  q({
    id: 'lower_back.systemic',
    region: 'lower_back',
    field: 'context.systemicSymptoms',
    rationale: 'Low back pain with systemic symptoms is never routine.',
    type: 'boolean',
    prompt: 'Any unexplained weight loss, fever, or night sweats?',
    required: true,
    safetyRuleId: 'msk.systemic_symptoms',
    applyTo: (record, a) => {
      if (!affirmed(a)) return [];
      record.context.systemicSymptoms = add(
        record.context.systemicSymptoms.filter((s) => s !== 'none'),
        'fever',
        'weight_loss',
        'night_sweats',
      );
      return ['context.systemicSymptoms'];
    },
  }),
];

/* ================================================================== */
/* KNEE                                                                */
/* ================================================================== */

const KNEE_QUESTIONS: InterviewQuestion[] = [
  q({
    id: 'knee.mechanism',
    region: 'knee',
    field: 'context.recentInjury',
    rationale: 'A pop with locking means something inside the joint; without it, more often tendon or overuse.',
    type: 'single',
    prompt: 'How did it start?',
    required: true,
    options: [
      { value: 'pop', label: 'I felt or heard a pop', hint: 'A sudden twist, pivot, or landing' },
      { value: 'direct_hit', label: 'A direct knock on the knee' },
      { value: 'overuse', label: 'Gradually, after lots of running or climbing' },
      { value: 'stairs', label: 'Gradually, and it started with stairs or squatting' },
      { value: 'nothing', label: 'No clear cause' },
    ],
    applyTo: (record, a) => {
      record.context.recentInjury = String(a.raw);
      return ['context.recentInjury'];
    },
  }),
  q({
    id: 'knee.locking',
    region: 'knee',
    field: 'quality',
    rationale: 'Catching or giving way points to meniscus, cartilage or ligament.',
    type: 'boolean',
    prompt: 'Does the knee catch, lock, or give way?',
    required: true,
    highlightStructureIds: ['asi:knee.meniscus-medial', 'asi:knee.meniscus-lateral'],
    // Feeds the joint_locking signal for msk.joint_locking. Writing a quality
    // as well is fine because no safety rule reads `quality` for this pairing.
    applyTo: (record, a) => {
      if (!affirmed(a)) return [];
      record.quality = add(record.quality, 'clicking', 'instability');
      return ['quality'];
    },
  }),
  q({
    id: 'knee.swelling',
    region: 'knee',
    field: 'quality',
    rationale: 'Rapid swelling suggests bleeding or acute structural injury; slow swelling suggests inflammation.',
    type: 'single',
    prompt: 'Is it swollen, and how fast did it swell?',
    required: true,
    options: [
      { value: 'none', label: 'Not swollen' },
      { value: 'rapid', label: 'Swollen almost immediately' },
      { value: 'gradual', label: 'Swollen the next day' },
      { value: 'slow', label: 'Swollen gradually over a week or more' },
    ],
    applyTo: (record, a) => {
      // 'none' is a real negative and must clear any prior swelling.
      if (String(a.raw) === 'none') {
        if (!record.quality.includes('swelling')) return [];
        record.quality = record.quality.filter((q) => q !== 'swelling');
        return ['quality'];
      }
      record.quality = add(record.quality, 'swelling');
      return ['quality'];
    },
  }),
  q({
    id: 'knee.weight_bearing',
    region: 'knee',
    field: 'function.unableWeighBearing',
    rationale: 'Whether weight can be taken is the fastest objective-ish functional measure we have.',
    type: 'single',
    prompt: 'Can you put your full weight on it?',
    required: true,
    options: [
      { value: 'yes', label: 'Yes, normally' },
      { value: 'partial', label: 'Only part of my weight, or I limp' },
      { value: 'no', label: 'No, I cannot put weight on it' },
    ],
    applyTo: (record, a) => {
      record.function.unableWeighBearing = String(a.raw) as SymptomRecord['function']['unableWeighBearing'];
      return ['function.unableWeighBearing'];
    },
  }),
  q({
    id: 'knee.stairs',
    region: 'knee',
    field: 'triggerDetail',
    rationale: 'Stairs vs flat ground is the classic discriminator between patellar and joint problems.',
    type: 'multi',
    prompt: 'Which of these set it off?',
    required: true,
    options: [
      { value: 'stairs_up', label: 'Going up stairs', impliesStructureIds: ['asi:knee.patellofemoral-joint'] },
      { value: 'stairs_down', label: 'Going down stairs', impliesStructureIds: ['asi:knee.patellofemoral-joint'] },
      { value: 'squat', label: 'Squatting or kneeling', impliesStructureIds: ['asi:knee.patella', 'asi:knee.patellar-tendon'] },
      { value: 'running', label: 'Running' },
      { value: 'sitting', label: 'Sitting for a long time', impliesStructureIds: ['asi:knee.patellofemoral-joint'] },
      { value: 'twist', label: 'Twisting or pivoting', impliesStructureIds: ['asi:knee.meniscus-medial', 'asi:knee.meniscus-lateral'] },
      { value: 'twisting_in', label: 'Twisting the leg inwards', impliesStructureIds: ['asi:knee.mcl'] },
      { value: 'twisting_out', label: 'Twisting the leg outwards', impliesStructureIds: ['asi:knee.lcl'] },
    ],
    applyTo: (record, a) => {
      const picked = Array.isArray(a.raw) ? (a.raw as string[]) : [String(a.raw)];
      record.triggerDetail = picked.join(', ');
      record.triggers = add(record.triggers, 'movement');
      if (picked.includes('running')) record.triggers = add(record.triggers, 'exercise');
      return ['triggerDetail', 'triggers'];
    },
  }),
  q({
    id: 'knee.instability',
    region: 'knee',
    field: 'quality',
    rationale: 'A hot swollen knee with fever is an urgent, time-sensitive presentation.',
    type: 'boolean',
    prompt: 'Is the knee hot and red, and do you have a fever or feel unwell?',
    required: true,
    safetyRuleId: 'msk.hot_joint_fever',
    // The previous version set systemicSymptoms:['fever'] for this AND for the
    // cold/pale hand question. Now the two signals stay separate.
    applyTo: (record, a) => {
      if (!affirmed(a)) return [];
      record.context.systemicSymptoms = add(
        record.context.systemicSymptoms.filter((s) => s !== 'none'),
        'fever',
      );
      record.quality = add(record.quality, 'swelling');
      return ['context.systemicSymptoms', 'quality'];
    },
  }),
];

/* ================================================================== */
/* Registry                                                            */
/* ================================================================== */

export const INTERVIEW: Record<BodyRegion, InterviewQuestion[]> = {
  shoulder: SHOULDER_QUESTIONS,
  neck: NECK_QUESTIONS,
  lower_back: LOWER_BACK_QUESTIONS,
  knee: KNEE_QUESTIONS,
};

export function getQuestion(region: BodyRegion, id: string): InterviewQuestion | undefined {
  return INTERVIEW[region]?.find((x) => x.id === id);
}

/**
 * Next question for a region, given what we already know.
 *
 * A question whose answer is "I don't know" is NOT re-asked: re-asking a
 * question the patient has already been unable to answer is how a 2-3 minute
 * interview becomes a 10 minute one. `questionProgress` still reports it as
 * outstanding.
 */
export function nextQuestion(ctx: InterviewContext): InterviewQuestion | undefined {
  const list = INTERVIEW[ctx.record.location.region];
  if (!list) return undefined;
  const asked = askedIds(ctx.answers);
  return list.find(
    (question) =>
      !asked.has(question.id) &&
      // Skip anything already answered with "don't know".
      !isUncertain(ctx.answers, question.id) &&
      (!question.showIf || question.showIf(ctx.record, asked)),
  );
}

/**
 * How far through an interview someone is.
 *
 * Named rather than inlined, because the reopen endpoint hands it to the browser
 * as part of a transport contract. An anonymous object type there would mean the
 * client declaring its own copy of a shape the server produced.
 */
export interface QuestionProgress {
  answered: number;
  total: number;
  requiredLeft: number;
  outstanding: string[];
}

export function questionProgress(ctx: InterviewContext): QuestionProgress {
  const list = INTERVIEW[ctx.record.location.region] ?? [];
  const asked = askedIds(ctx.answers);
  const applicable = list.filter((question) => !question.showIf || question.showIf(ctx.record, asked));
  return {
    answered: applicable.filter((question) => asked.has(question.id)).length,
    total: applicable.length,
    requiredLeft: applicable.filter((question) => question.required && !asked.has(question.id)).length,
    // Outstanding means asked-and-uncertain OR never asked. An answer of
    // "don't know" leaves the question genuinely open, so it belongs here.
    outstanding: applicable
      .filter((question) => !asked.has(question.id) || isUncertain(ctx.answers, question.id))
      .map((question) => question.id),
  };
}

/**
 * Which structures the user's answers implicitly point at.
 * These stay CANDIDATES — they never become user-confirmed facts on their own.
 */
export function impliedStructures(region: BodyRegion, selectedOptionValues: Iterable<string>): Structure[] {
  const values = new Set(selectedOptionValues);
  const hits = new Map<string, Structure>();
  for (const question of INTERVIEW[region] ?? []) {
    for (const opt of question.options ?? []) {
      if (!values.has(opt.value) && !values.has(`${question.id}:${opt.value}`)) continue;
      for (const id of opt.impliesStructureIds ?? []) {
        if (!structureBelongsToRegion(id, region)) continue;
        const s = getStructure(id);
        if (s) hits.set(id, s);
      }
    }
  }
  return [...hits.values()];
}

export function isSafetyQuestion(question: InterviewQuestion): boolean {
  return Boolean(question.safetyRuleId);
}
