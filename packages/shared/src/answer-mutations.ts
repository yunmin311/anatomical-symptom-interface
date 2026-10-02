/**
 * Turning an answer into the field mutations it implies.
 *
 * ## Why this moved out of the web app
 *
 * `mutationsForAnswer` lived in `apps/web/src/state/logic.ts`, because the browser was the
 * only thing that recorded an answer. The MCP surface records answers too, and its first
 * version called the tool and stored the answer without the fields that answer implied --
 * so "the user said their shoulder wakes them at night" recorded a fact and changed
 * nothing the clinician reads. An answer that does not update the record is a decoration.
 *
 * So the mapping is here, in the pure domain, and BOTH surfaces use it. One
 * implementation of "what does this answer write", which is the only way two surfaces
 * agree on what a patient said.
 *
 * ## The rules it encodes
 *
 * - An answer writes EXACTLY the fields its `applyTo` touched, and no others.
 * - Each of those fields carries `user_confirmed`, because the user confirmed it by
 *   answering. An answer that was never confirmed is not a fact.
 * - A LOCATION field written by an answer is `user_selection`, not `user_statement`. The
 *   distinction is not cosmetic: they merge under different claim classes, so a pin placed
 *   by pointing and a pin stated in words can both survive.
 */
import type { Provenance } from './provenance.ts';
import type { SymptomRecord } from './symptom.ts';
import type { QuestionAnswer } from './answers.ts';
import type { FieldMutation } from './field-policy.ts';

/**
 * Provenance for a value the user gave directly.
 *
 * `user_confirmed` here, not `unverified`: the user stated it. That is the one claim class
 * the product treats as a user fact, and it is reachable only because a human said so.
 */
export function userProvenance(
  fieldPath: string,
  rawText?: string,
  capturedAt: string = new Date().toISOString(),
): Provenance {
  return {
    sourceType:
      fieldPath.startsWith('location.point') ||
      fieldPath === 'location.subRegionId' ||
      fieldPath === 'location.userSelectedStructureIds'
        ? 'user_selection'
        : 'user_statement',
    verificationStatus: 'user_confirmed',
    createdBy: 'user',
    capturedAt,
    rawText: rawText ?? null,
  };
}

/** Read a dotted path out of a record, for turning written paths into values. */
function readPath(record: SymptomRecord, fieldPath: string): unknown {
  return fieldPath
    .split('.')
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      record as unknown as Record<string, unknown>,
    );
}

/**
 * The mutations for the fields an answer wrote.
 *
 * The `record` must already have had the answer applied, because the VALUES come from it:
 * "the answer wrote `triggers`" is not enough, the new value of `triggers` is what gets
 * stored.
 */
export function mutationsForAnswer(
  record: SymptomRecord,
  answer: QuestionAnswer,
  wroteFields: readonly string[],
  capturedAt?: string,
): FieldMutation[] {
  return wroteFields.map((fieldPath) => ({
    fieldPath,
    value: readPath(record, fieldPath),
    provenance: userProvenance(fieldPath, answer.provenance.rawText ?? undefined, capturedAt),
  }));
}

/** One mutation for one directly-stated field. */
export function mutationsForField(
  fieldPath: string,
  value: unknown,
  capturedAt?: string,
): FieldMutation[] {
  return [{ fieldPath, value, provenance: userProvenance(fieldPath, undefined, capturedAt) }];
}