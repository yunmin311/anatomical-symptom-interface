/**
 * Episode repository — the ONLY writer of clinical/user-record state.
 *
 * Design: there is exactly one way to change a record, `applyMutations`. It
 * validates each value against the field registry, validates its provenance,
 * runs the claim-class merge, writes the field row (value + provenance
 * together), records any losing value as a preserved parallel assertion, then
 * rebuilds the materialised record projection — all inside ONE transaction.
 *
 * Because value and provenance share a row and share a transaction, they cannot
 * diverge. There is deliberately no exported function that writes one without
 * the other, and no endpoint that accepts a whole client-supplied record.
 */
import { randomUUID } from 'node:crypto';
import {
  assertFieldWrite,
  assertProvenance,
  buildAnswer,
  buildPreVisitSummary,
  emptyRecord,
  evaluateSafety,
  evidenceStatusFor,
  FieldPolicyError,
  getFieldPolicy,
  mergeField,
  projectUserSelection,
  QuestionAnswerSchema,
  renderPlainText,
  signalsFromAnswers,
  SymptomRecordSchema,
  writablePaths,
} from '@asi/shared';
import type {
  AnswerMap,
  Attributed,
  ClaimClass,
  Episode,
  PreVisitSummary,
  Provenance,
  QuestionAnswer,
  ReleaseProfile,
  SafetyEvaluation,
  SymptomRecord,
} from '@asi/shared';
import type { FieldMutation as SharedFieldMutation } from '@asi/shared';
import { all, get, run, tx } from './client.ts';

const now = () => new Date().toISOString();

export class MutationRejected extends Error {
  readonly fieldPath: string | undefined;
  constructor(message: string, fieldPath?: string) {
    super(message);
    this.name = 'MutationRejected';
    this.fieldPath = fieldPath;
  }
}

/* ------------------------------------------------------------------ */
/* Grounding                                                           */
/* ------------------------------------------------------------------ */

export type GroundingStatus = 'grounded' | 'unsupported';

export interface GroundingInfo {
  status: GroundingStatus;
  reason: 'ungrounded' | 'out_of_scope' | null;
  by: 'deterministic' | 'model' | null;
  score: number | null;
  clarification: string | null;
}

/* ------------------------------------------------------------------ */
/* Field store reads                                                   */
/* ------------------------------------------------------------------ */

interface FieldRow {
  field_path: string;
  value_json: string;
  source_type: Provenance['sourceType'];
  source_reference: string | null;
  captured_at: string;
  confidence: number | null;
  verification_status: Provenance['verificationStatus'];
  created_by: string;
  raw_text: string | null;
  evidence_status: NonNullable<Provenance['evidenceStatus']>;
  claim_class: ClaimClass;
}

function rowToAttributed<T>(row: FieldRow): Attributed<T> {
  return {
    value: JSON.parse(row.value_json) as T,
    provenance: {
      sourceType: row.source_type,
      sourceReference: row.source_reference,
      capturedAt: row.captured_at,
      confidence: row.confidence,
      verificationStatus: row.verification_status,
      createdBy: row.created_by,
      rawText: row.raw_text,
      evidenceStatus: row.evidence_status,
    },
  };
}

function fieldRows(episodeId: string): FieldRow[] {
  return all(
    `SELECT field_path, value_json, source_type, source_reference, captured_at, confidence,
            verification_status, created_by, raw_text, evidence_status, claim_class
       FROM episode_fields WHERE episode_id = ?`,
    episodeId,
  ) as unknown as FieldRow[];
}

export function fieldStoreFor(episodeId: string): Record<string, Attributed<unknown>> {
  const out: Record<string, Attributed<unknown>> = {};
  for (const row of fieldRows(episodeId)) out[row.field_path] = rowToAttributed(row);
  return out;
}

export function provenanceFor(episodeId: string): Record<string, Provenance> {
  const out: Record<string, Provenance> = {};
  for (const row of fieldRows(episodeId)) out[row.field_path] = rowToAttributed(row).provenance;
  return out;
}

/** Which registry fields have a stored value. The honest basis for the summary. */
export function coverageFor(episodeId: string): Record<string, boolean> {
  const paths = new Set(fieldRows(episodeId).map((r) => r.field_path));
  const out: Record<string, boolean> = {};
  for (const p of writablePaths()) out[p] = paths.has(p);
  return out;
}

export function preservedAssertions(episodeId: string): { fieldPath: string; sourceType: string; reason: string; value: unknown }[] {
  return all(
    `SELECT field_path, value_json, source_type, reason FROM episode_assertions WHERE episode_id = ?`,
    episodeId,
  ).map((r) => ({
    fieldPath: String(r.field_path),
    sourceType: String(r.source_type),
    reason: String(r.reason),
    value: JSON.parse(String(r.value_json)) as unknown,
  }));
}

/* ------------------------------------------------------------------ */
/* Answers                                                             */
/* ------------------------------------------------------------------ */

export function answersFor(episodeId: string): AnswerMap {
  const rows = all(
    `SELECT question_id, raw_json, tri_state, wrote_fields_json, source_type, captured_at,
            verification_status, created_by, raw_text
       FROM episode_answers WHERE episode_id = ?`,
    episodeId,
  );
  const out: Record<string, QuestionAnswer> = {};
  for (const r of rows) {
    const parsed = QuestionAnswerSchema.safeParse({
      questionId: String(r.question_id),
      raw: JSON.parse(String(r.raw_json)) as unknown,
      triState: String(r.tri_state),
      wroteFields: JSON.parse(String(r.wrote_fields_json)) as string[],
      provenance: {
        // READ FROM THE ROW, not assumed.
        //
        // This selected `source_type` and then wrote a literal `'user_statement'`, so
        // every answer came back looking like a first answer -- including one the user
        // had corrected. The column was in the query the whole time. A clinician
        // reading the record could not tell a statement from a correction, which is
        // the whole reason the column exists.
        sourceType: String(r.source_type),
        capturedAt: String(r.captured_at),
        verificationStatus: String(r.verification_status),
        createdBy: String(r.created_by),
        rawText: r.raw_text as string | null,
      },
    });
    if (parsed.success) out[parsed.data.questionId] = parsed.data;
  }
  return Object.freeze(out);
}

/* ------------------------------------------------------------------ */
/* The atomic mutation path                                            */
/* ------------------------------------------------------------------ */

export interface FieldMutation extends SharedFieldMutation {}

export interface AnswerMutation {
  questionId: string;
  raw: unknown;
  /** Fields the answer wrote. Validated against what applyAnswer actually wrote. */
  wroteFields: string[];
  capturedAt?: string;
  createdBy: string;
  rawText?: string | null;
}

export interface ApplyInput {
  fieldMutations?: FieldMutation[];
  answerMutations?: AnswerMutation[];
  /** Change the episode status in the same transaction. */
  status?: Episode['status'];
}

export interface ApplyOutcome {
  applied: { fieldPath: string; action: 'written' | 'kept_incumbent' | 'recorded_in_parallel' }[];
  /**
   * Always empty on a successful return. A field that fails validation throws
   * and rolls the batch back, so a client is never told a forbidden write
   * succeeded. Kept in the type so a future soft-fail path is explicit.
   */
  rejected: { fieldPath: string; reason: string }[];
  answers: { questionId: string; triState: string; replaced: boolean }[];
  coverage: Record<string, boolean>;
  preserved: number;
  safety: SafetyEvaluation;
}

/**
 * THE single write path. Validates, merges, writes, rebuilds, re-evaluates
 * safety, all in one transaction. Any rejection rolls the whole thing back.
 */
export function applyMutations(episodeId: string, input: ApplyInput, profile: ReleaseProfile = 'development'): ApplyOutcome {
  const ep = get<{ region: string; grounding_status: string }>(
    `SELECT region, grounding_status FROM episodes WHERE id = ?`, episodeId,
  );
  if (!ep) throw new MutationRejected(`episode ${episodeId} not found`);

  return tx(() => {
    const record = readRecord(episodeId, ep.region);
    const applied: ApplyOutcome['applied'] = [];
    const rejected: ApplyOutcome['rejected'] = [];
    const answerResults: ApplyOutcome['answers'] = [];

    // 1. Answers first: a safety question's signal must exist before rules run.
    //
    //    EDITING AN ANSWER REPLACES IT. It does not append a second, contradicting
    //    answer: `raw_json` is keyed on (episode, question), so a second value for the
    //    same question would make "what did the user say about this" unanswerable, and
    //    a safety question with two values would have to pick one silently.
    //
    //    The replacement is marked `user_edited` rather than `user_statement`, because
    //    "the user said this" and "the user CORRECTED what they said" are different
    //    facts and a clinician reading the record is entitled to tell them apart.
    //
    //    KNOWN LIMITATION, deliberate and documented: this stores the CURRENT value
    //    only. The original answer is overwritten, not kept, so there is no audit trail
    //    of what was first said. Adding one would be an event-sourced medical record,
    //    which this product is explicitly not at V1. What is kept is that the value
    //    now carries `user_edited`, so a reader knows it was corrected, and
    //    `captured_at` is the moment the CURRENT value was given. See
    //    docs/known-limitations.md.
    for (const m of input.answerMutations ?? []) {
      const prior = get<{ captured_at: string }>(
        `SELECT captured_at FROM episode_answers WHERE episode_id = ? AND question_id = ?`,
        episodeId,
        m.questionId,
      );
      const isEdit = Boolean(prior);

      const answer = buildAnswer({
        questionId: m.questionId,
        raw: m.raw,
        wroteFields: m.wroteFields,
        provenance: {
          // The moment the CURRENT value was given: the edit, not the original.
          capturedAt: m.capturedAt ?? now(),
          createdBy: m.createdBy,
          rawText: m.rawText ?? null,
        },
      });
      run(
        `INSERT INTO episode_answers
           (episode_id, question_id, raw_json, tri_state, wrote_fields_json, source_type,
            captured_at, verification_status, created_by, raw_text)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(episode_id, question_id) DO UPDATE SET
           raw_json = excluded.raw_json,
           tri_state = excluded.tri_state,
           wrote_fields_json = excluded.wrote_fields_json,
           source_type = excluded.source_type,
           captured_at = excluded.captured_at,
           -- The editor is whoever made THIS value. Leaving the original author in
           -- place would attribute a correction to whoever typed the first answer.
           created_by = excluded.created_by,
           verification_status = excluded.verification_status,
           raw_text = excluded.raw_text`,
        episodeId,
        m.questionId,
        JSON.stringify(answer.raw),
        answer.triState,
        JSON.stringify(answer.wroteFields),
        isEdit ? 'user_edited' : 'user_statement',
        answer.provenance.capturedAt,
        'unverified',
        answer.provenance.createdBy,
        answer.provenance.rawText ?? null,
      );
      answerResults.push({
        questionId: m.questionId,
        triState: answer.triState,
        // So a caller can report the correction rather than silently accepting it.
        replaced: isEdit,
      });
    }

    // 2. Field mutations.
    //    A field that fails POLICY VALIDATION is fatal to the whole batch: the
    //    client asked to write something forbidden, and silently committing the
    //    rest of the batch would tell it the write succeeded. Validation
    //    failures throw and roll the transaction back.
    //    A field that merely LOSES A MERGE is not fatal: the incoming value is
    //    preserved as a parallel assertion and the incumbent stands.
    for (const m of input.fieldMutations ?? []) {
      const policy = getFieldPolicy(m.fieldPath);
      if (!policy) {
        throw new FieldPolicyError(
          `[store] "${m.fieldPath}" is not a writable field. ` +
            `Every persisted field needs a declared provenance strategy.`,
          m.fieldPath,
        );
      }

      const provenance: Provenance = {
        ...m.provenance,
        capturedAt: m.provenance.capturedAt ?? now(),
        evidenceStatus: m.provenance.evidenceStatus ?? evidenceStatusFor(m.provenance.sourceType),
      };

      const value = assertFieldWrite(m.fieldPath, m.value, provenance);
      assertProvenance(m.fieldPath, provenance);

      const existing = get<FieldRow>(
        `SELECT field_path, value_json, source_type, source_reference, captured_at, confidence,
                verification_status, created_by, raw_text, evidence_status, claim_class
           FROM episode_fields WHERE episode_id = ? AND field_path = ?`,
        episodeId, m.fieldPath,
      );
      const incumbent = existing ? rowToAttributed(existing) : null;
      const outcome = mergeField(incumbent, { value, provenance }, policy.claimClass);

      if (outcome.applied && outcome.winner) {
        const p = outcome.winner.provenance;
        run(
          `INSERT INTO episode_fields
             (episode_id, field_path, value_json, source_type, source_reference, captured_at,
              confidence, verification_status, created_by, raw_text, evidence_status, claim_class)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(episode_id, field_path) DO UPDATE SET
             value_json = excluded.value_json,
             source_type = excluded.source_type,
             source_reference = excluded.source_reference,
             captured_at = excluded.captured_at,
             confidence = excluded.confidence,
             verification_status = excluded.verification_status,
             created_by = excluded.created_by,
             raw_text = excluded.raw_text,
             evidence_status = excluded.evidence_status,
             claim_class = excluded.claim_class`,
          episodeId, m.fieldPath, JSON.stringify(outcome.winner.value),
          p.sourceType, p.sourceReference ?? null, p.capturedAt, p.confidence ?? null,
          p.verificationStatus, p.createdBy, p.rawText ?? null,
          p.evidenceStatus ?? evidenceStatusFor(p.sourceType), policy.claimClass,
        );
        applied.push({ fieldPath: m.fieldPath, action: 'written' });
      } else {
        applied.push({ fieldPath: m.fieldPath, action: 'kept_incumbent' });
      }

      // Losers are kept, so a lab report can sit alongside what the patient
      // feels instead of replacing it.
      if (outcome.preserved.length && incumbent) {
        for (const pres of outcome.preserved) {
          run(
            `INSERT INTO episode_assertions
               (id, episode_id, field_path, value_json, source_type, evidence_status, reason, captured_at)
             VALUES (?,?,?,?,?,?,?,?)`,
            randomUUID(), episodeId, m.fieldPath, JSON.stringify(pres.value),
            pres.provenance.sourceType, pres.provenance.evidenceStatus ?? evidenceStatusFor(pres.provenance.sourceType),
            pres.reason, pres.provenance.capturedAt,
          );
        }
        applied.push({ fieldPath: m.fieldPath, action: 'recorded_in_parallel' });
      }
    }

    if (input.status) {
      run(
        `UPDATE episodes SET status = ?, updated_at = ? WHERE id = ?`,
        input.status, now(), episodeId,
      );
    }

    // 3. Rebuild the materialised projection, then gaps from real coverage.
    const rebuilt = rebuildRecord(episodeId, ep.region);
    run(`UPDATE episodes SET record_json = ?, updated_at = ? WHERE id = ?`, JSON.stringify(rebuilt), now(), episodeId);

    // 3b. Keep the spatial index in step with the record. See syncSpatialIndex:
    // body_regions is a derived index of where episodes are, and it was never
    // being updated, so point_x/point_y and sub_region_id were permanently NULL
    // and the personal health map had nothing to draw.
    syncSpatialIndex(episodeId, rebuilt);

    // 4. Safety, from the answer-derived signals.
    const answers = answersFor(episodeId);
    const safety = evaluateSafety(rebuilt, {
      region: rebuilt.location.region,
      answers,
      signals: signalsFromAnswers(answers, rebuilt.location.region),
      profile,
    });
    recordSafetyFlags(episodeId, safety, profile);

    return {
      applied,
      rejected,
      answers: answerResults,
      coverage: coverageFor(episodeId),
      preserved: preservedAssertions(episodeId).length,
      safety,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Record projection                                                   */
/* ------------------------------------------------------------------ */

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
}

/**
 * Rebuild the record from the field store. `gaps` is derived here from which
 * registry fields have no value — which is the only thing that should ever
 * populate it, and guarantees it can never contain an answer marker.
 */
/**
 * Rebuild the record from the field store. Two things are DERIVED here and are
 * never read from the field store directly:
 *
 *  - `gaps` from which registry fields have no value. `gaps` means MISSING
 *    INFORMATION ONLY, which is what makes it incapable of holding an answer
 *    marker.
 *  - `consideredStructures[].selectedByUser` from
 *    `location.userSelectedStructureIds`. The id set is canonical; a client
 *    that writes a contradictory flag has it overwritten here, so the record
 *    can never read as a candidate being both selected and unselected.
 */
function rebuildRecord(episodeId: string, region: string): SymptomRecord {
  const record = emptyRecord(region as never);
  const store = fieldStoreFor(episodeId);
  for (const [path, attributed] of Object.entries(store)) {
    if (path === 'gaps') continue;
    setPath(record as unknown as Record<string, unknown>, path, attributed.value);
  }
  const coverage = coverageFor(episodeId);
  record.gaps = writablePaths()
    .filter((p) => !coverage[p])
    .filter((p) => {
      // A field whose value is a schema placeholder is still "not recorded".
      const v = store[p]?.value;
      return v === null || v === undefined || v === 'unknown' || v === 'no' || v === '' || (Array.isArray(v) && v.length === 0);
    });
  return SymptomRecordSchema.parse(projectUserSelection(record));
}

function readRecord(episodeId: string, region: string): SymptomRecord {
  return rebuildRecord(episodeId, region);
}

/**
 * PLACE IDENTITY.
 *
 * A "place" is one entry in the personal anatomical health map. Its identity is:
 *
 *     (person, region, side, subRegion, cell)
 *
 * where `cell` is the normalised pin quantised onto a grid. Region, side and
 * sub-region alone are NOT enough, and the two defects that proved it are
 * written up in migration 003. In short: two episodes in the same sub-region at
 * different pins are two places, and two episodes at the same pin are one place
 * with a count of two.
 *
 * Why the point is part of identity rather than an attribute: the same shoulder
 * genuinely sore in two clearly different places is two entries in a body
 * history, and collapsing them would misrepresent it. Why it is QUANTISED rather
 * than exact: a body map is a schematic, and two pins a few pixels apart are the
 * same place to a person. Exact floats would make every re-click a new place and
 * the map would fill with near-identical dots, which is its own kind of lie.
 *
 * The cell size is a deliberate product decision, stated here so it can be argued
 * with: 0.05 of the normalised body map is 20x20 cells across a region, which on
 * the current schematic is roughly the size of a fingertip.
 */
export const LOCATION_CELL = 0.05;

/** The grid cell a normalised pin falls in, or null when no pin was placed. */
export function locationCell(point: { x: number; y: number } | null | undefined): {
  x: number;
  y: number;
} | null {
  if (!point) return null;
  const clamp = (v: number) => Math.min(0.999_999, Math.max(0, v));
  return {
    x: Math.floor(clamp(point.x) / LOCATION_CELL),
    y: Math.floor(clamp(point.y) / LOCATION_CELL),
  };
}

/**
 * Keep `body_regions` in step with the records it indexes.
 *
 * `body_regions` is a DERIVED spatial index: it exists so the health map can group
 * episodes by place and read a pin without scanning every record. It is not a
 * second source of truth, so it is rebuilt from the records rather than written by
 * the client.
 *
 * Called from `applyMutations`, inside the one transaction that writes the record,
 * so a pin cannot be stored without the index following it.
 *
 * MEMBERSHIP IS DERIVED, NEVER COUNTED. There is no increment or decrement. The
 * aggregates on a place are recomputed from the episodes that actually point at
 * it, which is what makes the index re-derivable: it cannot drift, it cannot
 * double-count, and a restart changes nothing. The earlier version incremented
 * nothing but did overwrite point columns, so it inherited the same class of bug.
 *
 * Re-homing is the other half. When an episode's location changes, it has to LEAVE
 * the place it was in and JOIN the place it is now in, or the old place would keep
 * counting a location that is no longer there.
 */
function syncSpatialIndex(episodeId: string, record: SymptomRecord): void {
  const ep = get<{ region_id: string; side: string; person_id: string }>(
    `SELECT region_id, side, person_id FROM episodes WHERE id = ?`, episodeId,
  );
  if (!ep) return;

  const store = fieldStoreFor(episodeId);
  const loc = record.location;

  // `location.side` carries a schema DEFAULT of 'unknown'. A record where the
  // user never chose a side has NOT said "unknown" -- they have said nothing --
  // and copying that default over the region row would drag every place to
  // 'unknown' and collapse left and right into one. Localisation's side stands
  // unless the field store holds an actual side.
  const side = store['location.side'] ? loc.side : ep.side;
  const sub = loc.subRegionId ?? null;
  const cell = locationCell(loc.point);
  const previousRegionId = ep.region_id;

  const placeId = findOrCreatePlace(ep.person_id, loc.region, side, sub, cell);

  if (placeId !== previousRegionId) {
    run(`UPDATE episodes SET region_id = ? WHERE id = ?`, placeId, episodeId);
    // The place this episode left has to stop counting it.
    refreshPlaceAggregates(previousRegionId);
  }
  refreshPlaceAggregates(placeId);
}

/** Find the place row for a key, creating it if this is the first episode there. */
function findOrCreatePlace(
  personId: string,
  region: string,
  side: string,
  subRegionId: string | null,
  cell: { x: number; y: number } | null,
): string {
  const existing = get<{ id: string }>(
    `SELECT id FROM body_regions
      WHERE person_id = ?
        AND region = ?
        AND side = ?
        AND IFNULL(sub_region_id, '') = IFNULL(?, '')
        AND IFNULL(point_cell_x, -1) = IFNULL(?, -1)
        AND IFNULL(point_cell_y, -1) = IFNULL(?, -1)
      LIMIT 1`,
    personId, region, side, subRegionId, cell?.x ?? null, cell?.y ?? null,
  );
  if (existing) return existing.id;

  const id = randomUUID();
  run(
    `INSERT INTO body_regions
       (id, person_id, region, side, sub_region_id,
        point_x, point_y, point_cell_x, point_cell_y, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, personId, region, side, subRegionId,
    // The representative point starts as this episode's own pin; the aggregate
    // pass below recomputes it as the mean of the pins that land here.
    null, null, cell?.x ?? null, cell?.y ?? null, now(), now(),
  );
  return id;
}

/**
 * Recompute one place's aggregates from the episodes that point at it.
 *
 * The representative point is the MEAN of the member pins, not the last one
 * written. Last-writer-wins was the original bug: one episode's location changed
 * because another episode existed.
 *
 * A place with no episodes is not a place, so it is deleted. That also cleans up
 * the row `createEpisode` speculatively creates before the mutations run, and any
 * place an episode has moved away from.
 */
function refreshPlaceAggregates(regionRowId: string): void {
  if (!regionRowId) return;
  const members = all(
    `SELECT record_json FROM episodes WHERE region_id = ?`,
    regionRowId,
  );
  if (!members.length) {
    run(`DELETE FROM body_regions WHERE id = ?`, regionRowId);
    return;
  }

  const pins: { x: number; y: number }[] = [];
  for (const m of members) {
    try {
      const record = JSON.parse(String(m.record_json)) as {
        location?: { point?: { x: number; y: number } | null };
      };
      const p = record.location?.point;
      if (p && typeof p.x === 'number' && typeof p.y === 'number') pins.push(p);
    } catch {
      // A record projection that will not parse must not take the map down. The
      // place still exists; it just contributes no representative point.
    }
  }

  const meanX = pins.length ? pins.reduce((a, p) => a + p.x, 0) / pins.length : null;
  const meanY = pins.length ? pins.reduce((a, p) => a + p.y, 0) / pins.length : null;

  run(
    `UPDATE body_regions SET point_x = ?, point_y = ?, updated_at = ? WHERE id = ?`,
    meanX, meanY, now(), regionRowId,
  );
}

/* ------------------------------------------------------------------ */
/* Safety flags                                                        */
/* ------------------------------------------------------------------ */

/**
 * The safety flags currently standing for an episode.
 *
 * Read-only on purpose: flags are produced by evaluating the rules against the current
 * record and answers, and written by `recordSafetyFlags`. Nothing may set one directly,
 * because a flag whose provenance is a hand-set row is a warning nobody can trace.
 */
export function safetyFlags(episodeId: string): { ruleId: string; severity: string; userMessage: string }[] {
  return (
    all(
      `SELECT rule_id, severity, user_message FROM safety_flags WHERE episode_id = ? ORDER BY rule_id`,
      episodeId,
    ) as { rule_id: string; severity: string; user_message: string }[]
  ).map((r) => ({ ruleId: r.rule_id, severity: r.severity, userMessage: r.user_message }));
}

/**
 * Persist the safety evaluation for an episode.
 *
 * ## WHY THE DELETE IS THE INTERESTING LINE
 *
 * This used to INSERT only, with a `if (exists) continue` guard. That guard reads like
 * idempotence and is actually the bug: a rule that stopped firing was never removed, so
 * a user who answered "yes" and then corrected it to "no" kept an emergency flag
 * describing an answer they had withdrawn.
 *
 * A flag that outlives the evidence for it is worse than no flag at all -- it tells a
 * clinician to act on something the patient has since said is not true, and unlike a
 * missing warning it cannot be reasoned past.
 *
 * So the flag table is made to MATCH the current evaluation: anything the rules no
 * longer produce is deleted, and anything they do is inserted or left alone.
 * `raised_at` for a surviving flag is preserved, because when a warning first
 * appeared is true and worth keeping; it is re-stamped only when the flag genuinely
 * changes severity.
 */
function recordSafetyFlags(episodeId: string, safety: SafetyEvaluation, profile: ReleaseProfile): void {
  const fired = new Set(safety.flags.map((f) => f.ruleId));

  // Withdraw first, so a rule that stopped firing disappears. Doing it before the
  // inserts also means a rule cannot briefly exist twice.
  const current = all(
    `SELECT id, rule_id, severity FROM safety_flags WHERE episode_id = ?`,
    episodeId,
  ) as { id: string; rule_id: string; severity: string }[];
  for (const row of current) {
    if (fired.has(row.rule_id)) continue;
    run(`DELETE FROM safety_flags WHERE id = ?`, row.id);
    appendTranscript(
      episodeId,
      'system',
      `[safety:withdrawn] "${row.rule_id}" no longer applies. It was raised from an answer the ` +
        `user has since corrected, so the flag has been removed rather than left describing ` +
        `a symptom the user no longer reports.`,
    );
  }

  for (const f of safety.flags) {
    const existing = current.find((row) => row.rule_id === f.ruleId);
    if (existing) {
      // Keep raised_at: when a warning first appeared is true. Re-stamp only when the
      // severity actually changed, so a clinician can see the flag escalated.
      if (existing.severity !== f.severity)
        run(`UPDATE safety_flags SET severity = ?, user_message = ? WHERE id = ?`, f.severity, f.userMessage, existing.id);
      continue;
    }
    run(
      `INSERT INTO safety_flags (id, episode_id, rule_id, severity, user_message, review_status, profile, raised_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      randomUUID(), episodeId, f.ruleId, f.severity, f.userMessage, f.reviewStatus, profile, now(),
    );
  }
  if (safety.blocked) {
    // The release profile withheld a time-critical rule. Record that as an
    // explicit system entry, so a clinician reading the record can see that
    // something fired and was held back.
    appendTranscript(
      episodeId,
      'system',
      `[safety:blocked] ${safety.withheld.length} rule(s) fired but are not clinically reviewed ` +
        `and were withheld in the "${profile}" profile: ${safety.withheld.map((w) => w.ruleId).join(', ')}. ` +
        `This record must not be treated as safely assessed.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Persons & regions                                                   */
/* ------------------------------------------------------------------ */

export function ensurePerson(id: string, displayName: string): void {
  run(
    `INSERT INTO persons (id, display_name, created_at) VALUES (?,?,?)
     ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name`,
    id, displayName, now(),
  );
}

export function ensureRegion(
  personId: string,
  region: string,
  side: string,
  subRegionId: string | null | undefined,
  point: { x: number; y: number } | null | undefined,
): string {
  const sub = subRegionId ?? null;
  const existing = get<{ id: string }>(
    `SELECT id FROM body_regions
      WHERE person_id = ? AND region = ? AND side = ? AND IFNULL(sub_region_id,'') = IFNULL(?,'')`,
    personId, region, side, sub,
  );
  if (existing) {
    if (point) {
      run(`UPDATE body_regions SET point_x = ?, point_y = ?, updated_at = ? WHERE id = ?`,
        point.x, point.y, now(), existing.id);
    }
    return existing.id;
  }
  const id = randomUUID();
  run(
    `INSERT INTO body_regions (id, person_id, region, side, sub_region_id, point_x, point_y, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id, personId, region, side, sub, point?.x ?? null, point?.y ?? null, now(), now(),
  );
  return id;
}

/* ------------------------------------------------------------------ */
/* Episodes                                                            */
/* ------------------------------------------------------------------ */

export interface CreateEpisodeInput {
  personId: string;
  displayName?: string;
  region: string;
  side?: string;
  title?: string;
  grounding: GroundingInfo;
  /** Initial field writes, each validated and given provenance. */
  mutations?: FieldMutation[];
  answers?: AnswerMutation[];
}

/**
 * Create an episode. The client never supplies a record; it supplies grounding
 * plus field mutations, and the record is built by the same validated path.
 */
export function createEpisode(input: CreateEpisodeInput): Episode {
  return tx(() => {
    ensurePerson(input.personId, input.displayName ?? 'Me');
    const side = input.side ?? 'unknown';
    const regionId = ensureRegion(input.personId, input.region, side, null, null);
    const id = randomUUID();
    const title = input.title ?? `${input.region} — ${new Date().toISOString().slice(0, 10)}`;

    run(
      `INSERT INTO episodes
         (id, person_id, region_id, region, side, status, title,
          grounding_status, grounding_reason, grounding_by, grounding_score, grounding_clarification,
          record_json, started_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.personId, regionId, input.region, side, 'open', title,
      input.grounding.status, input.grounding.reason, input.grounding.by,
      input.grounding.score, input.grounding.clarification,
      JSON.stringify(emptyRecord(input.region as never)), now(), now(), now(),
    );

    if (input.mutations?.length || input.answers?.length) {
      applyMutations(id, { fieldMutations: input.mutations, answerMutations: input.answers });
    }
    const episode = getEpisode(id);
    if (!episode) throw new MutationRejected(`episode ${id} not found after create`);
    return episode;
  });
}

function hydrate(row: Record<string, unknown>): Episode {
  const id = String(row.id);
  const record = SymptomRecordSchema.parse(JSON.parse(String(row.record_json)));
  const flags = all(
    `SELECT rule_id, severity, user_message, review_status, raised_at
       FROM safety_flags WHERE episode_id = ? ORDER BY raised_at`,
    id,
  );
  return {
    id,
    personId: String(row.person_id),
    region: String(row.region) as Episode['region'],
    side: String(row.side) as Episode['side'],
    status: String(row.status) as Episode['status'],
    title: String(row.title),
    record,
    provenance: provenanceFor(id),
    startedAt: String(row.started_at),
    endedAt: (row.ended_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    safetyFlags: flags.map((f) => ({
      ruleId: String(f.rule_id),
      severity: f.severity as never,
      reason: String(f.user_message),
      ruleReviewStatus: String(f.review_status),
    })),
  };
}

export function getEpisode(id: string): Episode | null {
  const row = get(`SELECT * FROM episodes WHERE id = ?`, id);
  return row ? hydrate(row) : null;
}

export function getGrounding(id: string): GroundingInfo | null {
  const row = get(
    `SELECT grounding_status, grounding_reason, grounding_by, grounding_score, grounding_clarification
       FROM episodes WHERE id = ?`, id,
  );
  if (!row) return null;
  return {
    status: String(row.grounding_status) as GroundingStatus,
    reason: (row.grounding_reason as GroundingInfo['reason']) ?? null,
    by: (row.grounding_by as GroundingInfo['by']) ?? null,
    score: row.grounding_score != null ? Number(row.grounding_score) : null,
    clarification: (row.grounding_clarification as string | null) ?? null,
  };
}

export function listEpisodes(opts: { personId?: string; region?: string; side?: string; limit?: number } = {}): Episode[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.personId) { where.push('person_id = ?'); params.push(opts.personId); }
  if (opts.region) { where.push('region = ?'); params.push(opts.region); }
  if (opts.side) { where.push('side = ?'); params.push(opts.side); }
  const sql = `SELECT * FROM episodes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY started_at DESC LIMIT ?`;
  return all(sql, ...params, opts.limit ?? 100).map(hydrate);
}

/** Prior episodes in the same place — the "you've had this before" payoff. */
export function priorEpisodes(episodeId: string): Episode[] {
  const current = get<{ region_id: string; started_at: string }>(
    `SELECT region_id, started_at FROM episodes WHERE id = ?`, episodeId,
  );
  if (!current) return [];
  return all(
    `SELECT * FROM episodes WHERE region_id = ? AND id != ? AND started_at < ? ORDER BY started_at DESC`,
    current.region_id, episodeId, current.started_at,
  ).map(hydrate);
}

export function closeEpisode(id: string, endedAt = now()): void {
  run(`UPDATE episodes SET status = 'resolved', ended_at = ?, updated_at = ? WHERE id = ?`, endedAt, endedAt, id);
}

export function appendTranscript(episodeId: string, role: string, content: string, turnIndex?: number): void {
  const idx = turnIndex ?? (get<{ n: number }>(`SELECT COALESCE(MAX(turn_index), -1) + 1 AS n FROM transcripts WHERE episode_id = ?`, episodeId)?.n ?? 0);
  run(
    `INSERT INTO transcripts (id, episode_id, turn_index, role, content, created_at) VALUES (?,?,?,?,?,?)`,
    randomUUID(), episodeId, idx, role, content, now(),
  );
}

/** Evaluation without a write, for GET endpoints. */
export function safetyFor(episodeId: string, profile: ReleaseProfile): SafetyEvaluation | null {
  const ep = getEpisode(episodeId);
  if (!ep) return null;
  const answers = answersFor(episodeId);
  return evaluateSafety(ep.record, {
    region: ep.record.location.region,
    answers,
    signals: signalsFromAnswers(answers, ep.record.location.region),
    profile,
  });
}

export function summaryFor(
  id: string,
  profile: ReleaseProfile = 'development',
): { summary: PreVisitSummary; text: string; blocked: boolean; withheld: unknown[] } | null {
  const ep = getEpisode(id);
  if (!ep) return null;
  const answers = answersFor(id);
  const safety = evaluateSafety(ep.record, {
    region: ep.record.location.region,
    answers,
    signals: signalsFromAnswers(answers, ep.record.location.region),
    profile,
  });
  // buildPreVisitSummary is deterministic, so the summary can never inherit a
  // safety message the release profile withheld.
  const summary = buildPreVisitSummary(ep, {
    flags: safety.flags,
    priorEpisodes: priorEpisodes(id),
    answers,
    coverage: coverageFor(id),
    withheld: safety.withheld,
    blocked: safety.blocked,
  });
  return { summary, text: renderPlainText(summary), blocked: safety.blocked, withheld: safety.withheld };
}

/* ------------------------------------------------------------------ */
/* Health map                                                          */
/* ------------------------------------------------------------------ */

export interface HealthMapNode {
  region: string;
  side: string;
  subRegionId: string | null;
  point: { x: number; y: number } | null;
  episodeCount: number;
  lastEpisodeAt: string | null;
  lastTitle: string | null;
}

/** Everything that has ever happened in one place, keyed by place. */
export function healthMap(personId: string): HealthMapNode[] {
  return all(
    `SELECT r.region, r.side, r.sub_region_id, r.point_x, r.point_y,
            COUNT(e.id)      AS episode_count,
            MAX(e.started_at) AS last_at,
            (SELECT title FROM episodes WHERE region_id = r.id ORDER BY started_at DESC LIMIT 1) AS last_title
       FROM body_regions r
       LEFT JOIN episodes e ON e.region_id = r.id
      WHERE r.person_id = ?
      GROUP BY r.id
      ORDER BY last_at DESC`,
    personId,
  ).map((r) => ({
    region: String(r.region),
    side: String(r.side),
    subRegionId: (r.sub_region_id as string | null) ?? null,
    point: r.point_x != null ? { x: Number(r.point_x), y: Number(r.point_y) } : null,
    episodeCount: Number(r.episode_count),
    lastEpisodeAt: (r.last_at as string | null) ?? null,
    lastTitle: (r.last_title as string | null) ?? null,
  }));
}
