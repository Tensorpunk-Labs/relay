import type { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.js';

/**
 * Apply the baseline SqliteStorage schema to a fresh or existing DB.
 *
 * Idempotent — every `CREATE TABLE` and `CREATE INDEX` uses
 * `IF NOT EXISTS`. Future schema bumps extend `SCHEMA_SQL` rather than
 * emitting new migration files; `relay_meta.schema_version` tracks the
 * version so future migrations can gate on it.
 */
export function applyMigrations(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
}

/**
 * Required pragmas for every Relay SQLite connection.
 *   - `journal_mode = WAL`  — concurrent readers while one writer.
 *   - `foreign_keys = ON`   — off by default in SQLite for backward
 *     compat; every Relay adapter expects it on.
 *   - `busy_timeout = 5000` — short-lived contention (e.g. `relay sync
 *     --watch` polling in parallel with a deposit) shouldn't fail fast.
 */
export function applyPragmas(db: DatabaseSync): void {
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.exec(`PRAGMA foreign_keys = ON;`);
  db.exec(`PRAGMA busy_timeout = 5000;`);
}
