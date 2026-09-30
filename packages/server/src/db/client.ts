/**
 * Symptom Record Store.
 *
 * Why node:sqlite and not an ORM + native driver:
 *   - Zero native compilation. Nothing to break when node or the OS moves.
 *   - The DB file is a plain, portable SQLite file the user can copy, back up
 *     or open in any tool. That matters more for health data than ergonomics.
 *   - Provenance is stored per-field as rows, which is the whole point of the
 *     data model, and is clearer in explicit SQL than through a mapper.
 *
 * SCHEMA NOTE: `episode_fields` holds the VALUE and its PROVENANCE in the same
 * row. That is deliberate. Previously they lived in two tables written by two
 * independent code paths, so a value could be persisted with no provenance, or
 * provenance could be asserted for a value nobody wrote. One row, one
 * transaction, one write.
 *
 * `episodes.record_json` is a MATERIALISED PROJECTION rebuilt from
 * `episode_fields` after every mutation. It is never written directly, so it
 * cannot drift from the field store.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from '../env.ts';

const dbPath = resolve(process.cwd(), env.ASI_DB_PATH);
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
// Health data at rest: OS-level disk encryption is the baseline, but we also
// keep the file inside the user's home-local data dir and never sync it.
db.exec('PRAGMA secure_delete = ON');

/**
 * SCHEMA VERSIONING.
 *
 * This is a local-first single-file database with no migration framework, so
 * the policy is blunt and stated plainly: when the schema version changes, the
 * file is REBUILT from scratch.
 *
 * The alternative — additive `ALTER TABLE` migrations — was rejected because it
 * implies the old data is preserved across schema changes, and it is not: the
 * field store, the answer map and the record projection changed shape together
 * in this revision, and a half-migrated file would produce records whose value
 * and provenance disagree. Losing a local development database is an acceptable
 * cost for never serving an incoherent one.
 *
 * A real deployment with real user data must replace this with real migrations
 * before it holds anything anyone would miss.
 */
const SCHEMA_VERSION = 2;
const CURRENT = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version ?? 0;

/**
 * Cheap structural probe. A version number can survive a half-written schema,
 * so we also check that a column this revision added actually exists. Checking
 * the schema rather than trusting the version is what makes this reliable.
 */
const REQUIRED_EPISODE_COLUMNS = ['grounding_status', 'grounding_reason', 'grounding_clarification'];
function schemaLooksIncomplete(): boolean {
  const cols = (db.prepare('PRAGMA table_info(episodes)').all() as { name: string }[]).map((r) => r.name);
  if (!cols.length) return true; // table absent; the CREATE block will make it
  return REQUIRED_EPISODE_COLUMNS.some((c) => !cols.includes(c));
}

const needsRebuild = CURRENT !== SCHEMA_VERSION || schemaLooksIncomplete();

if (needsRebuild) {
  if (CURRENT > 0) {
    console.warn(
      `[asi] schema version ${CURRENT} → ${SCHEMA_VERSION}: rebuilding the local database. ` +
        `Development data is not migrated across a schema change.`,
    );
  } else {
    console.warn(
      `[asi] found a database with no schema version. Assuming it predates versioning ` +
        `and rebuilding it so it cannot present a half-understood schema.`,
    );
  }
  db.exec('PRAGMA foreign_keys = OFF');
  for (const t of [
    'episode_answers', 'episode_assertions', 'episode_fields', 'safety_flags',
    'transcripts', 'clinical_assertions', 'episodes', 'body_regions', 'persons',
  ]) {
    db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  db.exec('PRAGMA foreign_keys = ON');
}
db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

db.exec(`
CREATE TABLE IF NOT EXISTS persons (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- A body region is the spatial index of the personal anatomical health map.
CREATE TABLE IF NOT EXISTS body_regions (
  id                TEXT PRIMARY KEY,
  person_id         TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  region            TEXT NOT NULL,
  side              TEXT NOT NULL,
  sub_region_id     TEXT,
  -- Pin location on the body map, normalised 0..1. Drives the heatmap.
  point_x           REAL,
  point_y           REAL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_regions_person ON body_regions(person_id, region, side);

-- One episode = one occurrence of a symptom in one place. Not one chat session.
CREATE TABLE IF NOT EXISTS episodes (
  id             TEXT PRIMARY KEY,
  person_id      TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  region_id      TEXT NOT NULL REFERENCES body_regions(id) ON DELETE CASCADE,
  region         TEXT NOT NULL,
  side           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open',
  title          TEXT NOT NULL,
  -- Grounding outcome. 'unsupported' episodes are retained so the refusal is
  -- auditable, but the interview must refuse to run for them.
  grounding_status TEXT NOT NULL DEFAULT 'grounded',
  grounding_reason TEXT,
  grounding_by    TEXT,
  grounding_score REAL,
  grounding_clarification TEXT,
  record_json    TEXT NOT NULL,   -- materialised projection, rebuilt on write
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episodes_region ON episodes(region_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_person ON episodes(person_id, started_at DESC);

-- THE FIELD STORE. One row per field, holding the value AND its provenance.
-- This is the single source of truth; episodes.record_json is derived from it.
CREATE TABLE IF NOT EXISTS episode_fields (
  episode_id          TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  field_path          TEXT NOT NULL,
  value_json          TEXT NOT NULL,
  source_type         TEXT NOT NULL,
  source_reference    TEXT,
  captured_at         TEXT NOT NULL,
  confidence          REAL,
  verification_status TEXT NOT NULL,
  created_by          TEXT NOT NULL,
  raw_text            TEXT,
  evidence_status     TEXT NOT NULL,
  claim_class         TEXT NOT NULL,
  PRIMARY KEY (episode_id, field_path)
);
CREATE INDEX IF NOT EXISTS idx_fields_source ON episode_fields(source_type);
CREATE INDEX IF NOT EXISTS idx_fields_episode ON episode_fields(episode_id);

-- Values that lost a merge. Kept so a conflict between, say, a lab report and
-- what the patient feels stays visible instead of one silently winning.
CREATE TABLE IF NOT EXISTS episode_assertions (
  id           TEXT PRIMARY KEY,
  episode_id   TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  field_path   TEXT NOT NULL,
  value_json   TEXT NOT NULL,
  source_type  TEXT NOT NULL,
  evidence_status TEXT NOT NULL,
  reason       TEXT NOT NULL,
  captured_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assertions_field ON episode_assertions(episode_id, field_path);

-- Interview answers, with their four-state value. Safety rules read the signals
-- derived from THIS, never from the record.
CREATE TABLE IF NOT EXISTS episode_answers (
  episode_id        TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  question_id       TEXT NOT NULL,
  raw_json          TEXT NOT NULL,
  tri_state         TEXT NOT NULL,
  wrote_fields_json TEXT NOT NULL,
  source_type       TEXT NOT NULL,
  captured_at       TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  created_by        TEXT NOT NULL,
  raw_text          TEXT,
  PRIMARY KEY (episode_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_answers_episode ON episode_answers(episode_id);

-- Safety flags are append-only: we must be able to show what we warned about
-- and when, even if the rules change afterwards.
CREATE TABLE IF NOT EXISTS safety_flags (
  id               TEXT PRIMARY KEY,
  episode_id       TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  rule_id          TEXT NOT NULL,
  severity         TEXT NOT NULL,
  user_message     TEXT NOT NULL,
  review_status    TEXT NOT NULL,
  profile          TEXT NOT NULL,
  raised_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flags_episode ON safety_flags(episode_id);

-- Later phases: clinician assertions and external records, stored separately so
-- they can never be confused with AI inference or user self-report.
CREATE TABLE IF NOT EXISTS clinical_assertions (
  id                  TEXT PRIMARY KEY,
  episode_id          TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,          -- diagnosis | test | treatment | outcome | imaging | lab
  label               TEXT NOT NULL,
  body_system         TEXT,
  region              TEXT,
  asserted_by         TEXT,
  institution         TEXT,
  occurred_at         TEXT,
  source_document     TEXT,
  notes               TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clinical_episode ON clinical_assertions(episode_id);

CREATE TABLE IF NOT EXISTS transcripts (
  id           TEXT PRIMARY KEY,
  episode_id   TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  turn_index   INTEGER NOT NULL,
  role         TEXT NOT NULL,               -- user | assistant | system
  content      TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transcript_episode ON transcripts(episode_id, turn_index);
`);

export type Row = Record<string, unknown>;

/** Run a SELECT and return all rows. */
export function all(sql: string, ...params: unknown[]): Row[] {
  return db.prepare(sql).all(...(params as never[])) as Row[];
}

/** Run a SELECT and return the first row, or null. */
export function get<T = Row>(sql: string, ...params: unknown[]): T | null {
  return (db.prepare(sql).get(...(params as never[])) as T | undefined) ?? null;
}

export function run(sql: string, ...params: unknown[]): void {
  db.prepare(sql).run(...(params as never[]));
}

/**
 * Wrap a set of writes in a transaction.
 *
 * Re-entrant by depth. `createEpisode` calls `applyMutations`, which is itself
 * transactional, and SQLite refuses a transaction inside a transaction. Nesting
 * therefore joins the outer scope: the inner BEGIN is skipped, and only the
 * outermost COMMIT issues. Atomicity is unchanged — a failure anywhere inside
 * still rolls back everything, which is what the mutation path relies on.
 */
let txDepth = 0;
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) {
    txDepth++;
    try {
      return fn();
    } finally {
      txDepth--;
    }
  }
  db.exec('BEGIN');
  txDepth = 1;
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    txDepth = 0;
  }
}

export { dbPath };
