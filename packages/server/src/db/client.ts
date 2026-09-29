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
 * Drizzle is the right upgrade if/when we need typed query building across
 * Postgres replicas; it is not the right thing to add before the schema stops
 * moving.
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
  record_json    TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episodes_region ON episodes(region_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_person ON episodes(person_id, started_at DESC);

-- Per-field provenance. 'field_path' is a dotted path into the record, e.g.
-- 'location.side' or 'quality[0]'. Keeping this relational (not a blob) means
-- we can answer "show me everything the model inferred" without parsing JSON.
CREATE TABLE IF NOT EXISTS field_provenance (
  id                  TEXT PRIMARY KEY,
  episode_id          TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  field_path          TEXT NOT NULL,
  source_type         TEXT NOT NULL,
  source_reference    TEXT,
  captured_at         TEXT NOT NULL,
  confidence          REAL,
  verification_status TEXT NOT NULL,
  created_by          TEXT NOT NULL,
  raw_text            TEXT,
  UNIQUE (episode_id, field_path)
);
CREATE INDEX IF NOT EXISTS idx_prov_source ON field_provenance(source_type);
CREATE INDEX IF NOT EXISTS idx_prov_episode ON field_provenance(episode_id);

-- Safety flags are append-only: we must be able to show what we warned about
-- and when, even if the rules change afterwards.
CREATE TABLE IF NOT EXISTS safety_flags (
  id               TEXT PRIMARY KEY,
  episode_id       TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  rule_id          TEXT NOT NULL,
  severity         TEXT NOT NULL,
  user_message     TEXT NOT NULL,
  review_status    TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_assertions_episode ON clinical_assertions(episode_id);

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

/** Wrap a set of writes in a transaction. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export { dbPath };
