# Relay v0.2 — Detailed Implementation Plan

**Status:** Planned, ready to execute. Produced from a planning pass that surveyed the full v0.1 codebase.
**Companion doc:** [`V02_ROADMAP.md`](V02_ROADMAP.md) (high-level tracking of scope + open items).

---

## 1. Widened `RelayStorage` interface

Target file: `packages/core/src/storage/types.ts`. Keep every read method already defined; add write, search, and blob-put methods. Search and realtime methods are OPTIONAL — adapters that don't support them omit the methods and set the matching capability flag to `false`. Callers MUST branch on capabilities, not method-presence (see §6 resolution (b)).

```ts
// Existing types re-exported: PackageRow, EmbeddingRow, StorageCapabilities,
// ReadOnlyRelayStorage. No changes.

export interface SearchHit {
  package_id: string;
  content_type: 'context_md' | 'decision' | 'question' | 'handoff';
  content: string;
  similarity: number;
}

export interface PackageInsert {
  row: Omit<PackageRow, 'created_at'>;
  upsert?: boolean;
}

export interface FactInsert {
  project_id: string;
  subject: string;
  relation: string;
  object: string;
  source_package_id: string | null;
  asserted_by_type: ActorType;
  asserted_by_id: string;
  valid_from?: string;
  ended_at?: string | null;
  id?: string;
}

export interface SessionInsert {
  id: string;
  project_id: string;
  actor_type: ActorType;
  actor_id: string;
  agent_description?: string;
  packages_pulled?: string[];
  packages_deposited?: string[];
  started_at?: string;
  ended_at?: string | null;
}

export interface ProjectInsert {
  id?: string;
  name: string;
  description?: string;
  owner_id?: string;
  settings?: Record<string, unknown>;
  archived_at?: string | null;
}

export interface HybridSearchQuery {
  projectId: string;
  queryText: string;
  queryEmbedding: number[];
  matchCount: number;
  topic?: string | null;
  artifactType?: string | null;
}

export interface SemanticSearchQuery {
  projectId: string;
  queryEmbedding: number[];
  matchCount: number;
}

export interface RelayStorage {
  readonly capabilities: StorageCapabilities;

  // Projects
  getProject(id: string): Promise<Project | null>;
  listProjects(opts?: { includeArchived?: boolean }): Promise<Project[]>;
  insertProject(p: ProjectInsert): Promise<Project>;
  updateProjectArchived(id: string, archivedAt: string | null): Promise<Project>;

  // Packages
  getPackage(id: string): Promise<PackageRow | null>;
  listPackages(q: { projectId: string; limit?: number; sinceIso?: string }): Promise<PackageRow[]>;
  insertPackage(p: PackageInsert): Promise<void>;
  findPackageByDescriptionLike(q: { projectId: string; pattern: string; limit?: number }): Promise<Pick<PackageRow, 'id'>[]>;

  // Facts — inserts take full rows so restore can replay historic timestamps
  queryFacts(q: FactQuery & { projectId: string }): Promise<RelayFact[]>;
  insertFact(f: FactInsert): Promise<RelayFact>;
  endFact(id: string, endedAt: string): Promise<void>;
  endFactsMatching(q: { projectId: string; subject: string; relation: string; object?: string; endedAt: string }): Promise<number>;

  // Sessions
  listSessions(q: { projectId: string }): Promise<Session[]>;
  insertSession(s: SessionInsert): Promise<Session>;
  endSession(id: string, endedAt: string): Promise<void>;

  // Embeddings
  insertEmbeddings(rows: EmbeddingRow[]): Promise<void>;

  // Blobs
  getBlob?(key: string): Promise<Uint8Array | null>;
  putBlob?(key: string, body: Uint8Array, contentType?: string): Promise<void>;

  // Search (optional; capability-gated)
  hybridSearch?(q: HybridSearchQuery): Promise<SearchHit[]>;
  semanticSearch?(q: SemanticSearchQuery): Promise<SearchHit[]>;
}
```

**Design notes:**
- `insertFact` takes explicit `valid_from`/`ended_at`/`id` so the restore command can replay historic supersession chains byte-identically. The convenience `assertFact` (auto-supersede) stays in `RelayClient`, not in the adapter.
- `insertProject` returns the full row so `RelayClient` can surface the server-assigned id.
- `findPackageByDescriptionLike` names the single awkward `.like()` query (autoDeposit's git-fingerprint dedup at `client.ts:319`) rather than exposing generic LIKE.

---

## 2. Supabase adapter refactor

Target: `packages/core/src/storage/supabase.ts` (NEW).

### Inventory of `this.supabase.*` sites in `client.ts`

29 distinct SQL-producing sites (roadmap said 22; real count counts multi-line chains as one).

| Line | Caller | Pattern | Maps to |
|---|---|---|---|
| 88 | constructor | `createClient` | Internal to `SupabaseStorage` constructor |
| 183 | startSession | `sessions.insert().select().single()` | `insertSession` |
| 200 | endSession | `sessions.update({ended_at}).eq(id)` | `endSession` |
| 242 | deposit | `.storage.from('context-packages').upload` | `putBlob` |
| 256 | deposit | `context_packages.insert(...)` | `insertPackage` |
| 286 | deposit | `generateAndStoreEmbeddings(supabase, ...)` | port to take `RelayStorage` |
| 319 | autoDeposit | `context_packages.select('id').eq.like.limit` | `findPackageByDescriptionLike` |
| 402 | autoDeposit | `.storage.upload` | `putBlob` |
| 416 | autoDeposit | `context_packages.insert` | `insertPackage` |
| 446 | autoDeposit | `generateAndStoreEmbeddings` | port |
| 458 | pullPackage | `context_packages.select('manifest').eq.single` | `getPackage` |
| 474 | getLatestPackages | `context_packages.select(manifest,created_at).eq.order.limit` | `listPackages` + client-side map |
| 505 | search | `rpc('hybrid_search')` | `hybridSearch` |
| 517 | search | `rpc('search_context')` fallback | `semanticSearch` |
| 537 | getProject | `projects.select('*').eq.single` | `getProject` |
| 553 | listProjects | `projects.select('*').is(archived_at, null)` | `listProjects` |
| 563 | createProject | `projects.insert.select.single` | `insertProject` |
| 610 | archiveProject | `projects.update(archived_at=now).eq.select.single` | `updateProjectArchived` |
| 638 | restoreProject | `projects.update(archived_at=null).eq.select.single` | `updateProjectArchived` |
| 659 | isProjectArchived | `projects.select('archived_at').eq.maybeSingle` | `getProject` + client composition |
| 716 | getOrientation | `context_packages.select(cols).eq.gte.order` | `listPackages` + client projection |
| 925 | assertFact | `relay_facts.select.eq.eq.eq.is.limit` | `queryFacts({limit:1})` |
| 943 | assertFact | `relay_facts.update(ended_at).eq(id)` | `endFact` |
| 951 | assertFact | `relay_facts.insert.select.single` | `insertFact` |
| 981 | invalidateFact | `relay_facts.update(ended_at).eq.eq.eq.is.eq.select(id)` | `endFactsMatching` |
| 1009 | queryFacts | `relay_facts.select.eq.order...` | `queryFacts` |
| 1084 | getPackage | `context_packages.select.eq.maybeSingle` | `getPackage` |
| 1102 | listPackages | `context_packages.select.eq.order.gte.limit` | `listPackages` |
| 1120 | listSessions | `sessions.select.eq.order` | `listSessions` |
| 1137 | getBlob | `.storage.download` | `getBlob` |

### `SupabaseStorage` class shape

```ts
export class SupabaseStorage implements RelayStorage {
  private supabase: SupabaseClient;
  private bucket: string; // 'context-packages'

  constructor(opts: { url: string; key: string; bucket?: string });

  get capabilities(): StorageCapabilities {
    return { hybridSearch: true, semanticSearch: true, realtime: true };
  }

  // ... every method from widened interface
}
```

Internal helper kept private: `blobPathFor(projectId, packageId)` — centralizes the `${projectId}/${packageId}.relay.zip` layout. Closes §6(a) by making path format adapter-internal.

### Migration sequence

Do in this order so `RelayClient`'s public API stays byte-identical at every step:

1. Create `SupabaseStorage` class with stubs that throw `NotImplementedError`. Add `storage: RelayStorage` field to `RelayClient`; both `this.supabase` and `this.storage` coexist during refactor.
2. Port methods lowest-risk first:
   - Projects: `getProject`, `listProjects`, `insertProject`, `updateProjectArchived` (lines 537, 553, 563, 610, 638, 659)
   - Sessions: `insertSession`, `endSession` (183, 200)
   - Packages read: `listPackages` (474, 716)
   - Packages write: `insertPackage`, `findPackageByDescriptionLike` (256, 319, 416)
   - Facts: `insertFact`, `endFact`, `endFactsMatching`, `queryFacts` (925, 943, 951, 981, 1009)
   - Blobs: `putBlob`, `getBlob` (242, 402, 1137)
   - Search: `hybridSearch`, `semanticSearch` (505, 517). Fallback chain (hybrid → semantic) stays in `RelayClient.search` as capability-gated composition.
   - Embeddings: `insertEmbeddings`. Port `generateAndStoreEmbeddings(storage, ...)` at `embeddings.ts:86` (286, 446 in client).
3. Delete `private supabase: SupabaseClient` from `RelayClient`. Remove `createClient` import. Gate: `grep -r "@supabase/supabase-js" packages/core/src/` returns only `storage/supabase.ts`.

### Risks

- `getOrientation` (716) projects specific columns. Option (a): `listPackages` returns full rows, orient maps in client. Option (b): add an overload. Recommend **(a)** — orientation windows cap at ~14 days, row count bounded.
- Blob upload + package insert (lines 242/256, 402/416) are sequential and NOT transactional today (upload fails → row inserted with `storage_path=null`). Preserve the behavior — no atomicity to coordinate.
- Line 319's `.like` query — expose as named `findPackageByDescriptionLike`; SQLite adapter reimplements with `WHERE description LIKE ?`.

---

## 3. `relay restore` command

### Signature

```
relay restore --from <path> [--project <id>] [--overwrite | --skip | --rename]
              [--dry-run] [--since <iso>] [--only <kinds>] [--no-blobs]
              [--no-embeddings] [--no-facts] [--no-sessions]
              [--to <storage-url>]
```

| Flag | Meaning |
|---|---|
| `--from` | Root of backup dir (contains `manifest.json`). |
| `--project <id>` | Restore only this project (for multi-project backups). |
| `--overwrite` | On `package_id` conflict, replace row+blob. Exclusive with `--skip`/`--rename`. |
| `--skip` (default) | On conflict, skip+warn. |
| `--rename` | Append `_restored_<shortid>` on conflict. Warns loudly (breaks FK refs). |
| `--dry-run` | Parse+validate, report counts and conflicts, write nothing. |
| `--since <iso>` | Only rows with timestamp ≥ iso. |
| `--only <kinds>` | Comma-separated subset: `packages,facts,sessions,blobs,embeddings`. |
| `--to <storage-url>` | Target storage (default = configured). Enables "restore Supabase backup into local SQLite." |

### Policies

**ID collision — default `--skip`.** Restore is most commonly "resurrect lost project" or "move backup into fresh SQLite" — both expect empty target; collisions mean something went wrong and skip preserves existing data. `--overwrite` for "re-sync same backup into partially-populated target" (explicit user intent). `--rename` is a footgun (breaks `parent_package_id` FKs) — warn loudly.

**FK ordering:**
1. `projects.ndjson` → `insertProject` (preserve `id`, `archived_at`, `settings`).
2. `packages.ndjson` → `insertPackage`. Sort by `created_at` ascending so parents precede children (parents are always created earlier per protocol immutability).
3. Blobs → `putBlob` after matching package exists. Blob keyed by adapter-internal layout; restore reads file path and re-derives the key via the adapter.
4. `facts.ndjson` → `insertFact`, preserving `id`, `valid_from`, `ended_at`. Sort by `valid_from` ascending.
5. Embeddings (optional, from `embeddings.ndjson` if present). Absent → skip; they regenerate lazily.
6. `sessions.ndjson` → `insertSession`. Last because `packages_deposited`/`packages_pulled` arrays reference packages.

**Fact replay — replay the full supersession chain.** Backup emits facts with `includeEnded: true` (full history). Restoring only currently-active facts would violate §7.3 of AGENTIC_PROTOCOL.md (point-in-time queries would return wrong values). Adapter `insertFact` is a dumb INSERT taking pre-computed `valid_from`/`ended_at`/`id` — no auto-supersede. `RelayClient.assertFact` (the auto-supersede convenience) is NOT called during restore.

### Dry-run behavior

- Parse `manifest.json`, verify `backup_format_version === "1"`, verify `protocol_version` starts with `"0."`.
- Stream each NDJSON, validate shape, count rows.
- For each package: `storage.getPackage(id)`; if exists, record as conflict. Report top N.
- For each fact: verify `source_package_id` FK exists in target or earlier in restore file.
- Verify each referenced blob file exists on disk.
- Emit summary: rows-to-insert, rows-to-skip/overwrite, blob-bytes, validation errors.
- Exit 0 on clean dry-run, 1 if hard validation errors would prevent real restore.

### Error handling

- Missing `manifest.json` → abort.
- `backup_format_version` mismatch → abort with guidance.
- Invalid JSON on any line → abort on first error (no partial restore of corrupt file).
- Missing `projects.ndjson` → abort.
- Missing `packages.ndjson` → continue (facts-and-sessions-only restore is valid for partial exports).
- Blob referenced but missing on disk → warn, insert row with `storage_path=null`, count as blob error, continue.
- FK violation on insert → record row as skipped with reason, continue.

### Output

- Progress events: `projects_inserted`, `packages_batch`, `blob_uploaded`, `blob_missing`, `facts_done`, `sessions_done`, `conflict_skipped`.
- Final summary:
  ```
  Restored from /path/to/backup:
    projects: 3 inserted, 0 skipped
    packages: 1847 inserted, 12 skipped (conflicts)
    blobs:    1835 / 1847 uploaded (12 missing in source)
    facts:    3214 inserted (full history)
    sessions: 189 inserted
  ```
- Exit codes: 0 success, 1 validation/parse error, 2 partial failure, 3 target-storage error.

---

## 4. SQLite storage adapter

### Package structure

```
packages/storage-sqlite/
  package.json          — deps: better-sqlite3, @relay/core
  src/
    index.ts            — exports SqliteStorage
    sqlite.ts           — class SqliteStorage implements RelayStorage
    schema.sql          — translated DDL
    migrations.ts       — applies schema on first open
    blobs.ts            — blob-on-disk helper (files under <dbPath>/../blobs/)
  tsconfig.json
```

### Schema translation (Postgres → SQLite)

- `text primary key default 'proj_' || gen_random_uuid()` → `TEXT PRIMARY KEY NOT NULL` + app-layer `crypto.randomUUID()`.
- `timestamptz default now()` → `TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))` (ISO-8601 strings with milliseconds).
- `text[]` → `TEXT NOT NULL DEFAULT '[]'` (JSON array). Query via `json_each()`.
- `jsonb` → `TEXT NOT NULL`. SQLite 3.45+ has `jsonb` type but portable choice is TEXT.
- `vector(384)` → `BLOB` (packed Float32 LE, 1536 bytes). Capability `semanticSearch: false`. Embeddings still stored so backup round-trips.
- GIN tsvector index → not available. Ship FTS5 virtual table `packages_fts` with triggers on insert/update/delete — enables future keyword-only `hybridSearch`.
- ivfflat index → drop. No equivalent without `sqlite-vec` extension.

### Capability descriptor

```ts
get capabilities(): StorageCapabilities {
  return { hybridSearch: false, semanticSearch: false, realtime: false };
}
```

`hybridSearch`/`semanticSearch` methods simply aren't implemented. `RelayClient.search` must check capability before calling.

### Activation

```bash
relay config set storage sqlite:///absolute/path/to/relay.db
```

Writes `storage` key to `~/.relay/config.json`. `RelayClient.fromConfig` inspects: `sqlite://` → `SqliteStorage`; else `SupabaseStorage` (back-compat with `core_url`/`api_key`).

### Risks

- Search capability gap is the real risk, not schema translation. `relay pull --mode relevant` against SQLite MUST degrade cleanly — hard error per §6(b), not silent LIKE fallback.
- `better-sqlite3` is synchronous. Wrap in async methods; performance is excellent.
- WAL mode required: `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;` at open.
- Timestamp precision: Postgres `timestamptz` is microsecond; SQLite ISO strings are millisecond. Document the precision loss or use `%f` for milliseconds.

---

## 5. `relay sync` command

### Signature

```
relay sync --from <source-url> --to <target-url>
           [--project <id>] [--since <iso>]
           [--watch] [--interval <seconds>]
           [--dry-run]
```

`<source-url>` / `<target-url>` scheme matches `storage` config: `sqlite:///path`, `supabase://<url>#<key>`, or `config:` (use configured storage). Example:
- `relay sync --from config: --to sqlite:///backup.db --watch` — live mirror.
- `relay sync --from sqlite:///desktop.db --to config:` — reconcile desktop → laptop Supabase.

### Algorithm

1. Construct `sourceStorage` + `targetStorage` via `openStorage(url)` factory.
2. Project set: if `--project`, that one; else `sourceStorage.listProjects({includeArchived: true})`.
3. For each project:
   - Cursor: `cursorIso = max(target_latest_package_created_at, --since)`. Fetched by `targetStorage.listPackages({projectId, limit: 1})`.
   - Stream `sourceStorage.listPackages({projectId, sinceIso: cursorIso})`.
   - Per row: if `targetStorage.getPackage(id)` exists AND hash matches, skip. Else `targetStorage.insertPackage({row, upsert: true})`.
   - If source blob exists and target doesn't: copy via `getBlob` → `putBlob`.
   - Stream facts: `sourceStorage.queryFacts({projectId, includeEnded: true})`, filter by `valid_from >= cursorIso`. Insert into target preserving `id`/`valid_from`/`ended_at`.
   - Stream sessions: filter by `started_at >= cursorIso`, insert.
4. Per-project summary (same shape as restore).

### Conflicts

- Target has packages source doesn't → leave alone (one-directional sync per run; bidirectional = v0.3).
- Source has newer version of same `package_id` than target → shouldn't happen per §10.1 immutability. Log loud warning, skip.
- Fact conflict (same `(project, subject, relation)` active both sides, different `object`): target keeps its value; insert source's row anyway with source's `id` (temporal timeline stays correct). If source has `ended_at` and target active: `endFact(id, endedAt)` only if `source.ended_at > target.valid_from`.

### `--watch` behavior

v0.2: poll-based. `--interval` default 30s. Between polls, keep cursor in memory; on SIGINT, persist last-synced-iso to sidecar (e.g., `<dbPath>.sync-cursor.json`). Realtime subscription (when both sides declare `realtime: true`) = v0.3.

---

## 6. Resolution of 5 open design questions

**(a) Blob storage shape — opaque k-v, adapter owns layout.** `putBlob(key, body, contentType?)`, `getBlob(key)`. Adapter has private `blobPathFor(projectId, packageId)`. `RelayClient.deposit` never constructs paths in v0.2. Backup's rewrite of `storage_path` → `blobs/<project>/<package>.relay.zip` becomes the canonical portable-backup layout; adapters translate on import/export. **NEEDS JORDAN'S CALL:** confirms you're OK removing the (currently-unused) ability to pick bucket paths.

**(b) Search fallback — hard error.** `RelayClient.search()` against storage with `hybridSearch: false && semanticSearch: false` throws `StorageCapabilityError("Search not supported by the configured storage. Use 'relay pull --mode latest' or configure Supabase storage.")`. Matches AGENTIC_PROTOCOL.md §11's `501 not_implemented`. Silent LIKE fallback creates harder-to-debug UX than an explicit error.

**(c) Embeddings in backup — text by default, `--include-embeddings` opt-in.** Default omits vectors; source text is already in `packages.ndjson`. Restore regenerates embeddings via `generateAndStoreEmbeddings` on first deposit OR explicit `relay reindex` (v0.3). With `--include-embeddings`, backup emits `embeddings.ndjson` (one `EmbeddingRow` per line, vector as JSON `number[]`). Reasoning: vectors ~1.5 KB each × 2000 packages × 4 chunks = 12 MB vs ~200 KB text. Vectors also bind the backup to the specific embedding model (all-MiniLM-L6-v2 at 384 dims). Text is portable; vectors are model-locked.

**(d) All-projects from unmapped CWD — require `--confirm-all`.** When CWD maps to no project AND `--all-projects` passed, print "You're about to back up N projects (<ids>). Add `--confirm-all` if that's intentional." Without the flag, refuse. Single-project backup from unmapped CWD continues to require `--project <id>`.

**(e) Version fields in manifest — both top-level.** `protocol_version: "0.1"` + `backup_format_version: "1"` both top-level (already implemented). Semver independent: `backup_format_version` bumps when NDJSON shape changes (e.g. adds `embeddings.ndjson`); `protocol_version` bumps when packages change shape.

---

## 7. Execution order

### Session A — Full adapter refactor (8–12 hours)

**Ships:**
- Widened `packages/core/src/storage/types.ts`.
- `packages/core/src/storage/supabase.ts` with full `SupabaseStorage`.
- `packages/core/src/client.ts` refactored: every `this.supabase.*` → `this.storage.*`. Public API byte-identical.
- `packages/core/src/embeddings.ts` ported to `RelayStorage`.
- `packages/core/src/index.ts` exports `SupabaseStorage`.

**Testable:**
- `grep -r "@supabase/supabase-js" packages/core/src/` returns only `storage/supabase.ts`.
- `pnpm --filter @relay/core typecheck` passes.
- Smoke against live DB (READ ONLY first): `relay backup --project proj_dev_relay` produces identical output to pre-refactor.
- Full smoke: `relay deposit`/`pull`/`facts assert` all work.
- `relay orient` bundle renders identically (snapshot before Session A; diff after).

### Session B — `relay restore` + dry-run validator (6–9 hours)

**Ships:**
- `packages/core/src/restore.ts` (`RestoreService`, symmetric to `BackupService`).
- `packages/cli/src/commands/restore.ts` with full flag surface.
- Dry-run as a mode of `RestoreService`.
- `StorageCapabilityError` class.

**Testable:**
- Round-trip: `relay backup --out ./b1` → `relay restore --from ./b1 --to sqlite:///./test.db --dry-run` reports no conflicts.
- Full round-trip (after Session C): `backup → restore --to sqlite → backup from sqlite → diff` yields identical NDJSON modulo timestamps.
- Conflict: backup twice into same target; verify `--skip` default and `--overwrite` both work.
- Partial: `--only packages --since 2026-04-01` restores correct subset.
- Fact replay: project with 3 supersessions of same (subject, relation) round-trips; point-in-time query returns historically-correct values.

### Session C — SQLite adapter + `relay sync` (10–14 hours)

**Ships:**
- `packages/storage-sqlite/` (SqliteStorage, schema, migrations).
- `packages/cli/src/commands/sync.ts` (stream + watch polling).
- `RelayClient.fromConfig` parses `storage: sqlite://...` URL.
- FTS5 triggers ready (not exposed; capability stays false).

**Testable:**
- `relay config set storage sqlite:///./relay.db` + `relay deposit "hello"` round-trips.
- `relay sync --from <supabase> --to sqlite:///./mirror.db` produces valid mirror; second run is no-op.
- `relay backup` against SQLite produces valid, restore-able backup (proves adapter is symmetric).
- `relay search "foo"` against SQLite throws `StorageCapabilityError` with helpful message.
- Watch: deposit to Supabase, sync loop picks it up within `--interval`.

**Total v0.2 effort estimate: 24–35 hours.** Achievable across 2–3 focused sessions.

---

## 8. Risks and mitigations

**Live dogfooding.** The maintainer runs Relay against a live DB during the refactor. Session A touches every write path. Mitigation: worktree branch; reads-only against live DB first; write-path changes use throwaway `proj_refactor_smoke` before touching the primary project. Take a `relay backup` before Session A starts; verify it's still readable via restore dry-run after each session.

**Test coverage gap.** No `*.test.*` files in `packages/core` or `packages/cli` today. Proposed minimum smoke tests (plain `node --test`, no framework dependency):
- `packages/core/src/storage/supabase.test.ts` — mocks `SupabaseClient` stub; verifies every `RelayStorage` method produces expected call sequence.
- `packages/core/src/restore.test.ts` — fixture NDJSON in `test/fixtures/backup/`; asserts restore into in-memory SQLite adapter produces expected row counts.
- `packages/storage-sqlite/src/sqlite.test.ts` — temp DB, every `RelayStorage` method, round-trip.
- `packages/cli/test/roundtrip.test.ts` — e2e: backup → restore → backup produces byte-identical NDJSON (post-normalization).

Four thin tests catch 80% of plausible regressions. Worth the ~hour of scaffolding.

**Schema compatibility Postgres → SQLite.**
- Timestamp precision (microsecond vs millisecond) — use `%f` format, document the loss.
- `jsonb` vs TEXT — SQLite doesn't validate. `JSON.parse(JSON.stringify(obj))` in `SqliteStorage` as cheap validation.
- `check` constraints on enums — verify syntax on first migration run.
- FK cascades — `PRAGMA foreign_keys=ON` required per connection. Set in constructor always.

**v0.1 interface design issues worth flagging.**
- `listPackages` returns full `PackageRow[]`. Orientation path only needs 6 cols. Projects with 1000+ auto-deposits may want a `listPackagesCompact` in v0.3. Keep an eye on.
- `getBlob` is optional in v0.1. For symmetry, `putBlob` should stay OPTIONAL in v0.2 too (a future flat-file adapter may have get but not put). Document the convention: callers check `typeof storage.putBlob === 'function'`.
- `backup.ts:310` loads all packages into memory (`limit: 100_000` fallback). Fine until ~10k packages per project. Cursor-page properly as a Session B cleanup item.
- `BACKUP_FORMAT_VERSION = '1'` is a string. Adding `embeddings.ndjson` is additive (old restorers ignore); keep version at `"1"`. If existing file shape changes, bump to `"2"` with migration-at-restore path.
