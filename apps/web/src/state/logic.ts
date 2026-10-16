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
  ANSWER_DERIVED_FIELD_PATHS,
  applyAnswer,
  buildAnswer,
  emptyRecord,
  evaluateSafety,
  fieldsFromAnswers,
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

/** Read a dotted path out of a record. */
function readPath(record: SymptomRecord, fieldPath: string): unknown {
  return fieldPath
    .split('.')
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      record as unknown as Record<string, unknown>,
    );
}

/** A copy of the record with one dotted path replaced. Never mutates the input. */
function withPath(record: SymptomRecord, fieldPath: string, value: unknown): SymptomRecord {
  const [head, child, extra] = fieldPath.split('.');
  // Safe: the only caller passes closed answer-derived paths, and all of them have one
  // segment or two. Anything else means the registry invariant changed, so failing here
  // is safer than writing to a guessed container.
  if (head === undefined || extra !== undefined || (fieldPath.includes('.') && child === undefined)) {
    throw new Error(`[state] cannot set malformed answer-derived path "${fieldPath}"`);
  }
  if (child === undefined) return { ...record, [head]: value } as SymptomRecord;
  const container = (record as unknown as Record<string, unknown>)[head];
  if (typeof container !== 'object' || container === null) {
    throw new Error(`[state] cannot set "${fieldPath}" on a missing container`);
  }
  return {
    ...record,
    [head]: { ...container, [child]: value },
  } as SymptomRecord;
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
  const baseline = new Map(
    ANSWER_DERIVED_FIELD_PATHS.map((path) => [path, JSON.stringify(readPath(record, path))] as const),
  );
  // applyAnswer is the only thing that mutates the record, and it is shared with
  // the server so the two can never diverge.
  const claimedFields = applyAnswer(record, questionId, answer);
  const nextAnswers = putAnswer(answers, answer);

  /*
    RECONCILE FROM THE WHOLE ANSWER SET, WITHOUT INVENTING ABSENT VALUES.
    ======================================================================

    `applyAnswer` mutates the record one answer at a time, so it can only withdraw what the
    SAME question wrote. The server does not work that way at all:
    `answerDerivedMutations` replays the entire answer set into an empty record, so it
    withdraws anything the current answers no longer support.

    The two agree only when every withdrawal is expressible within one question, and three
    shoulder answers were not. Measured through the real store, before this:

      injury_context   injury -> unknown          screen "injury",  store no mechanism
      radiation        hand_tingle -> unsure      screen kept it,   store cleared it
      radiation        hand_tingle -> lateral_arm screen kept numbness, store cleared it

    A patient corrected an answer, watched the screen refuse to change, reopened the episode
    and found the correction had been saved all along. The screen was wrong, and nothing in
    the app compared the two.

    So the browser now asks the SAME function the server asks, and writes only the
    difference. A path is reported only when its final value differs from the value before
    this answer. An absent field is not backfilled with a schema default merely because the
    recompute has one: that is exactly the fabricated provenance the store refuses to
    create for safety-only answers.

    `location.*` is untouched by construction: `ANSWER_DERIVED_FIELD_PATHS` excludes it,
    so a recompute can never erase where the patient pointed.
  */
  const derived = fieldsFromAnswers(record.location.region, nextAnswers);
  const paths: string[] = [];
  for (const path of ANSWER_DERIVED_FIELD_PATHS) {
    const before = baseline.get(path);
    const current = JSON.stringify(readPath(record, path));
    const next = JSON.stringify(derived[path]);
    if (next === before) continue;
    // Preserve genuine absence. When a field was absent, remains absent after this answer's
    // own mapping, and differs from the recompute only because the recompute has a default,
    // there is nothing to withdraw and nothing to report.
    if (before === undefined && current === undefined && !claimedFields.includes(path)) continue;
    record = withPath(record, path, derived[path]);
    paths.push(path);
  }

  const withFields = { ...answer, wroteFields: paths };
  return {
    record,
    answers: putAnswer(answers, withFields),
    wroteFields: paths,
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
