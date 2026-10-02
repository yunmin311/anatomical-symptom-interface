/**
 * Pure session logic, extracted from the Zustand store so it can be tested.
 *
 * `session.ts` was the largest untested surface in the repository and it
 * contained the bug where a yes and a no produced identical side effects. This
 * module is deliberately free of React, fetch and the store, so every rule
 * about what a user action does to the record can be asserted directly.
 *
 * The rules:
 *   - An answer is stored with its four-state value and applied exactly once.
 *   - Record fields are written by `applyAnswer` in shared, never here.
 *   - A structure selection is a VISUAL SELECTION, not a finding.
 *   - Mutations sent to the server are exactly the fields that were written.
 */
import {
  applyAnswer,
  buildAnswer,
  emptyRecord,
  evaluateSafety,
  getStructure,
  nextQuestion,
  projectUserSelection,
  putAnswer,
  questionProgress,
  signalsFromAnswers,
} from '@asi/shared';
import type {
  AnswerMap,
  BodyRegion,
  ConsideredStructure,
  Depth,
  FieldMutation,
  Provenance,
  Side,
  SymptomRecord,
} from '@asi/shared';

/* ------------------------------------------------------------------ */
/* Localisation outcome                                               */
/* ------------------------------------------------------------------ */

export interface GroundedLocalisation {
  status: 'grounded';
  region: BodyRegion;
  side: Side;
  depth: Depth;
  suggestedSubRegionId: string | null;
  consideredStructures: ConsideredStructure[];
  userPhrase: string;
  clarificationQuestion: string | null;
  /**
   * Which orchestrator produced this. `model` means a language model proposed
   * the location; `deterministic` means the offline rules did. The UI shows
   * this to the user so they know how much weight the suggestion carries, and
   * the episode records it, so the provenance of the location is never lost.
   *
   * This was previously missing from the type, which meant the value the server
   * sent was silently dropped and the UI always claimed "offline rules" had
   * read the description.
   */
  by: 'deterministic' | 'model';
}

export interface UnsupportedLocalisation {
  status: 'unsupported';
  reason: 'ungrounded' | 'out_of_scope';
  message: string;
  supportedRegions: BodyRegion[];
}

export type LocalisationOutcome = GroundedLocalisation | UnsupportedLocalisation;

export interface LocalisationApplied {
  record: SymptomRecord;
  considered: ConsideredStructure[];
  allowed: boolean;
  refusal: string | null;
  /**
   * Which orchestrator produced the localisation, carried through unchanged.
   * `null` only when localisation was refused, because nothing was read.
   */
  by: 'deterministic' | 'model' | null;
}

/**
 * Turn a localisation response into session state.
 *
 * On 'unsupported' the record is NOT created and the caller must not continue
 * into the region interview. There is no default region anywhere in this path.
 */
export function applyLocalisation(
  previous: SymptomRecord,
  result: LocalisationOutcome,
): LocalisationApplied {
  if (result.status === 'unsupported') {
    return {
      // Keep the previous record untouched. Do not fabricate a region.
      record: previous,
      considered: [],
      allowed: false,
      refusal: result.message,
      by: null,
    };
  }
  const record = emptyRecord(result.region);
  record.location = {
    ...record.location,
    side: result.side,
    depth: result.depth,
    subRegionId: result.suggestedSubRegionId,
    userPhrase: result.userPhrase,
    point: null,
    userSelectedStructureIds: [],
  };
  record.consideredStructures = result.consideredStructures;
  // Carried through verbatim. The caller must not infer this from the outcome
  // status: a grounded result can come from either orchestrator.
  return { record, considered: result.consideredStructures, allowed: true, refusal: null, by: result.by };
}

/* ------------------------------------------------------------------ */
/* Answers                                                            */
/* ------------------------------------------------------------------ */

export interface AnswerResult {
  record: SymptomRecord;
  answers: AnswerMap;
  /** Field paths the answer actually changed, for the mutation payload. */
  wroteFields: string[];
  answer: ReturnType<typeof buildAnswer>;
}

export function recordAnswer(
  record: SymptomRecord,
  answers: AnswerMap,
  questionId: string,
  raw: unknown,
  triState?: 'yes' | 'no' | 'unknown',
  opts: { edited?: boolean } = {},
): AnswerResult {
  // A correction is labelled at the moment it is made, not inferred later from the fact
  // that an answer already existed. The store re-derives the same fact independently
  // from the row, so a client that lies about it cannot change what is stored.
  const answer = buildAnswer({
    questionId,
    raw,
    triState,
    wroteFields: [],
    provenance: {
      capturedAt: new Date().toISOString(),
      createdBy: 'user',
      sourceType: opts.edited ? 'user_edited' : 'user_statement',
    },
  });
  // applyAnswer is the only thing that mutates the record, and it is shared with
  // the server so the two can never diverge.
  const wroteFields = applyAnswer(record, questionId, answer);
  const withFields = { ...answer, wroteFields };
  return {
    record,
    answers: putAnswer(answers, withFields),
    wroteFields,
    answer: withFields,
  };
}

/** The next question, or null when the region interview is finished. */
export function peekNextQuestion(record: SymptomRecord, answers: AnswerMap) {
  return nextQuestion({ record, answers });
}

export function progressOf(record: SymptomRecord, answers: AnswerMap) {
  return questionProgress({ record, answers });
}

/* ------------------------------------------------------------------ */
/* Visual selection — a location, not a finding                       */
/* ------------------------------------------------------------------ */

/**
 * Select a structure. Writes ONLY the canonical field.
 *
 * The per-candidate `selectedByUser` flag is a derived projection, recomputed
 * by `projectUserSelection` — the same function the server uses in
 * `rebuildRecord` — so the local view and the persisted record cannot disagree
 * about what the user selected.
 */
export function selectStructure(record: SymptomRecord, structureId: string): SymptomRecord {
  return projectUserSelection({
    ...record,
    location: {
      ...record.location,
      userSelectedStructureIds: [...new Set([...record.location.userSelectedStructureIds, structureId])],
    },
  });
}

/**
 * Clear the user's selection WITHOUT destroying the suggestion.
 *
 * The candidate the model proposed is evidence in its own right: it is a
 * plausible reading of what the user described, and the summary reports
 * un-acted-on suggestions so a clinician can see what was considered. Deleting
 * the candidate on deselect threw that information away, and made select →
 * deselect → select a lossy round trip that permanently changed the record.
 *
 * So deselect only removes the id from the canonical set. The candidate stays
 * exactly as the model left it, and the derived flag flips back on its own.
 */
export function deselectStructure(record: SymptomRecord, structureId: string): SymptomRecord {
  return projectUserSelection({
    ...record,
    location: {
      ...record.location,
      userSelectedStructureIds: record.location.userSelectedStructureIds.filter((x) => x !== structureId),
    },
  });
}

/** Plain-language label for a structure, preferring the lay term. */
export function labelFor(structureId: string): string {
  const s = getStructure(structureId);
  if (!s) return structureId;
  return s.layTerm ?? s.label;
}

/* ------------------------------------------------------------------ */
/* Safety                                                             */
/* ------------------------------------------------------------------ */

export function evaluateSession(record: SymptomRecord, answers: AnswerMap) {
  return evaluateSafety(record, {
    region: record.location.region,
    answers,
    signals: signalsFromAnswers(answers, record.location.region),
    profile: 'development',
  });
}

/* ------------------------------------------------------------------ */
/* Mutation payloads                                                  */
/* ------------------------------------------------------------------ */


/*
 * `mutationsForAnswer` and `mutationsForField` moved to `@asi/shared`.
 *
 * They lived here because the browser was once the only thing that recorded an answer.
 * The MCP surface records answers too, and its first version stored the answer without
 * the fields that answer implies -- so "the user says it wakes them at night" became a
 * fact that changed nothing a clinician reads. Two surfaces, one question ("what does
 * this answer write?") means one implementation, in the pure domain where both can reach
 * it without either depending on the other.
 */
export { mutationsForAnswer, mutationsForField } from '@asi/shared';
