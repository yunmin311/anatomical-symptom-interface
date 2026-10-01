/**
 * Migrations.
 *
 * This replaced a policy that deleted the database. The old rule was: when
 * `PRAGMA user_version` did not equal the hardcoded number, DROP every table and
 * rebuild. That was defensible only while the file held nothing anyone would
 * miss, and it made one thing impossible forever -- adding a column without
 * destroying the records that were already there. v2 could not ship a refusal
 * state for unsupported episodes without that state erasing the episodes it was
 * meant to describe.
 *
 * What replaces it:
 *
 *   - Migrations are an ordered list, applied in version order, each in its own
 *     transaction. A failure rolls that migration back and leaves the database at
 *     the last version that fully applied. There is no half-migrated state,
 *     because the version stamp is written inside the same transaction as the
 *     schema change.
 *   - A fresh database and an existing one both start. Existing databases are
 *     brought forward from wherever they actually are.
 *   - Nothing is ever dropped to make a version match. If a file is not a
 *     database we recognise, startup fails with an explanation instead of
 *     quietly deleting somebody's history.
 *
 * The version stamp is kept in two places on purpose: `PRAGMA user_version` for
 * anything that inspects the file with a plain SQLite tool, and a
 * `schema_migrations` table for the per-migration name and checksum this runner
 * needs. A legacy file predating the table is adopted by inspecting its actual
 * shape, not by trusting a number that may be stale.
 *
 * ADD A MIGRATION, DO NOT EDIT ONE. The checksum of an applied migration is
 * verified on every start, so editing a released migration makes existing
 * databases refuse to open rather than silently diverging from a fresh one.
 */
import { createHash } from 'node:crypto';
import { BASELINE_SQL } from './001-baseline.ts';
import { EPISODE_GROUNDING_SQL } from './002-episode-grounding.ts';

export interface Migration {
  version: number;
  name: string;
  /** Run as one transaction. Must be additive; never DROP user data. */
  sql: string;
  /**
   * Structural check that this migration is already present in a file that
   * predates `schema_migrations`. Cumulative with the ones before it: returning
   * true asserts migration 1 AND this one are both there.
   */
  alreadyApplied(db: Database): boolean;
}

const BASELINE_TABLES = [
  'persons', 'body_regions', 'episodes', 'episode_fields', 'episode_assertions',
  'episode_answers', 'safety_flags', 'clinical_assertions', 'transcripts',
] as const;

const GROUNDING_COLUMNS = [
  'grounding_status', 'grounding_reason', 'grounding_by', 'grounding_clarification',
] as const;

function tableNames(db: Database): Set<string> {
  return new Set(
    (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[])
      .map((r) => r.name),
  );
}

function columnNames(db: Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name),
  );
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'baseline-schema',
    sql: BASELINE_SQL,
    alreadyApplied(db) {
      const tables = tableNames(db);
      return BASELINE_TABLES.every((t) => tables.has(t));
    },
  },
  {
    version: 2,
    name: 'episode-grounding-columns',
    sql: EPISODE_GROUNDING_SQL,
    alreadyApplied(db) {
      if (!tableNames(db).has('episodes')) return false;
      const cols = columnNames(db, 'episodes');
      return GROUNDING_COLUMNS.every((c) => cols.has(c));
    },
  },
];

export const LATEST_VERSION: number = MIGRATIONS[MIGRATIONS.length - 1]!.version;

function checksum(m: Migration): string {
  // Length-prefixed rather than a template literal with separator characters.
  // A NUL byte crept into a separator in this literal once and turned the whole
  // file into a git binary blob, which is unreviewable in a diff. Joining an
  // explicit list cannot be corrupted that way, and prefixing each part with its
  // length means no two different (version, name, sql) triples can collide.
  const h = createHash('sha256');
  for (const part of [String(m.version), m.name, m.sql]) {
    h.update(String(part.length)).update(':').update(part);
  }
  return h.digest('hex');
}

/** Versions this file is already at, from `schema_migrations` if it has one. */
function recordedVersions(db: Database): number[] {
  if (!tableNames(db).has('schema_migrations')) return [];
  return (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[])
    .map((r) => Number(r.version));
}

/**
 * Tables this build owns. Anything else in the file means the file is not ours,
 * and adopting it as though it were empty would be how somebody loses data to a
 * wrong path in ASI_DB_PATH.
 */
const OWN_TABLES: ReadonlySet<string> = new Set([
  ...BASELINE_TABLES, 'schema_migrations', 'sqlite_sequence',
]);

/**
 * The version a legacy file is actually at, by inspecting its shape.
 *
 * Needed because a file written before this table existed carries no migration
 * history, and `user_version` alone cannot be trusted to describe the schema
 * when a build could bump the number without finishing the work.
 */
function probeVersion(db: Database): { version: number; unrecognised: boolean } {
  const present = [...tableNames(db)];
  const foreign = present.filter((t) => !OWN_TABLES.has(t));
  if (foreign.length) {
    return { version: 0, unrecognised: true };
  }
  // No tables at all: a genuinely fresh file.
  if (!present.some((t) => OWN_TABLES.has(t) && t !== 'sqlite_sequence')) {
    return { version: 0, unrecognised: false };
  }

  let version = 0;
  for (const m of MIGRATIONS) {
    if (m.alreadyApplied(db)) version = m.version;
    else break;
  }
  // Our tables exist but the baseline is not satisfied: this is not a database
  // this build can reason about, and guessing is how people lose data.
  if (version === 0) return { version: 0, unrecognised: true };
  return { version, unrecognised: false };
}

export interface MigrationReport {
  from: number;
  to: number;
  applied: { version: number; name: string }[];
  adopted: boolean;
}

/**
 * Apply every migration in `list` with a version above `from`, in order, each in
 * its own transaction.
 *
 * Separate from `migrate` so the transaction and rollback behaviour can be tested
 * against a deliberately broken migration without adding one to the real list.
 */
export function applyPending(
  db: Database,
  list: readonly Migration[],
  from: number,
  log: (msg: string) => void = () => {},
): { version: number; name: string }[] {
  const applied: { version: number; name: string }[] = [];
  // Foreign keys off for the duration: SQLite refuses to change the pragma inside
  // a transaction, and a migration may need to touch a referenced table. It is
  // restored in `finally`, so the cascading deletes the write path relies on are
  // unaffected once we return.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const m of list) {
      if (m.version <= from) continue;
      try {
        db.exec('BEGIN');
        db.exec(m.sql);
        db.prepare('INSERT OR REPLACE INTO schema_migrations (version, name, checksum, applied_at) VALUES (?,?,?,?)')
          .run(m.version, m.name, checksum(m), new Date().toISOString());
        setUserVersion(db, m.version);
        db.exec('COMMIT');
      } catch (e) {
        // Roll back to the last fully applied version. The version stamp went
        // with it, so a retry re-runs this migration from a known state and the
        // file is never left describing a schema it does not have.
        try { db.exec('ROLLBACK'); } catch { /* already unwound */ }
        throw new MigrationError(
          `migration ${m.version} (${m.name}) failed and was rolled back; the database is still at ` +
            `version ${m.version - 1}. Cause: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      applied.push({ version: m.version, name: m.name });
      log(`[asi] applied migration ${m.version} (${m.name})`);
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return applied;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/** Minimal structural view of the driver, so tests can pass their own handle. */
export interface Database {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...p: unknown[]): unknown[];
    get(...p: unknown[]): unknown;
    run(...p: unknown[]): unknown;
  };
  close?(): void;
}

function setUserVersion(db: Database, version: number): void {
  // PRAGMA does not accept a bound parameter. The value is a validated integer
  // from our own migration list, never anything caller-supplied.
  if (!Number.isInteger(version) || version < 0) {
    throw new MigrationError(`refusing to stamp an invalid schema version: ${String(version)}`);
  }
  db.exec(`PRAGMA user_version = ${version}`);
}

/**
 * Bring `db` to `LATEST_VERSION`. Safe to call on every startup.
 *
 * Foreign keys are disabled for the duration because SQLite refuses to change
 * `PRAGMA foreign_keys` inside a transaction, and a migration may need to drop
 * and rebuild a table that others reference. It is restored afterwards, so the
 * single-write-path guarantees that depend on cascading deletes are unaffected.
 */
export function migrate(db: Database, log: (msg: string) => void = () => {}): MigrationReport {
  // Fail fast on a malformed migration list rather than half-applying it.
  MIGRATIONS.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new MigrationError(
        `migration versions must be contiguous from 1: found ${m.version} at position ${i + 1}`,
      );
    }
  });

  const recorded = recordedVersions(db);
  const probed = probeVersion(db);
  const declared = Number(
    (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version ?? 0,
  );

  // Refuse BEFORE writing anything, so a file we cannot understand is not even
  // given a migration table.
  if (probed.unrecognised) {
    throw new MigrationError(
      'This file has ASI tables but does not match any schema this build knows how to migrate. ' +
        'It has NOT been modified and has NOT been deleted. Refusing to start rather than ' +
        'guessing at its shape. Restore a backup, or move the file aside and start fresh.',
    );
  }

  // CHECKSUM PROTECTION FIRST, and deliberately not weakened by adoption.
  //
  // Adoption exists for files this build did not migrate. It must not become a
  // way for an edited migration to slip past: if a migration really ran and its
  // SQL has since changed, that is a silent divergence between a fresh database
  // and every existing one, and it fails here.
  const byVersion = new Map(MIGRATIONS.map((m) => [m.version, m]));
  for (const version of recorded) {
    const m = byVersion.get(version);
    if (!m) {
      throw new MigrationError(
        `this database was migrated by a newer build (version ${version} is unknown here)`,
      );
    }
    const row = db
      .prepare('SELECT checksum FROM schema_migrations WHERE version = ?')
      .get(version) as { checksum?: string } | undefined;
    if (row?.checksum && row.checksum !== checksum(m)) {
      throw new MigrationError(
        `migration ${version} (${m.name}) was edited after it had already been applied. ` +
          'Add a new migration instead of changing an applied one.',
      );
    }
  }

  // THE SHAPE IS AUTHORITATIVE.
  //
  // Not `PRAGMA user_version`, and not the recorded table. Both are CLAIMS about
  // the schema; the columns are the schema. A number can be stale -- a build can
  // bump it without finishing the work -- and a recorded row can be absent, or
  // wrong, for a file that predates the table entirely. Taking
  // `Math.max(declared, probed, recorded)` meant a file that CLAIMED version 2
  // while genuinely being v1 skipped the migration it needed, and then could not
  // serve: `createEpisode` writes `grounding_by`, which would not exist.
  //
  // The one thing a declared version still decides is whether to touch the file
  // at all. A number ABOVE ours means a future build wrote this, and its shape may
  // contain things our probe does not check for, so downgrading it silently would
  // be exactly the incoherence this framework exists to prevent. This is a
  // refusal, not a "skip the pending work" rule, so a stale-but-not-future number
  // still gets its migrations applied.
  if (declared > LATEST_VERSION) {
    throw new MigrationError(
      `this database is at schema version ${declared}, newer than this build's ${LATEST_VERSION}. ` +
        'It has NOT been modified. Refusing to touch a file written by a newer build.',
    );
  }

  const from = probed.version;

  if (!tableNames(db).has('schema_migrations')) {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`);
  }

  // ADOPT BY RECORDING EACH MIGRATION AS ITSELF.
  //
  // The previous representation wrote one row with the sentinel checksum
  // 'adopted'. That works exactly once: on the next start the guard above
  // compares 'adopted' against the real hash and refuses to open the file. A
  // legacy database became unopenable by being opened.
  //
  // What is actually true of an adopted migration is that this file's schema is
  // consistent with what that migration produces. Recording the migration's own
  // name and checksum states exactly that, survives the next start, and needs no
  // special case in the verifier.
  const applied = applyPending(db, MIGRATIONS, from, log);
  const to = from + applied.length;

  const adopted: number[] = [];
  for (const m of MIGRATIONS) {
    if (m.version > from) continue;
    if (recorded.includes(m.version)) continue;
    db.prepare('INSERT OR REPLACE INTO schema_migrations (version, name, checksum, applied_at) VALUES (?,?,?,?)')
      .run(m.version, m.name, checksum(m), new Date().toISOString());
    adopted.push(m.version);
  }

  if (adopted.length) {
    log(`[asi] adopted an existing database: recorded migrations ${adopted.join(', ')}`);
  }

  // Stamp the version for anything inspecting the file with a plain SQLite tool.
  // A legacy file with no stamp gets one, so the next start has a number that is
  // true even though it is not what is trusted.
  setUserVersion(db, to);

  return { from, to, applied, adopted: adopted.length > 0 };
}

/**
 * The post-condition the running code depends on.
 *
 * Checked structurally rather than by version number, because a version can
 * survive a schema that was never finished. Serving from a half-understood file
 * is the failure this project cares most about, so it is an error, not a
 * warning.
 */
export function assertSchemaReady(db: Database): void {
  const m2 = MIGRATIONS[MIGRATIONS.length - 1]!;
  if (!m2.alreadyApplied(db)) {
    throw new MigrationError(
      'the schema is still incomplete after migrating; refusing to serve from it',
    );
  }
}
