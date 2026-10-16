/**
 * Question answers as first-class domain state.
 *
 * THE BUG THIS FIXES
 * -----------------
 * `session.ts` used to answer a yes/no safety question by writing the marker
 * `asked:lower_back.bladder` into `record.gaps`, and the red-flag rule then
 * regex-scraped `gaps` to work out whether the patient had said yes. Three
 * things were wrong with that at once:
 *
 *   1. `gaps` is documented as MISSING information. Writing an answer marker
 *      into it made "what we did not find out" indistinguishable from "what the
 *      patient told us".
 *   2. A yes and a no produced the SAME marker. So `lower_back.bladder = false`
 *      was indistinguishable from `= true` and the cauda equina rule could
 *      not be written correctly at all.
 *   3. Probing `gaps` with /bladder|bowel|urinat/ means an unrelated question id
 *      containing those letters would trigger a safety rule.
 *
 * The fix is a real answer type with four distinguishable states, and safety
 * rules that read typed signals instead of scraping free text.
 */
import { z } from 'zod';
import type { Provenance } from './provenance.ts';

/**
 * Four states, and the difference between the last two is the whole point:
 *
 *   'no'        the patient was asked and said no        → a real negative
 *   'yes'       the patient was asked and said yes       → a real positive
 *   'unknown'   the patient was asked and did not know   → genuinely indeterminate
 *   'not_asked' nobody has asked this yet                → missing
 *
 * Collapsing 'unknown' into 'no' is how a safety rule silently learns to treat
 * "I don't know" as reassurance.
 */
export const TriStateSchema = z.enum(['yes', 'no', 'unknown', 'not_asked']);
export type TriState = z.infer<typeof TriStateSchema>;

export const NOT_ASKED: TriState = 'not_asked';

/** Raw stored answer to one interview question. */
export const QuestionAnswerSchema = z.object({
  questionId: z.string().min(1),
  /**
   * The answer exactly as captured. For yes/no questions this is a TriState.
   * For single/multi choice it is the option value or values. For free text it
   * is the string. `triState` below is the normalized, safety-usable form.
   */
  raw: z.unknown(),
  /**
   * Normalized answer for safety evaluation. Only meaningful for questions that
   * are genuinely yes/no. `not_asked` is impossible inside a stored answer —
   * if it is stored, it was asked — so it is typed out here.
   */
  triState: z.enum(['yes', 'no', 'unknown']),
  /** The record fields this answer is allowed to write. Used for validation. */
  wroteFields: z.array(z.string()).default([]),
  provenance: z.object({
    /**
     * `user_statement` for a first answer, `user_edited` for a correction.
     *
     * This was `z.literal('user_statement')`, which made a correction
     * UNREPRESENTABLE rather than merely unrecorded: the store could write
     * `user_edited` and the reader would then fail to parse the row and drop the
     * answer entirely. A user correcting a safety question would have lost the answer
     * rather than marked it.
     *
     * The two values are the only ones an ANSWER may carry. Anything else -- an AI
     * proposal, a clinician assertion -- describes who produced the statement, and
     * answers are the user's by definition; a value from outside that set must fail
     * loudly rather than be quietly accepted.
     */
    sourceType: z.enum(['user_statement', 'user_edited']),
    capturedAt: z.string().datetime(),
    verificationStatus: z.literal('unverified'),
    createdBy: z.string(),
    rawText: z.string().nullish(),
  }),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;

/** questionId → answer. Absence of a key means `not_asked`. */
export type AnswerMap = Readonly<Record<string, QuestionAnswer>>;

export const EMPTY_ANSWERS: AnswerMap = Object.freeze({});

/* ------------------------------------------------------------------ */
/* Reading answers                                                     */
/* ------------------------------------------------------------------ */

export function wasAsked(answers: AnswerMap, questionId: string): boolean {
  return Object.hasOwn(answers, questionId);
}

/** The four-state answer to a question. Missing key ⇒ 'not_asked'. */
export function triStateOf(answers: AnswerMap, questionId: string): TriState {
  const a = answers[questionId];
  return a ? a.triState : NOT_ASKED;
}

export const isYes = (answers: AnswerMap, q: string): boolean => triStateOf(answers, q) === 'yes';
export const isNo = (answers: AnswerMap, q: string): boolean => triStateOf(answers, q) === 'no';
/** Asked, and the patient did not know. Distinct from both 'no' and 'not_asked'. */
export const isUncertain = (answers: AnswerMap, q: string): boolean => triStateOf(answers, q) === 'unknown';
/** Alias kept for readability at call sites that mean the same thing. */
export const isUnknown = isUncertain;

/**
 * True only for a real affirmative. `unknown` and `not_asked` are both false,
 * and callers that care about the difference must ask for it explicitly.
 */
export function affirmatively(answers: AnswerMap, q: string): boolean {
  return isYes(answers, q);
}

/**
 * True when a question was asked but the answer does not reassure — i.e. the
 * question is still outstanding in a way that matters. Used to refuse to
 * present a record as "checked" when it is not.
 */
export function unresolved(answers: AnswerMap, q: string): boolean {
  const s = triStateOf(answers, q);
  return s === 'unknown' || s === NOT_ASKED;
}

/* ------------------------------------------------------------------ */
/* Normalising a raw answer to a TriState                              */
/* ------------------------------------------------------------------ */

const YES_TOKENS = new Set(['true', 'yes', 'y', '1']);
const NO_TOKENS = new Set(['false', 'no', 'n', '0']);
const UNKNOWN_TOKENS = new Set(['unknown', 'unsure', 'dontknow', "don't know", 'not sure', 'unclear', '']);

/**
 * Whether free text explicitly reports uncertainty.
 *
 * `normaliseYesNo` returns `unknown` for every unrecognised string, including a perfectly
 * definite movement description. That fallback is for yes/no safety questions only. Free
 * text needs the narrower vocabulary test: blank and explicit uncertainty phrases count,
 * while any other non-empty string is treated as an answer.
 */
const FREE_TEXT_UNKNOWN_VALUES: ReadonlySet<string> = new Set([
  ...UNKNOWN_TOKENS,
  "i don't know",
  'do not know',
  'i am not sure',
]);

export function isUncertainFreeText(raw: unknown): boolean {
  return typeof raw === 'string' && FREE_TEXT_UNKNOWN_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Normalise a raw yes/no answer. Returns 'unknown' rather than guessing when
 * the input is not recognisable — never defaults to 'no'.
 */
export function normaliseYesNo(raw: unknown): 'yes' | 'no' | 'unknown' {
  if (typeof raw === 'boolean') return raw ? 'yes' : 'no';
  if (typeof raw !== 'string') return 'unknown';
  const v = raw.trim().toLowerCase();
  if (YES_TOKENS.has(v)) return 'yes';
  if (NO_TOKENS.has(v)) return 'no';
  if (UNKNOWN_TOKENS.has(v)) return 'unknown';
  return 'unknown';
}

/* ------------------------------------------------------------------ */
/* Building answers                                                    */
/* ------------------------------------------------------------------ */

export interface BuildAnswerInput {
  questionId: string;
  raw: unknown;
  /** Only set for genuinely yes/no questions. */
  triState?: 'yes' | 'no' | 'unknown';
  wroteFields?: string[];
  provenance: Pick<Provenance, 'capturedAt' | 'createdBy' | 'rawText'> & {
    /**
     * Optional, because most answers ARE first answers and requiring it everywhere would
     * push the common case to spell out the default. When present it must be one of the
     * two values an answer may carry -- see QuestionAnswerSchema.
     */
    sourceType?: 'user_statement' | 'user_edited';
  };
}

export function buildAnswer(input: BuildAnswerInput): QuestionAnswer {
  return QuestionAnswerSchema.parse({
    questionId: input.questionId,
    raw: input.raw,
    triState: input.triState ?? normaliseYesNo(input.raw),
    wroteFields: input.wroteFields ?? [],
    provenance: {
      sourceType: input.provenance.sourceType ?? 'user_statement',
      capturedAt: input.provenance.capturedAt,
      verificationStatus: 'unverified',
      createdBy: input.provenance.createdBy,
      rawText: input.provenance.rawText ?? null,
    },
  });
}

/** Record an answer into a map, replacing any previous answer to the question. */
export function putAnswer(answers: AnswerMap, answer: QuestionAnswer): Record<string, QuestionAnswer> {
  return { ...answers, [answer.questionId]: answer };
}

/**
 * A question is OUTSTANDING if it has never been answered, or was answered with
 * "don't know". This drives "we did not ask about X" prompts, and is the only
 * thing that should ever populate `record.gaps`.
 */
export function outstandingQuestionIds(
  answers: AnswerMap,
  candidateIds: readonly string[],
): string[] {
  return candidateIds.filter((id) => {
    const s = triStateOf(answers, id);
    return s === NOT_ASKED || s === 'unknown';
  });
}

/** Documented contract for callers storing answers. Referenced by the API layer. */
export const ANSWER_SCHEMA_NOTE =
  'Question answers carry four states — yes | no | unknown | not_asked. ' +
  "'unknown' and 'not_asked' must never be collapsed into 'no'. " +
  'Safety rules read typed signals derived from this map, never record fields.';
