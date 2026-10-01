/**
 * Migration framework tests.
 *
 * The policy these replace dropped every table whenever the schema version
 * changed. That was only defensible while the data was disposable, and it made
 * one thing permanently impossible: adding a column to a database that already
 * had records in it. v2 could not ship a refusal state for unsupported episodes
 * without that state erasing the episodes it describes.
 *
 * So the properties worth proving are specific, and each has a test here:
 *
 *   - a fresh file reaches the latest version
 *   - a file already at the latest version is left alone
 *   - a file one version behind is brought forward ADDITIVELY
 *   - rows, field provenance and interview answers all survive
 *   - a failing migration rolls back completely, leaving no half-migrated file
 *   - a file we do not recognise is refused, never deleted
 *
 * Legacy files are built by hand with raw SQL rather than by running the old
 * code, because "what the old build actually wrote" is the thing under test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LATEST_VERSION,
  MIGRATIONS,
  MigrationError,
  applyPending,
  assertSchemaReady,
  migrate,
} from '../src/db/migrations/index.ts';
import { BASELINE_SQL } from '../src/db/migrations/001-baseline.ts';
import { EPISODE_GROUNDING_SQL } from '../src/db/migrations/002-episode-grounding.ts';

const dir = mkdtempSync(join(tmpdir(), 'asi-migrate-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
function freshDb(): DatabaseSync {
  return new DatabaseSync(join(dir, `m${n++}.sqlite`));
}

const tables = (db: DatabaseSync) =>
  new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[])
    .map((r) => r.name));

const cols = (db: DatabaseSync, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);

const userVersion = (db: DatabaseSync) =>
  Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);

const count = (db: DatabaseSync, table: string) =>
  Number((db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c);

/* ================================================================== */
/* Fresh database                                                     */
/* ================================================================== */

test('a fresh database reaches the latest version', () => {
  const db = freshDb();
  const report = migrate(db);
  assert.equal(report.from, 0);
  assert.equal(report.to, LATEST_VERSION);
  assert.deepEqual(report.applied.map((a) => a.version), [1, 2]);
  assert.equal(userVersion(db), LATEST_VERSION);
  assertSchemaReady(db);
  db.close();
});

test('a fresh database has every table the product needs', () => {
  const db = freshDb();
  migrate(db);
  for (const t of [
    'persons', 'body_regions', 'episodes', 'episode_fields', 'episode_assertions',
    'episode_answers', 'safety_flags', 'clinical_assertions', 'transcripts',
  ]) {
    assert.ok(tables(db).has(t), `missing table ${t}`);
  }
  db.close();
});

test('migrating an already-current database applies nothing', () => {
  const db = freshDb();
  migrate(db);
  const second = migrate(db);
  assert.equal(second.applied.length, 0);
  assert.equal(second.from, LATEST_VERSION);
  assert.equal(second.to, LATEST_VERSION);
  db.close();
});

test('the migration list is contiguous from 1 with no gaps or duplicates', () => {
  MIGRATIONS.forEach((m, i) => {
    assert.equal(m.version, i + 1, `migration ${m.name} is out of order`);
  });
  assert.equal(LATEST_VERSION, MIGRATIONS.length);
});

/* ================================================================== */
/* Existing databases must be brought forward, never rebuilt          */
/* ================================================================== */

/** A v1 file: baseline tables, and none of the v2 grounding columns. */
function legacyV1(db: DatabaseSync): void {
  db.exec(BASELINE_SQL);
  db.exec('PRAGMA user_version = 1');
}

function seedEpisode(db: DatabaseSync, marker: string): void {
  db.prepare('INSERT INTO persons (id, display_name, created_at) VALUES (?,?,?)')
    .run('p1', 'Tester', '2026-01-01T00:00:00.000Z');
  db.prepare(`INSERT INTO body_regions (id, person_id, region, side, sub_region_id, point_x, point_y, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run('r1', 'p1', 'knee', 'left', 'knee.anterior', 0.5, 0.5, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  db.prepare(`INSERT INTO episodes (id, person_id, region_id, region, side, status, title, grounding_score, record_json, started_at, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('e1', 'p1', 'r1', 'knee', 'left', 'open', marker, 0.8, '{}', '2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
}

test('a v1 database is migrated forward additively, keeping its rows', () => {
  const db = freshDb();
  legacyV1(db);
  seedEpisode(db, 'kept knee pain');

  const report = migrate(db);
  assert.equal(report.from, 1);
  assert.equal(report.to, LATEST_VERSION);
  assert.deepEqual(report.applied.map((a) => a.name), ['episode-grounding-columns']);
  assert.equal(userVersion(db), LATEST_VERSION);

  // The episode is still here, and the added column backfilled rather than
  // becoming NULL, which would make the interview's refusal check ambiguous.
  const ep = db.prepare('SELECT title, grounding_status, grounding_reason FROM episodes WHERE id = ?').get('e1') as
    { title: string; grounding_status: string; grounding_reason: string | null };
  assert.equal(ep.title, 'kept knee pain');
  assert.equal(ep.grounding_status, 'grounded');
  assert.equal(ep.grounding_reason, null);
  db.close();
});

test('a legacy v2 file with no migration table is adopted, not rebuilt', () => {
  // This is the shape the previous build wrote: version 2, full schema, and no
  // schema_migrations because the table did not exist yet.
  const db = freshDb();
  db.exec(BASELINE_SQL);
  db.exec(EPISODE_GROUNDING_SQL);
  db.exec('PRAGMA user_version = 2');
  seedEpisode(db, 'adopted');
  db.prepare('UPDATE episodes SET grounding_status = ?, grounding_by = ? WHERE id = ?')
    .run('unsupported', 'deterministic', 'e1');

  const report = migrate(db);
  assert.equal(report.adopted, true, 'should have been adopted from its real shape');
  assert.equal(report.applied.length, 0, 'a current legacy file needs no migrations');
  assert.equal(count(db, 'episodes'), 1);

  // The refusal audit trail is exactly what the old policy would have destroyed.
  const ep = db.prepare('SELECT grounding_status, grounding_by FROM episodes WHERE id = ?').get('e1') as
    { grounding_status: string; grounding_by: string };
  assert.equal(ep.grounding_status, 'unsupported');
  assert.equal(ep.grounding_by, 'deterministic');
  db.close();
});

test('an unversioned file that is already current is adopted by shape, not by number', () => {
  // user_version is 0 but the schema is complete. Believing the number would run
  // 001 and 002 again; believing the shape adopts it.
  const db = freshDb();
  db.exec(BASELINE_SQL);
  db.exec(EPISODE_GROUNDING_SQL);
  db.exec('PRAGMA user_version = 0');
  seedEpisode(db, 'no version stamp');

  const report = migrate(db);
  assert.equal(report.adopted, true);
  assert.equal(report.applied.length, 0);
  assert.equal(count(db, 'episodes'), 1);
  db.close();
});

test('an unversioned v1 file still gets the v2 columns', () => {
  const db = freshDb();
  legacyV1(db);
  db.exec('PRAGMA user_version = 0');
  seedEpisode(db, 'v1 no stamp');

  const report = migrate(db);
  assert.equal(report.applied.length, 1);
  assert.ok(cols(db, 'episodes').includes('grounding_by'));
  assert.equal(count(db, 'episodes'), 1);
  db.close();
});

/* ================================================================== */
/* Data, provenance and answers survive                               */
/* ================================================================== */

test('field provenance survives a migration intact', () => {
  const db = freshDb();
  legacyV1(db);
  seedEpisode(db, 'provenance holder');
  // The value AND its provenance in one row. If a migration ever split these, a
  // value could exist with no provenance or provenance for a value nobody wrote.
  db.prepare(`INSERT INTO episode_fields
      (episode_id, field_path, value_json, source_type, captured_at, verification_status, created_by, evidence_status, claim_class)
      VALUES (?,?,?,?,?,?,?,?,?)`)
    .run('e1', 'location.side', '"left"', 'user_statement', '2026-01-02T00:00:00.000Z', 'user_confirmed', 'user', 'direct', 'user_grounded');
  db.prepare(`INSERT INTO episode_fields
      (episode_id, field_path, value_json, source_type, captured_at, verification_status, created_by, evidence_status, claim_class, confidence)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run('e1', 'consideredStructures', '[]', 'ai_inference', '2026-01-02T00:00:00.000Z', 'unverified', 'model', 'inferred', 'ai_inference', 0.5);

  migrate(db);

  const rows = db.prepare('SELECT field_path, value_json, source_type, verification_status, created_by, claim_class, confidence FROM episode_fields ORDER BY field_path').all() as Record<string, unknown>[];
  assert.equal(rows.length, 2);
  const side = rows.find((r) => r.field_path === 'location.side')!;
  assert.equal(side.value_json, '"left"');
  assert.equal(side.source_type, 'user_statement');
  assert.equal(side.verification_status, 'user_confirmed');
  assert.equal(side.created_by, 'user');
  assert.equal(side.claim_class, 'user_grounded');
  const cand = rows.find((r) => r.field_path === 'consideredStructures')!;
  assert.equal(cand.source_type, 'ai_inference');
  assert.equal(cand.verification_status, 'unverified');
  assert.equal(cand.confidence, 0.5);
  db.close();
});

test('interview answers keep their four-state value across a migration', () => {
  const db = freshDb();
  legacyV1(db);
  seedEpisode(db, 'answers holder');
  for (const [qid, tri] of [['knee.cauda_equina', 'yes'], ['knee.swelling', 'no'], ['knee.locking', 'unknown'], ['knee.stiffness', 'not_asked']] as const) {
    db.prepare(`INSERT INTO episode_answers
        (episode_id, question_id, raw_json, tri_state, wrote_fields_json, source_type, captured_at, verification_status, created_by)
        VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('e1', qid, 'null', tri, '[]', 'user_statement', '2026-01-02T00:00:00.000Z', 'user_confirmed', 'user');
  }

  migrate(db);

  const rows = db.prepare('SELECT question_id, tri_state FROM episode_answers ORDER BY question_id').all() as
    { question_id: string; tri_state: string }[];
  assert.equal(rows.length, 4);
  // The distinction that safety rules depend on must not be flattened.
  assert.deepEqual(
    rows.map((r) => r.tri_state),
    ['yes', 'no', 'unknown', 'not_asked'].sort().sort((a, b) => rows.findIndex((x) => x.tri_state === a) - rows.findIndex((x) => x.tri_state === b)),
  );
  assert.equal(new Set(rows.map((r) => r.tri_state)).size, 4, 'a four-state value was collapsed');
  db.close();
});

test('safety flags survive a migration', () => {
  const db = freshDb();
  legacyV1(db);
  seedEpisode(db, 'flags holder');
  db.prepare(`INSERT INTO safety_flags (id, episode_id, rule_id, severity, user_message, review_status, profile, raised_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run('f1', 'e1', 'msk.cauda_equina', 'emergency', 'Get this assessed now.', 'unreviewed', 'development', '2026-01-02T00:00:00.000Z');

  migrate(db);
  const f = db.prepare('SELECT rule_id, severity, user_message, review_status FROM safety_flags WHERE id = ?').get('f1') as Record<string, unknown>;
  assert.equal(f.rule_id, 'msk.cauda_equina');
  assert.equal(f.severity, 'emergency');
  assert.equal(f.user_message, 'Get this assessed now.');
  // The unreviewed marker must not quietly become reviewed across a migration.
  assert.equal(f.review_status, 'unreviewed');
  db.close();
});

test('preserved losing assertions survive a migration', () => {
  const db = freshDb();
  legacyV1(db);
  seedEpisode(db, 'assertions holder');
  db.prepare(`INSERT INTO episode_assertions (id, episode_id, field_path, value_json, source_type, evidence_status, reason, captured_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run('a1', 'e1', 'location.side', '"left"', 'device_import', 'inferred', 'out of claim class', '2026-01-02T00:00:00.000Z');

  migrate(db);
  assert.equal(count(db, 'episode_assertions'), 1);
  db.close();
});

/* ================================================================== */
/* Failure must not leave a half-migrated file                        */
/* ================================================================== */

test('a failing migration rolls back completely', () => {
  const db = freshDb();
  legacyV1(db);
  seedEpisode(db, 'rollback holder');

  const broken = [
    {
      version: 2,
      name: 'deliberately-broken',
      // The first statement is valid DDL, so if the transaction were not real
      // this column would survive and the file would claim a schema it lacks.
      sql: 'ALTER TABLE episodes ADD COLUMN half_applied TEXT; THIS IS NOT SQL;',
      alreadyApplied: () => true,
    },
  ];

  assert.throws(() => applyPending(db, broken, 1), MigrationError);

  // No half-applied column.
  assert.equal(cols(db, 'episodes').includes('half_applied'), false, 'a failed migration left DDL behind');
  // Version unchanged, so a retry starts from a known state.
  assert.equal(userVersion(db), 1);
  // Data untouched.
  assert.equal(count(db, 'episodes'), 1);
  db.close();
});

test('a failed migration is not recorded as applied', () => {
  const db = freshDb();
  legacyV1(db);
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`);

  assert.throws(() => applyPending(db, [{
    version: 2, name: 'broken', sql: 'NOT SQL AT ALL;', alreadyApplied: () => true,
  }], 1), MigrationError);

  assert.equal(count(db, 'schema_migrations'), 0, 'a rolled-back migration was recorded');
  db.close();
});

test('a failed migration leaves the connection usable', () => {
  const db = freshDb();
  legacyV1(db);
  assert.throws(() => applyPending(db, [{
    version: 2, name: 'broken', sql: 'NOT SQL;', alreadyApplied: () => true,
  }], 1), MigrationError);
  // Foreign keys must be back on, or cascading deletes would silently stop.
  const fk = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
  assert.equal(Number(fk.foreign_keys), 1);
  db.close();
});

/* ================================================================== */
/* Adoption must be stable across repeated starts                      */
/* ================================================================== */

/**
 * Adoption was writing a single row with the sentinel checksum 'adopted'. That
 * works exactly once: on the next start the checksum guard compares 'adopted'
 * against the real hash of that migration and refuses to open the file. A legacy
 * database became unopenable by being opened.
 *
 * These cases pin the whole lifecycle, not just the first call.
 */
test('A: a legacy current file adopts, then opens again twice', () => {
  const db = freshDb();
  db.exec(BASELINE_SQL);
  db.exec(EPISODE_GROUNDING_SQL);
  db.exec('PRAGMA user_version = 2');
  seedEpisode(db, 'legacy v2');

  for (const attempt of [1, 2, 3]) {
    const report = migrate(db);
    assert.equal(report.applied.length, 0, `start ${attempt} applied something it should not have`);
    assert.equal(userVersion(db), LATEST_VERSION);
    assert.equal(count(db, 'episodes'), 1, `start ${attempt} lost the episode`);
  }
});

test('B: a legacy current file with no version stamp adopts and reopens', () => {
  const db = freshDb();
  db.exec(BASELINE_SQL);
  db.exec(EPISODE_GROUNDING_SQL);
  db.exec('PRAGMA user_version = 0');
  seedEpisode(db, 'legacy no stamp');

  migrate(db);
  assert.equal(userVersion(db), LATEST_VERSION, 'adoption should stamp the real version');
  const second = migrate(db);
  assert.equal(second.applied.length, 0);
  assert.equal(count(db, 'episodes'), 1);
});

test('C: a stale version number must not skip a migration the shape still needs', () => {
  // The file is genuinely v1 -- no grounding columns -- but claims to be 2.
  // Trusting the number would skip migration 002 and leave a file that cannot
  // serve: createEpisode writes grounding_by, which would not exist.
  const db = freshDb();
  legacyV1(db);
  db.exec('PRAGMA user_version = 2');
  seedEpisode(db, 'lying version');

  const report = migrate(db);
  assert.equal(report.applied.length, 1, 'migration 002 was skipped because of a stale version number');
  assert.ok(cols(db, 'episodes').includes('grounding_by'), 'the needed column is still missing');
  assertSchemaReady(db);
  assert.equal(count(db, 'episodes'), 1);
  // And it must be stable from then on.
  assert.equal(migrate(db).applied.length, 0);
});

test('D: a legacy v1 file with no version stamp migrates and reopens', () => {
  const db = freshDb();
  legacyV1(db);
  db.exec('PRAGMA user_version = 0');
  seedEpisode(db, 'v1 no stamp');

  const report = migrate(db);
  assert.equal(report.applied.length, 1);
  assertSchemaReady(db);
  assert.equal(migrate(db).applied.length, 0);
  assert.equal(count(db, 'episodes'), 1);
});

test('E: an unknown shape is refused every time, never destructively', () => {
  const db = freshDb();
  db.exec('CREATE TABLE unrelated (id TEXT PRIMARY KEY)');
  db.prepare('INSERT INTO unrelated (id) VALUES (?)').run('precious');

  for (const attempt of [1, 2]) {
    assert.throws(() => migrate(db), MigrationError, `start ${attempt} did not refuse`);
  }
  assert.equal(count(db, 'unrelated'), 1, 'a refused file was modified');
  // Refusing must not have left a migration table behind either.
  assert.equal(tables(db).has('schema_migrations'), false, 'a refused file was written to');
});

test('F: a tampered checksum on a genuinely applied migration is still refused', () => {
  // Adoption must not weaken this. Real protection for a migration that really
  // ran has to beat the shape probe, because the shape looks fine either way.
  const db = freshDb();
  migrate(db);
  db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('deadbeef');
  assert.throws(() => migrate(db), MigrationError);
  // Still refused on a second attempt, so it is not a one-shot.
  assert.throws(() => migrate(db), MigrationError);
});

test('an adopted file records REAL checksums, not a sentinel', () => {
  // The representation matters: 'adopted' is a value that can never match a real
  // checksum, so it is a landmine on the next start. An adopted migration is
  // recorded as itself.
  const db = freshDb();
  db.exec(BASELINE_SQL);
  db.exec(EPISODE_GROUNDING_SQL);
  db.exec('PRAGMA user_version = 2');
  migrate(db);

  const rows = db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all() as
    { version: number; name: string; checksum: string }[];
  assert.equal(rows.length, 2, 'both satisfied migrations should be recorded');
  assert.deepEqual(rows.map((r) => r.version), [1, 2]);
  assert.deepEqual(rows.map((r) => r.name), ['baseline-schema', 'episode-grounding-columns']);
  for (const r of rows) {
    assert.notEqual(r.checksum, 'adopted', 'a sentinel checksum would break the next start');
    assert.match(r.checksum, /^[0-9a-f]{64}$/, 'not a real checksum');
  }
});

test('the shape is authoritative: a migration the shape needs runs even if recorded', () => {
  // A file that genuinely ran migration 002, and then lost the columns: the
  // recorded row and the checksum are both self-consistent and true, the file was
  // only damaged afterwards. The shape is what says the work is needed.
  const db = freshDb();
  migrate(db);
  const hadRecord = db.prepare('SELECT COUNT(*) AS c FROM schema_migrations WHERE version = 2').get() as { c: number };
  assert.equal(hadRecord.c, 1, 'precondition: migration 2 was recorded');

  // Rebuild `episodes` at the v1 shape. Dropping columns cannot be done in place,
  // so the table is recreated without them.
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('ALTER TABLE episodes RENAME TO episodes_damaged');
  db.exec(BASELINE_SQL);
  db.exec('DROP TABLE episodes_damaged');
  db.exec('PRAGMA foreign_keys = ON');
  assert.equal(cols(db, 'episodes').includes('grounding_by'), false, 'precondition: columns are gone');

  const report = migrate(db);
  assert.equal(report.applied.length, 1, 'the shape said migration 002 was needed and it was skipped');
  assert.ok(cols(db, 'episodes').includes('grounding_by'), 'the column was not restored');
  assertSchemaReady(db);
  // Still self-consistent afterwards.
  assert.equal(migrate(db).applied.length, 0);
});

test('a recorded row with a bogus checksum is tampering, and is refused', () => {
  // The counterpart to the test above: if the recorded history DISAGREES with
  // itself, shape authority must not paper over it.
  const db = freshDb();
  legacyV1(db);
  seedEpisode(db, 'tampered claim');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  db.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?,?,?,?)')
    .run(2, 'episode-grounding-columns', 'not-the-real-checksum', '2026-01-01T00:00:00.000Z');

  assert.throws(() => migrate(db), MigrationError);
});

/* ================================================================== */
/* Refuse rather than destroy                                         */
/* ================================================================== */

test('a file we do not recognise is refused, and left exactly as it was', () => {
  const db = freshDb();
  // Something that is not our schema but is not empty either.
  db.exec('CREATE TABLE unrelated (id TEXT PRIMARY KEY)');
  db.prepare('INSERT INTO unrelated (id) VALUES (?)').run('precious');
  const before = tables(db);

  assert.throws(() => migrate(db), MigrationError);

  // The whole point: refused, not deleted.
  assert.deepEqual([...tables(db)].sort(), [...before].sort());
  assert.equal(count(db, 'unrelated'), 1);
  db.close();
});

test('a database from a newer build is refused, not downgraded', () => {
  const db = freshDb();
  migrate(db);
  db.exec(`PRAGMA user_version = ${LATEST_VERSION + 5}`);
  assert.throws(() => migrate(db), MigrationError);
  db.close();
});

test('editing an already-applied migration is refused', () => {
  const db = freshDb();
  migrate(db);
  // Simulate someone changing the SQL of a migration that real databases ran.
  db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('deadbeef');
  assert.throws(() => migrate(db), MigrationError);
  db.close();
});

test('assertSchemaReady refuses a file that is not actually complete', () => {
  const db = freshDb();
  db.exec(BASELINE_SQL); // v1 only: the grounding columns are missing
  assert.throws(() => assertSchemaReady(db), MigrationError);
  db.close();
});

/* ================================================================== */
/* Foreign keys stay on across a migration                            */
/* ================================================================== */

test('foreign keys are restored after a real migration', () => {
  const db = freshDb();
  migrate(db);
  const fk = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
  assert.equal(Number(fk.foreign_keys), 1);
  // And they actually work: deleting a person cascades.
  db.prepare('INSERT INTO persons (id, display_name, created_at) VALUES (?,?,?)')
    .run('px', 'X', '2026-01-01T00:00:00.000Z');
  db.prepare(`INSERT INTO body_regions (id, person_id, region, side, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run('rx', 'px', 'knee', 'left', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  assert.equal(count(db, 'body_regions'), 1);
  db.prepare('DELETE FROM persons WHERE id = ?').run('px');
  assert.equal(count(db, 'body_regions'), 0, 'cascade delete stopped working');
  db.close();
});
