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
  /** Which record field this writes to, for provenance bookkeeping. */
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
  /** Safety gating: if answered `true`, stop and show a red flag. */
  safetyRuleId?: string;
}

/** Everything already known, flattened for predicate convenience. */
export interface InterviewContext {
  record: SymptomRecord;
  asked: Set<string>;
}

const q = (question: InterviewQuestion): InterviewQuestion => question;

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
  }),
  q({
    id: 'neck.headache',
    region: 'neck',
    field: 'quality',
    rationale: 'Neck-related headache is a common and easily missed pattern.',
    type: 'boolean',
    prompt: 'Do you get a headache that starts at the back of your head or behind your eyes when this is bad?',
    required: false,
  }),
  q({
    id: 'neck.movement',
    region: 'neck',
    field: 'triggerDetail',
    rationale: 'Which neck movement reproduces it is more useful than a pain score.',
    type: 'text',
    prompt: 'Which neck movements bring it on — turning, looking down, tilting, holding a posture?',
    required: true,
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

/** Next question for a region, given what we already know. */
export function nextQuestion(ctx: InterviewContext): InterviewQuestion | undefined {
  const list = INTERVIEW[ctx.record.location.region];
  if (!list) return undefined;
  return list.find(
    (question) =>
      !ctx.asked.has(question.id) && (!question.showIf || question.showIf(ctx.record, ctx.asked)),
  );
}

export function questionProgress(ctx: InterviewContext): { answered: number; total: number; requiredLeft: number } {
  const list = INTERVIEW[ctx.record.location.region] ?? [];
  const applicable = list.filter((question) => !question.showIf || question.showIf(ctx.record, ctx.asked));
  return {
    answered: applicable.filter((question) => ctx.asked.has(question.id)).length,
    total: applicable.length,
    requiredLeft: applicable.filter((question) => question.required && !ctx.asked.has(question.id)).length,
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
