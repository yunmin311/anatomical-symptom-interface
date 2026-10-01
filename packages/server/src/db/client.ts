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
import { assertSchemaReady, migrate } from './migrations/index.ts';

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
 * Handled by the migration runner: migrations are applied in version order, each
 * in its own transaction, and a version change never drops a table. This used to
 * be "on a version change, rebuild the file from scratch", which was only
 * defensible while the data was throwaway and which made adding a column to a
 * populated database impossible.
 *
 * If the file is not a database this build can migrate, startup fails with an
 * explanation. It is never deleted.
 */
const report = migrate(db, (m) => console.warn(m));
if (report.applied.length) {
  console.warn(`[asi] schema migrated ${report.from} → ${report.to}`);
}
assertSchemaReady(db);


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
