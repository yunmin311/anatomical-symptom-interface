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
}

export interface UnsupportedLocalisation {
  status: 'unsupported';
  reason: 'ungrounded' | 'out_of_scope';
  message: string;
  supportedRegions: BodyRegion[];
}

export type LocalisationOutcome = GroundedLocalisation | UnsupportedLocalisation;

/**
 * Turn a localisation response into session state.
 *
 * On 'unsupported' the record is NOT created and the caller must not continue
 * into the region interview. There is no default region anywhere in this path.
 */
export function applyLocalisation(
  previous: SymptomRecord,
  result: LocalisationOutcome,
): { record: SymptomRecord; considered: ConsideredStructure[]; allowed: boolean; refusal: string | null } {
  if (result.status === 'unsupported') {
    return {
      // Keep the previous record untouched. Do not fabricate a region.
      record: previous,
      considered: [],
      allowed: false,
      refusal: result.message,
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
  return { record, considered: result.consideredStructures, allowed: true, refusal: null };
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
): AnswerResult {
  const answer = buildAnswer({
    questionId,
    raw,
    triState,
    wroteFields: [],
    provenance: { capturedAt: new Date().toISOString(), createdBy: 'user' },
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

export function selectStructure(record: SymptomRecord, structureId: string): SymptomRecord {
  record.location.userSelectedStructureIds = [
    ...new Set([...record.location.userSelectedStructureIds, structureId]),
  ];
  record.consideredStructures = record.consideredStructures.map((c) =>
    c.structureId === structureId ? { ...c, selectedByUser: true } : c,
  );
  return record;
}

export function deselectStructure(record: SymptomRecord, structureId: string): SymptomRecord {
  record.location.userSelectedStructureIds = record.location.userSelectedStructureIds.filter(
    (x) => x !== structureId,
  );
  record.consideredStructures = record.consideredStructures.filter((c) => c.structureId !== structureId);
  return record;
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
    signals: signalsFromAnswers(answers),
    profile: 'development',
  });
}

/* ------------------------------------------------------------------ */
/* Mutation payloads                                                  */
/* ------------------------------------------------------------------ */

const userProv = (fieldPath: string, rawText?: string): Provenance => ({
  sourceType: fieldPath.startsWith('location.point') || fieldPath === 'location.subRegionId'
    || fieldPath === 'location.userSelectedStructureIds'
    ? 'user_selection'
    : 'user_statement',
  verificationStatus: 'user_confirmed',
  createdBy: 'user',
  capturedAt: new Date().toISOString(),
  rawText: rawText ?? null,
});

/**
 * Build the mutation payload for the fields an answer wrote.
 *
 * Only the fields the answer actually changed are sent, each with the right
 * source type. A question that writes nothing — every safety-only question —
 * therefore produces an empty mutation list, and the safety signal travels in
 * the ANSWER, not in the record.
 */
export function mutationsForAnswer(
  record: SymptomRecord,
  answer: ReturnType<typeof buildAnswer>,
  wroteFields: string[],
): FieldMutation[] {
  const get = (p: string): unknown =>
    p.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown>)?.[k], record as unknown as Record<string, unknown>);
  return wroteFields.map((fieldPath) => ({
    fieldPath,
    value: get(fieldPath),
    provenance: userProv(fieldPath, answer.provenance.rawText ?? undefined),
  }));
}

export function mutationsForField(fieldPath: string, value: unknown): FieldMutation[] {
  return [{ fieldPath, value, provenance: userProv(fieldPath) }];
}
