# 0001 — Local-first SQLite storage

**Status:** accepted · **Date:** 2026-09-29

## Context

The product handles highly sensitive health data. The plan (§9) requires
privacy-by-design from day one: local-first, minimal egress, export and delete.

Storage options considered: Postgres, SQLite via an ORM, SQLite via `node:sqlite`,
and a document store.

## Decision

**SQLite through Node's built-in `node:sqlite`.** No ORM yet. Provenance stored
relationally in `field_provenance`; the symptom record itself stored as JSON.

## Rationale

- **No native compilation.** `better-sqlite3` needs a build step that breaks on node
  and OS changes. `node:sqlite` is in the runtime.
- **Portable single file.** The user can copy, back up, or open their health record in
  any tool. For this product that matters more than query ergonomics.
- **Provenance needs to be relational.** `field_provenance` is a table keyed by
  `(episode_id, field_path)`, not a blob, so "everything the model inferred" is a
  `WHERE` clause. An ORM would obscure that rather than help it.
- **The schema is still moving.** Adding an ORM before the schema stabilises is paying
  for migrations to a shape that will change.

## Consequences

- Queries are hand-written SQL. More verbose, but no hidden behaviour.
- No concurrent write story. Fine for a single local person; revisit if sync arrives.
- **Revisit Drizzle** when the schema stops moving, or when Postgres replication for
  multi-device sync becomes real.

## Alternatives rejected

| Option | Why not |
|---|---|
| Postgres | Operational weight out of proportion to one local user. Cloud Postgres would put health data on someone else's disk. |
| `better-sqlite3` | Native build, no upside over `node:sqlite`. |
| IndexedDB (browser-only) | Good for offline-first, but loses SQL for provenance queries and makes export a manual affair. Could be added later as a read cache. |
| Document store | Provenance is inherently relational. |
