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
import { triStateOf } from './answers.ts';
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

/**
 * Combine several questions into one signal.
 *
 * `fever_or_systemic_unwell` is driven by BOTH `neck.systemic` and
 * `lower_back.systemic`. Combining by "last write wins" is a real bug — the
 * second question silently erased the first — so the combination is explicit:
 *
 *   any 'yes'      → 'yes'       a single affirmative is enough
 *   any 'unknown'  → 'unknown'   asked but indeterminate
 *   all 'no'       → 'no'        every driving question was answered no
 *   otherwise      → 'not_asked'
 *
 * Note "all no → no": it takes BOTH questions answered negatively, which is the
 * only reading under which 'no' means anything for a safety signal.
 */
function combine(questionIds: readonly string[], answers: AnswerMap): TriState {
  let anyYes = false;
  let anyUnknown = false;
  let allAsked = true;
  let allNo = true;

  for (const id of questionIds) {
    const s = triStateOf(answers, id);
    if (s === 'yes') anyYes = true;
    else if (s === 'unknown') anyUnknown = true;
    else if (s === 'not_asked') allAsked = false;
    else if (s === 'no') { /* stays no */ } else allNo = false;
  }

  if (anyYes) return 'yes';
  if (anyUnknown) return 'unknown';
  if (allAsked && allNo) return 'no';
  return 'not_asked';
}

export function signalsFromAnswers(answers: AnswerMap): SafetySignals {
  const out = {} as Record<SignalName, TriState>;
  for (const name of SIGNAL_NAMES) out[name] = combine(SIGNAL_QUESTIONS[name], answers);
  return Object.freeze(out);
}

/** The question that drives a signal, if any. Used by the UI to point at it. */
export function questionForSignal(signal: SignalName): string | null {
  const entry = Object.entries(QUESTION_SIGNALS).find(([, s]) => s === signal);
  return entry ? entry[0] : null;
}

/**
 * Does the interview for this region actually ask a question for this signal?
 * Used by a test so a safety question cannot exist without a wired signal, and
 * a wired signal cannot exist without a question in the region.
 */
export function signalIsAskedInRegion(signal: SignalName, region: BodyRegion): boolean {
  const questionId = questionForSignal(signal);
  if (!questionId) return false;
  const q = getQuestion(region, questionId);
  return Boolean(q);
}

export interface SafetyEvaluationInput {
  record: SymptomRecord;
  answers: AnswerMap;
  signals?: SafetySignals;
  region?: BodyRegion;
}

export { ALL_NOT_ASKED as NO_SIGNALS };
