/**
 * Storage URL factory. Parses a scheme-prefixed URL into a concrete
 * `RelayStorage` instance. Used by:
 *   - `RelayClient.fromConfig()` to honor the `storage:` field in
 *     `~/.relay/config.json`.
 *   - `relay restore --to <url>` / `relay sync --from <url> --to <url>`
 *     to target a different storage than the configured default.
 *
 * Supported schemes:
 *   - `config:`                 — use the caller-provided `defaults`
 *     (typically the configured Supabase URL + key). Returns a
 *     `SupabaseStorage` adapter.
 *   - `supabase://<host>#<key>` — explicit Supabase. `<host>` is the
 *     URL minus `https://` (e.g. `mgnomitiijancakhniio.supabase.co`).
 *     `<key>` is the service role or anon key.
 *   - `sqlite:///<absolute-path>` — SQLite file. Requires
 *     `registerSqliteFactory()` to have been called first (typically by
 *     the CLI entry point, which depends on @relay/storage-sqlite).
 *     This registration pattern avoids a build-time cycle:
 *     @relay/storage-sqlite depends on @relay/core, so @relay/core
 *     can't depend back on it.
 */

import * as path from 'node:path';
import type { RelayStorage } from './types.js';
import { SupabaseStorage } from './supabase.js';

export interface OpenStorageDefaults {
  core_url: string;
  api_key: string;
}

export type SqliteFactory = (opts: { dbPath: string; blobsDir?: string }) => RelayStorage;

let registeredSqliteFactory: SqliteFactory | null = null;

/**
 * Register the SqliteStorage factory. Call this from an entry point
 * (CLI, MCP) before any `openStorage('sqlite://...')` call. Overriding
 * a previous registration is allowed — latest wins.
 */
export function registerSqliteFactory(factory: SqliteFactory): void {
  registeredSqliteFactory = factory;
}

export async function openStorage(
  url: string,
  defaults?: OpenStorageDefaults,
): Promise<RelayStorage> {
  if (!url || url === 'config:') {
    if (!defaults?.core_url || !defaults?.api_key) {
      throw new Error(
        `openStorage("config:") requires caller-provided Supabase core_url + api_key defaults.`,
      );
    }
    return new SupabaseStorage({ url: defaults.core_url, key: defaults.api_key });
  }

  if (url.startsWith('supabase://')) {
    const payload = url.slice('supabase://'.length);
    const hashIdx = payload.indexOf('#');
    if (hashIdx < 0) {
      throw new Error(
        `supabase:// URL missing #<api-key>. Expected: supabase://<host>#<key>`,
      );
    }
    const host = payload.slice(0, hashIdx);
    const key = payload.slice(hashIdx + 1);
    if (!host || !key) {
      throw new Error(`supabase:// URL has empty host or key: ${url}`);
    }
    const supabaseUrl = host.startsWith('http') ? host : `https://${host}`;
    return new SupabaseStorage({ url: supabaseUrl, key });
  }

  if (url.startsWith('sqlite://')) {
    // Accept any number of leading slashes after `sqlite:` — Git Bash on
    // Windows rewrites `$(pwd)` to `/x/...` which can produce a URL like
    // `sqlite:////x/...` when composed via `sqlite:///$(pwd)/foo.db`.
    // Strip the scheme + ALL leading slashes in the path, then resolve
    // against CWD so both `sqlite:///X:/absolute.db` and
    // `sqlite://./relative.db` and `sqlite://relative.db` all work.
    let dbPath = url.slice('sqlite://'.length).replace(/^\/+/, '');
    if (!dbPath) {
      throw new Error(`sqlite:// URL missing a path. Expected: sqlite:///<path>`);
    }
    // Bash-rewritten `/x/path` — put the drive letter back.
    if (/^[a-zA-Z]\//.test(dbPath) && !/^[a-zA-Z]:/.test(dbPath)) {
      dbPath = dbPath[0] + ':/' + dbPath.slice(2);
    }
    dbPath = path.resolve(dbPath);
    if (!registeredSqliteFactory) {
      throw new Error(
        `sqlite:// storage requires registerSqliteFactory() to be called first. ` +
          `The CLI entry point normally does this at startup.`,
      );
    }
    return registeredSqliteFactory({ dbPath });
  }

  throw new Error(
    `Unknown storage URL scheme: "${url}". Supported: config:, supabase://<host>#<key>, sqlite:///<path>.`,
  );
}
