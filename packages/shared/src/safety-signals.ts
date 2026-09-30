/**
 * Safety signals: the typed, explicit bridge between interview answers and
 * red-flag rules.
 *
 * Rules used to scrape `record.gaps` and `activitiesAffected` with regexes like
 * /bladder|bowel|urinat/. That made safety behaviour depend on incidental
 * substrings in unrelated free text. Now every safety-relevant question declares
 * which signal it drives, and rules read a typed signal with one of four
 * states. No rule contains a regex over user text.
 */
import type { AnswerMap, TriState } from './answers.ts';
import { NOT_ASKED, triStateOf } from './answers.ts';
import type { BodyRegion, SymptomRecord } from './index.ts';
import { getQuestion } from './interview/engine.ts';

/** The safety-relevant facts a rule may ask about. Named, not parsed. */
export const SIGNAL_NAMES = [
  'bladder_or_bowel_change',
  'saddle_numbness',
  'leg_weakness',
  'fever_or_systemic_unwell',
  'cold_pale_or_numb_hand',
  'hot_red_swollen_joint',
  'trauma_with_loss_of_movement',
  'neck_trauma_with_neuro_symptoms',
  'weight_bearing_lost',
  'joint_locking_or_giving_way',
] as const;
export type SignalName = (typeof SIGNAL_NAMES)[number];

export type SafetySignals = Readonly<Record<SignalName, TriState>>;

const ALL_NOT_ASKED: SafetySignals = Object.freeze(
  Object.fromEntries(SIGNAL_NAMES.map((n) => [n, 'not_asked'])) as Record<SignalName, TriState>,
);

/**
 * questionId → signal it drives. Kept as an explicit table rather than inferred,
 * so a new safety question cannot be added without deciding which signal it is.
 */
export const QUESTION_SIGNALS: Readonly<Record<string, SignalName>> = Object.freeze({
  'lower_back.bladder': 'bladder_or_bowel_change',
  'lower_back.numbness': 'saddle_numbness',
  'lower_back.weakness': 'leg_weakness',
  'shoulder.vascular': 'cold_pale_or_numb_hand',
  'knee.instability': 'hot_red_swollen_joint',
  'shoulder.trauma_urgent': 'trauma_with_loss_of_movement',
  'neck.trauma_urgent': 'neck_trauma_with_neuro_symptoms',
  'neck.systemic': 'fever_or_systemic_unwell',
  'lower_back.systemic': 'fever_or_systemic_unwell',
  'knee.weight_bearing': 'weight_bearing_lost',
  'knee.locking': 'joint_locking_or_giving_way',
});

/** Signal → every question that drives it. A signal may have more than one. */
const SIGNAL_QUESTIONS: Readonly<Record<SignalName, readonly string[]>> = (() => {
  const map = Object.fromEntries(SIGNAL_NAMES.map((n) => [n, [] as string[]])) as Record<SignalName, string[]>;
  for (const [questionId, signal] of Object.entries(QUESTION_SIGNALS)) map[signal].push(questionId);
  return map;
})();

export function questionsForSignal(signal: SignalName): readonly string[] {
  return SIGNAL_QUESTIONS[signal];
}

/** The region a question belongs to, from its `<region>.<name>` id. */
function regionOfQuestion(questionId: string): BodyRegion {
  return questionId.split('.')[0] as BodyRegion;
}

/**
 * The questions that drive a signal *in a given region*.
 *
 * This replaces the old `questionForSignal`, which returned the first match
 * only. That was wrong for every multi-driver signal: `fever_or_systemic_unwell`
 * is driven by both `neck.systemic` and `lower_back.systemic`, and the function
 * always returned `neck.systemic`, so `signalIsAskedInRegion(...,'lower_back')`
 * answered "no" for a question the lower-back interview does ask.
 */
export function signalDriversInRegion(
  signal: SignalName,
  region: BodyRegion,
): string[] {
  return questionsForSignal(signal).filter((id) => regionOfQuestion(id) === region);
}

/**
 * Combine the driving questions into one signal, restricted to a region.
 *
 * `fever_or_systemic_unwell` is driven by BOTH `neck.systemic` and
 * `lower_back.systemic`. Combining by "last write wins" was a real bug — the
 * second question silently erased the first — so the combination is explicit:
 *
 *   any 'yes'      -> 'yes'       a single affirmative is enough
 *   any 'unknown'  -> 'unknown'   asked but indeterminate
 *   all 'no'       -> 'no'        every APPLICABLE driver was answered no
 *   otherwise      -> 'not_asked'
 *
 * The region restriction matters for safety, not just tidiness. An answer to
 * `lower_back.systemic` left over from a different episode must not set
 * `fever_or_systemic_unwell` on a knee episode: the lower-back question was
 * never asked for that knee, so treating it as a "yes" would fire
 * `msk.systemic_symptoms` off a region the patient is not describing. Only the
 * questions the current region's interview actually asks participate.
 *
 * Note "all no -> no": it takes every APPLICABLE driver answered negatively,
 * which is the only reading under which 'no' means anything for a safety signal.
 */
function combine(
  questionIds: readonly string[],
  answers: AnswerMap,
  region: BodyRegion | undefined,
): TriState {
  const applicable = region
    ? questionIds.filter((id) => regionOfQuestion(id) === region)
    : questionIds;
  if (!applicable.length) return NOT_ASKED;

  let anyYes = false;
  let anyUnknown = false;
  let allAsked = true;
  let allNo = true;

  for (const id of applicable) {
    const s = triStateOf(answers, id);
    if (s === 'yes') anyYes = true;
    else if (s === 'unknown') anyUnknown = true;
    else if (s === NOT_ASKED) allAsked = false;
    else if (s === 'no') { /* stays no */ } else allNo = false;
  }

  if (anyYes) return 'yes';
  if (anyUnknown) return 'unknown';
  if (allAsked && allNo) return 'no';
  return NOT_ASKED;
}

/**
 * Derive every signal from the answer map.
 *
 * `region` should be the region the record is about. Omitting it is only
 * correct when the caller genuinely has no region (for example a rule set
 * being exercised in isolation), and a test asserts the region-scoped and
 * unscoped forms differ.
 */
export function signalsFromAnswers(
  answers: AnswerMap,
  region?: BodyRegion,
): SafetySignals {
  const out = {} as Record<SignalName, TriState>;
  for (const name of SIGNAL_NAMES) out[name] = combine(SIGNAL_QUESTIONS[name], answers, region);
  return Object.freeze(out);
}

/**
 * Does the interview for this region actually ask a question for this signal?
 *
 * Checks every driver in the region, not the first one. Used by a test so a
 * safety question cannot exist without a wired signal, and a wired signal
 * cannot exist without a question the region actually asks.
 */
export function signalIsAskedInRegion(signal: SignalName, region: BodyRegion): boolean {
  return signalDriversInRegion(signal, region).some((id) => Boolean(getQuestion(region, id)));
}

export interface SafetyEvaluationInput {
  record: SymptomRecord;
  answers: AnswerMap;
  signals?: SafetySignals;
  region?: BodyRegion;
}

export { ALL_NOT_ASKED as NO_SIGNALS };
