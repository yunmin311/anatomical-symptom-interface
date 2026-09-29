/**
 * Episode repository. The only place that writes to the store, so the
 * provenance invariant is enforced in exactly one code path.
 */
import { randomUUID } from 'node:crypto';
import {
  assertProvenance,
  buildPreVisitSummary,
  emptyRecord,
  evaluateRedFlags,
  mergeAttributed,
  renderPlainText,
  SymptomRecordSchema,
  highestSeverity,
} from '@asi/shared';
import type {
  Attributed,
  Episode,
  PreVisitSummary,
  Provenance,
  SymptomRecord,
} from '@asi/shared';
import { all, get, run, tx } from './client.ts';

const now = () => new Date().toISOString();

/* ------------------------------------------------------------------ */
/* Provenance writes                                                   */
/* ------------------------------------------------------------------ */

export function putProvenance(episodeId: string, fieldPath: string, p: Provenance): void {
  // The invariant check lives here, once, for every write.
  assertProvenance(fieldPath, p);
  run(
    `INSERT INTO field_provenance
       (id, episode_id, field_path, source_type, source_reference, captured_at, confidence, verification_status, created_by, raw_text)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(episode_id, field_path) DO UPDATE SET
       source_type = excluded.source_type,
       source_reference = excluded.source_reference,
       captured_at = excluded.captured_at,
       confidence = excluded.confidence,
       verification_status = excluded.verification_status,
       created_by = excluded.created_by,
       raw_text = excluded.raw_text`,
    randomUUID(), episodeId, fieldPath, p.sourceType, p.sourceReference ?? null,
    p.capturedAt, p.confidence ?? null, p.verificationStatus, p.createdBy, p.rawText ?? null,
  );
}

/**
 * Re-read existing provenance and refuse to let a weaker source overwrite a
 * stronger one. This is the database-level version of mergeAttributed().
 */
function currentProvenance(episodeId: string, fieldPath: string): Provenance | null {
  const row = get<{
    source_type: string; source_reference: string | null; captured_at: string;
    confidence: number | null; verification_status: string; created_by: string; raw_text: string | null;
  }>(
    `SELECT source_type, source_reference, captured_at, confidence, verification_status, created_by, raw_text
       FROM field_provenance WHERE episode_id = ? AND field_path = ?`,
    episodeId, fieldPath,
  );
  if (!row) return null;
  return {
    sourceType: row.source_type as Provenance['sourceType'],
    sourceReference: row.source_reference,
    capturedAt: row.captured_at,
    confidence: row.confidence,
    verificationStatus: row.verification_status as Provenance['verificationStatus'],
    createdBy: row.created_by,
    rawText: row.raw_text,
  };
}

export function recordField(
  episodeId: string,
  fieldPath: string,
  value: unknown,
  p: Provenance,
): { applied: boolean; reason?: string } {
  const existing = currentProvenance(episodeId, fieldPath);
  if (existing && existing.sourceType !== p.sourceType) {
    const winner = mergeAttributed<unknown>(
      { value: undefined, provenance: existing },
      { value, provenance: p },
    );
    const existingWins =
      winner?.provenance.sourceType === existing.sourceType &&
      winner?.provenance.capturedAt === existing.capturedAt;
    if (existingWins) {
      return { applied: false, reason: `field is owned by higher-authority source "${existing.sourceType}"` };
    }
  }
  putProvenance(episodeId, fieldPath, p);
  return { applied: true };
}

export function provenanceFor(episodeId: string): Record<string, Provenance> {
  const rows = all(
    `SELECT field_path, source_type, source_reference, captured_at, confidence, verification_status, created_by, raw_text
       FROM field_provenance WHERE episode_id = ?`,
    episodeId,
  );
  const out: Record<string, Provenance> = {};
  for (const r of rows) {
    out[String(r.field_path)] = {
      sourceType: r.source_type as Provenance['sourceType'],
      sourceReference: r.source_reference as string | null,
      capturedAt: r.captured_at as string,
      confidence: r.confidence as number | null,
      verificationStatus: r.verification_status as Provenance['verificationStatus'],
      createdBy: r.created_by as string,
      rawText: r.raw_text as string | null,
    };
  }
  return out;
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
  record?: SymptomRecord;
  title?: string;
  userPhrase?: string;
}

export function createEpisode(input: CreateEpisodeInput): Episode {
  return tx(() => {
    ensurePerson(input.personId, input.displayName ?? 'Me');
    const record = input.record ?? emptyRecord(input.region as never);
    if (input.userPhrase) record.location.userPhrase = input.userPhrase;
    const side = input.side ?? record.location.side;
    const regionId = ensureRegion(input.personId, input.region, side, record.location.subRegionId, record.location.point);
    const id = randomUUID();
    const title = input.title ?? `${input.region} — ${new Date().toISOString().slice(0, 10)}`;

    run(
      `INSERT INTO episodes (id, person_id, region_id, region, side, status, title, record_json, started_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.personId, regionId, input.region, side, 'open', title, JSON.stringify(record), now(), now(), now(),
    );
    const episode: Episode = {
      id,
      personId: input.personId,
      region: input.region as Episode['region'],
      side: side as Episode['side'],
      status: 'open',
      title,
      record,
      provenance: {},
      startedAt: now(),
      endedAt: null,
      createdAt: now(),
      updatedAt: now(),
      safetyFlags: [],
    };
    return episode;
  });
}

function hydrate(row: Record<string, unknown>): Episode {
  const record = SymptomRecordSchema.parse(JSON.parse(String(row.record_json)));
  const flags = all(
    `SELECT rule_id, severity, user_message, review_status, raised_at
       FROM safety_flags WHERE episode_id = ? ORDER BY raised_at`,
    String(row.id),
  );
  return {
    id: String(row.id),
    personId: String(row.person_id),
    region: String(row.region) as Episode['region'],
    side: String(row.side) as Episode['side'],
    status: String(row.status) as Episode['status'],
    title: String(row.title),
    record,
    provenance: provenanceFor(String(row.id)),
    startedAt: String(row.started_at),
    endedAt: row.ended_at as string | null,
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

export function saveRecord(id: string, record: SymptomRecord): Episode {
  run(`UPDATE episodes SET record_json = ?, updated_at = ? WHERE id = ?`, JSON.stringify(record), now(), id);
  raiseSafetyFlags(id, record);
  const ep = getEpisode(id);
  if (!ep) throw new Error(`episode ${id} not found`);
  return ep;
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

/* ------------------------------------------------------------------ */
/* Safety                                                              */
/* ------------------------------------------------------------------ */

export function raiseSafetyFlags(episodeId: string, record: SymptomRecord): string[] {
  const flags = evaluateRedFlags(record, { region: record.location.region });
  const raised: string[] = [];
  for (const f of flags) {
    const exists = get(
      `SELECT id FROM safety_flags WHERE episode_id = ? AND rule_id = ?`,
      episodeId, f.ruleId,
    );
    if (exists) continue;
    run(
      `INSERT INTO safety_flags (id, episode_id, rule_id, severity, user_message, review_status, raised_at)
       VALUES (?,?,?,?,?,?,?)`,
      randomUUID(), episodeId, f.ruleId, f.severity, f.userMessage, f.reviewStatus, now(),
    );
    raised.push(f.ruleId);
    appendTranscript(episodeId, 'system', `[safety:${f.severity}] ${f.title}\n${f.userMessage}`);
  }
  return raised;
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

export function summaryFor(id: string): { summary: PreVisitSummary; text: string } | null {
  const ep = getEpisode(id);
  if (!ep) return null;
  const flags = evaluateRedFlags(ep.record, { region: ep.record.location.region });
  const summary = buildPreVisitSummary(ep, { flags, priorEpisodes: priorEpisodes(id) });
  return { summary, text: renderPlainText(summary) };
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

export type { Attributed };
