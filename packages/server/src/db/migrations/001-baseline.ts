/**
 * Migration 001 -- the baseline schema.
 *
 * This is the v1 shape: every table the product needs, minus the three
 * grounding columns that arrived in v2. It is kept as a separate migration from
 * those columns on purpose, because "add a column without dropping the table" is
 * exactly the operation the old rebuild-on-version-change policy made
 * impossible, and having it as a real ordered step is what proves the runner can
 * do it to a populated database.
 *
 * `episode_fields` holds the VALUE and its PROVENANCE in one row. That is the
 * single-write-path invariant: one row, one transaction, one write. A migration
 * must never split them, because a value with no provenance (or provenance for a
 * value nobody wrote) is the exact hole this schema was designed to close.
 *
 * `episodes.record_json` is a MATERIALISED PROJECTION rebuilt from
 * `episode_fields` after every mutation. It is never written directly.
 */
export const BASELINE_SQL = `
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
  -- Pin location on the body map, normalised 0..1. Drives where this person has
  -- been sore, which is a location history and NOT a severity or risk map.
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
  grounding_score REAL,
  record_json    TEXT NOT NULL,   -- materialised projection, rebuilt on write
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episodes_region ON episodes(region_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_person ON episodes(person_id, started_at DESC);

-- THE FIELD STORE. One row per field, holding the value AND its provenance.
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
`;
