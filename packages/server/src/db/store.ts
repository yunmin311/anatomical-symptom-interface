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
        sourceType: 'user_statement',
        capturedAt: String(r.captured_at),
        verificationStatus: 'unverified',
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
  answers: { questionId: string; triState: string }[];
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
    for (const m of input.answerMutations ?? []) {
      const answer = buildAnswer({
        questionId: m.questionId,
        raw: m.raw,
        wroteFields: m.wroteFields,
        provenance: {
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
           captured_at = excluded.captured_at,
           raw_text = excluded.raw_text`,
        episodeId,
        m.questionId,
        JSON.stringify(answer.raw),
        answer.triState,
        JSON.stringify(answer.wroteFields),
        'user_statement',
        answer.provenance.capturedAt,
        'unverified',
        answer.provenance.createdBy,
        answer.provenance.rawText ?? null,
      );
      answerResults.push({ questionId: m.questionId, triState: answer.triState });
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
 * Keep `body_regions` in step with the record it indexes.
 *
 * `body_regions` is a DERIVED spatial index: it exists so the personal
 * anatomical health map can group episodes by place and read a pin coordinate
 * without scanning every record. It is not a second source of truth, so it is
 * rebuilt from the record rather than written by the client.
 *
 * This was missing, and the effect was that `point_x`, `point_y` and
 * `sub_region_id` were permanently NULL. `createEpisode` called `ensureRegion`
 * with nulls BEFORE the mutations were applied, and nothing called it again, so a
 * pin the user placed on the body map never reached the table that exists to hold
 * it. The health map had a count per place and no geography. The Phase-0
 * "heatmap" was a column and a comment.
 *
 * Called from `applyMutations` rather than from the HTTP layer, so it is inside
 * the one transaction that writes the record. A pin cannot be stored without the
 * index following it, and the index cannot drift from the record.
 */
function syncSpatialIndex(episodeId: string, record: SymptomRecord): void {
  const ep = get<{ region_id: string; side: string }>(
    `SELECT region_id, side FROM episodes WHERE id = ?`, episodeId,
  );
  if (!ep) return;
  const store = fieldStoreFor(episodeId);
  const loc = record.location;

  // `location.side` carries a schema DEFAULT of 'unknown'. A record where the
  // user never chose a side has not said "unknown" -- they have not said
  // anything -- and copying that default over the region row would drag every
  // place to 'unknown' and collapse left and right into one. Localisation's side
  // stands unless the field store holds an actual side.
  const side = store['location.side'] ? loc.side : ep.side;

  run(
    `UPDATE body_regions
        SET side = ?, sub_region_id = ?, point_x = ?, point_y = ?, updated_at = ?
      WHERE id = ?`,
    side,
    loc.subRegionId ?? null,
    loc.point?.x ?? null,
    loc.point?.y ?? null,
    now(),
    ep.region_id,
  );
}

/* ------------------------------------------------------------------ */
/* Safety flags                                                        */
/* ------------------------------------------------------------------ */

function recordSafetyFlags(episodeId: string, safety: SafetyEvaluation, profile: ReleaseProfile): void {
  for (const f of safety.flags) {
    const exists = get(`SELECT id FROM safety_flags WHERE episode_id = ? AND rule_id = ?`, episodeId, f.ruleId);
    if (exists) continue;
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
