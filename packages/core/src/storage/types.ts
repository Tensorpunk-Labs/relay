/**
 * RelayStorage — the storage-agnostic contract Relay speaks against.
 *
 * v0.1: read-only subset (backup / export / local inspection).
 * v0.2: widened with write, search, and blob-put methods. Search and
 *       blob-put methods are OPTIONAL — adapters that don't support them
 *       omit the methods and set the matching capability flag to `false`.
 *       Callers MUST branch on `capabilities`, not method-presence.
 *
 * Design notes:
 *   - Row shapes (`PackageRow`, `EmbeddingRow`) mirror the Supabase Postgres
 *     schema one-to-one so a backend-of-record can return them without a
 *     translation layer. Non-Supabase implementations translate on their
 *     side.
 *   - `insertFact` takes explicit `valid_from`/`ended_at`/`id` so a restore
 *     can replay historic supersession chains byte-identically.
 *     `RelayClient.assertFact` (auto-supersede convenience) wraps it.
 *   - `insertProject` returns the full row so `RelayClient` can surface the
 *     server-assigned id.
 *   - `findPackageByDescriptionLike` names autoDeposit's git-fingerprint
 *     dedup query. A SQLite adapter reimplements with `WHERE description
 *     LIKE ?`; generic LIKE is never exposed.
 *   - Blobs use opaque key-value semantics: the adapter owns its path
 *     layout via a private `blobPathFor(projectId, packageId)`. Callers
 *     never construct paths.
 */

import type {
  RelayManifest,
  RelayFact,
  Project,
  Session,
  PackageStatus,
  PackageType,
  ReviewType,
  ActorType,
  Deliverable,
  FactQuery,
} from '../types.js';

/**
 * Row shape for a `context_packages` record. Matches the Postgres schema in
 * `supabase/migrations/001_initial_schema.sql` + `005_topic_artifact_type.sql`,
 * extended with the `significance` column added post-001.
 *
 * `manifest` is the authoritative JSONB — the flat columns above it are
 * denormalized for SQL filtering and exist because Postgres can't index
 * into JSONB as cheaply as native columns.
 */
export interface PackageRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: PackageStatus;
  package_type: PackageType;
  review_type: ReviewType;
  parent_package_id: string | null;
  created_by_type: ActorType;
  created_by_id: string;
  session_id: string | null;
  tags: string[];
  open_questions: string[];
  decisions_made: string[];
  handoff_note: string;
  estimated_next_actor: ActorType | null;
  deliverables: Deliverable[];
  storage_path: string | null;
  context_md: string;
  significance: number;
  manifest: RelayManifest;
  topic: string | null;
  artifact_type: string | null;
  created_at: string;
}

/**
 * Row shape for a `package_embeddings` record. Included in the interface
 * so v0.2 portable-backup can round-trip vectors, but no read method in
 * the v0.1 subset returns these — embeddings are large and usually
 * rebuildable from `context_md`.
 */
export interface EmbeddingRow {
  package_id: string;
  content_type: 'context_md' | 'decision' | 'question' | 'handoff';
  content: string;
  embedding: number[];
}

/**
 * Feature flags an implementation advertises. Backup doesn't need any of
 * these; they exist so future callers can avoid asking a local
 * SQLite-backed store to do pgvector cosine search.
 */
export interface StorageCapabilities {
  readonly hybridSearch: boolean;
  readonly semanticSearch: boolean;
  readonly realtime: boolean;
}

// ---------------------------------------------------------------------------
// Write payloads (v0.2)
// ---------------------------------------------------------------------------

/**
 * Insert payload for `context_packages`. `row` carries the full row minus
 * `created_at` (server-assigned). `upsert: true` flips the adapter to
 * ON CONFLICT (id) DO UPDATE — used by `relay restore --overwrite` and
 * `relay sync`. Default: INSERT, fail on duplicate id.
 */
export interface PackageInsert {
  row: Omit<PackageRow, 'created_at'>;
  upsert?: boolean;
}

/**
 * Insert payload for `relay_facts`. Explicit `id` / `valid_from` /
 * `ended_at` are present so `relay restore` can replay historic
 * supersession chains byte-identically (see §7.3 of AGENTIC_PROTOCOL.md:
 * point-in-time fact queries must return the historically-correct object).
 *
 * This adapter method is a dumb INSERT — it does NOT auto-supersede
 * prior facts. The auto-supersede convenience lives in
 * `RelayClient.assertFact`.
 */
export interface FactInsert {
  project_id: string;
  subject: string;
  relation: string;
  object: string;
  source_package_id: string | null;
  asserted_by_type: ActorType;
  asserted_by_id: string;
  /** ISO timestamp. If omitted, the adapter picks `now()`. */
  valid_from?: string;
  /** Explicit end timestamp (for restoring already-superseded facts). */
  ended_at?: string | null;
  /** Explicit id (for restore). If omitted, adapter generates one. */
  id?: string;
}

/**
 * Insert payload for `sessions`. `id` is client-assigned (the CLI/MCP pick
 * it via `SessionManager`), so it's required. `started_at` defaults to
 * `now()` if omitted.
 */
export interface SessionInsert {
  id: string;
  project_id: string;
  actor_type: ActorType;
  actor_id: string;
  agent_description?: string;
  packages_pulled?: string[];
  packages_deposited?: string[];
  /** ISO timestamp. If omitted, adapter picks `now()`. */
  started_at?: string;
  ended_at?: string | null;
}

/**
 * Insert payload for `projects`. `id` is optional — if omitted, the adapter
 * generates `proj_<uuid>`. Tests and restores pass an explicit id to make
 * operations idempotent.
 */
export interface ProjectInsert {
  id?: string;
  name: string;
  description?: string;
  owner_id?: string;
  settings?: Record<string, unknown>;
  archived_at?: string | null;
}

/**
 * Patch payload for `updateProject`. Every field is optional — pass only
 * what you're changing. `archived_at` is deliberately NOT here; use the
 * specialized `updateProjectArchived` so archive idempotency checks stay
 * on one code path (AlreadyInStateError, MetaProjectGuardError).
 */
export interface ProjectUpdate {
  name?: string;
  description?: string;
  settings?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Search (v0.2, capability-gated)
// ---------------------------------------------------------------------------

/**
 * A single search hit. `content` is the chunk that matched (e.g. a
 * decision bullet, the full `context_md`, or an `open_question`).
 * `similarity` is implementation-defined — pgvector returns
 * `1 - cosine_distance`, so 1.0 is identical.
 */
export interface SearchHit {
  package_id: string;
  content_type: 'context_md' | 'decision' | 'question' | 'handoff';
  content: string;
  similarity: number;
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

// ---------------------------------------------------------------------------
// Read-only subset (v0.1) — still the full contract a BackupService needs.
// ---------------------------------------------------------------------------

/**
 * The read-only subset. Sufficient to back up a project without mutating
 * state. A BackupService takes this narrower type so it type-checks even
 * against an append-only mirror.
 */
export interface ReadOnlyRelayStorage {
  readonly capabilities: StorageCapabilities;

  // Projects
  getProject(id: string): Promise<Project | null>;
  listProjects(opts?: { includeArchived?: boolean }): Promise<Project[]>;

  // Packages
  getPackage(id: string): Promise<PackageRow | null>;
  listPackages(q: {
    projectId: string;
    limit?: number;
    sinceIso?: string;
  }): Promise<PackageRow[]>;

  // Facts
  queryFacts(q: FactQuery & { projectId: string }): Promise<RelayFact[]>;

  // Sessions
  listSessions(q: { projectId: string }): Promise<Session[]>;

  /**
   * Fetch a binary blob (typically a `.relay.zip` bundle) by storage key.
   * Optional because not every backend has out-of-band blob storage —
   * a pure-Postgres implementation may embed everything in rows.
   *
   * Returns `null` if the blob does not exist. Returning `null` is a
   * NORMAL outcome for storage-missing cases; `BackupService` treats it
   * as a recoverable per-package error rather than a fatal failure.
   */
  getBlob?(key: string): Promise<Uint8Array | null>;
}

// ---------------------------------------------------------------------------
// Full contract (v0.2)
// ---------------------------------------------------------------------------

/**
 * The full storage contract. All reads from `ReadOnlyRelayStorage`, plus
 * every write path and (optionally) search. Adapters that can't do search
 * simply omit `hybridSearch` / `semanticSearch` and set the matching
 * capability flag to `false`; `RelayClient.search` throws
 * `StorageCapabilityError` rather than silently falling back.
 */
export interface RelayStorage extends ReadOnlyRelayStorage {
  // Projects (write)
  insertProject(p: ProjectInsert): Promise<Project>;
  updateProject(id: string, updates: ProjectUpdate): Promise<Project>;
  updateProjectArchived(id: string, archivedAt: string | null): Promise<Project>;

  // Packages (write)
  insertPackage(p: PackageInsert): Promise<void>;
  /**
   * Targeted LIKE lookup used by `autoDeposit` for git-fingerprint dedup
   * (see `client.ts:319`). Named rather than exposing generic LIKE so a
   * SQLite adapter can reimplement with a single `WHERE description LIKE ?`.
   */
  findPackageByDescriptionLike(q: {
    projectId: string;
    pattern: string;
    limit?: number;
  }): Promise<Pick<PackageRow, 'id'>[]>;

  // Facts (write) — inserts take full rows so restore can replay history
  insertFact(f: FactInsert): Promise<RelayFact>;
  endFact(id: string, endedAt: string): Promise<void>;
  endFactsMatching(q: {
    projectId: string;
    subject: string;
    relation: string;
    object?: string;
    endedAt: string;
  }): Promise<number>;

  // Sessions (write)
  insertSession(s: SessionInsert): Promise<Session>;
  endSession(id: string, endedAt: string): Promise<void>;

  // Embeddings
  insertEmbeddings(rows: EmbeddingRow[]): Promise<void>;

  /**
   * Canonical storage key for a package blob. The adapter owns its key
   * layout — `RelayClient` never hardcodes paths; it calls this to get
   * the key, passes the key to `putBlob`, and writes the same key to the
   * package row's `storage_path` for later round-tripping.
   *
   * Pure (no I/O). Required even for adapters without `putBlob`/`getBlob`:
   * the key is still written to `storage_path` for portability.
   */
  blobKeyFor(projectId: string, packageId: string): string;

  /**
   * Store a binary blob under an opaque key. Symmetric with `getBlob`.
   * Optional: a future flat-file adapter may be read-only. Callers check
   * `typeof storage.putBlob === 'function'` before calling.
   */
  putBlob?(key: string, body: Uint8Array, contentType?: string): Promise<void>;

  // Search (optional; capability-gated) ------------------------------------
  // Callers MUST branch on `capabilities.hybridSearch` / `semanticSearch`
  // before calling. The Supabase adapter sets both to true; SQLite sets
  // both to false and omits the methods. An adapter that implements one
  // but not the other is allowed — set the relevant capability only.
  hybridSearch?(q: HybridSearchQuery): Promise<SearchHit[]>;
  semanticSearch?(q: SemanticSearchQuery): Promise<SearchHit[]>;
}
