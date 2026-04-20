/**
 * SqliteStorage — RelayStorage adapter backed by `node:sqlite`.
 *
 * Second canonical implementation of the RelayStorage contract, landed
 * in Session C. Exercises the interface's portability: every method
 * round-trips through JSON/BLOB encoding without touching Postgres.
 *
 * Why `node:sqlite` (Node 22+) rather than `better-sqlite3`:
 *   - No native build toolchain required on Windows/Linux/macOS —
 *     critical for `relay sync` / `relay restore --to sqlite://` to
 *     "just work" on a fresh dev machine.
 *   - Sync API mirrors better-sqlite3 closely, so wrapping in async
 *     Promise-returning methods is the same pattern.
 *
 * Capabilities:
 *   - hybridSearch / semanticSearch / realtime all FALSE. Embeddings
 *     are stored (Float32 LE BLOB) for round-trip fidelity; similarity
 *     search needs `sqlite-vec` which is deferred to a future session.
 *     The FTS5 virtual table (`packages_fts`) exists and is kept in
 *     sync by triggers, so switching hybridSearch on becomes a single
 *     query once the capability lands.
 *
 * Blob layout: one file per blob on disk under `<dbDir>/blobs/<project>/
 * <package>.relay.zip`. `blobKeyFor` returns the same `<project>/
 * <package>.relay.zip` key the Supabase adapter uses — this is the
 * portable-backup layout, and both adapters translate to their own
 * internal path from there.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  RelayStorage,
  StorageCapabilities,
  PackageRow,
  EmbeddingRow,
  PackageInsert,
  FactInsert,
  SessionInsert,
  ProjectInsert,
  ProjectUpdate,
  SearchHit,
  HybridSearchQuery,
  SemanticSearchQuery,
} from '@relay/core';
import type {
  Project,
  Session,
  RelayFact,
  FactQuery,
  PackageStatus,
  PackageType,
  ReviewType,
  ActorType,
  Deliverable,
  RelayManifest,
} from '@relay/core';
import { applyMigrations, applyPragmas } from './migrations.js';

export interface SqliteStorageOptions {
  /** Absolute path to the `.db` file. Created if missing. */
  dbPath: string;
  /**
   * Override the blobs directory. Defaults to `<dbDir>/blobs/`. Use a
   * separate location if you want blobs on faster/cheaper storage than
   * the DB file itself.
   */
  blobsDir?: string;
}

type UnknownRow = Record<string, unknown>;
type SqliteParam = string | number | null | Uint8Array;

export class SqliteStorage implements RelayStorage {
  private db: DatabaseSync;
  private blobsDir: string;

  readonly capabilities: StorageCapabilities = Object.freeze({
    hybridSearch: false,
    semanticSearch: false,
    realtime: false,
  });

  constructor(opts: SqliteStorageOptions) {
    fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });
    this.db = new DatabaseSync(opts.dbPath);
    applyPragmas(this.db);
    applyMigrations(this.db);
    this.blobsDir = opts.blobsDir ?? path.join(path.dirname(opts.dbPath), 'blobs');
    fs.mkdirSync(this.blobsDir, { recursive: true });
  }

  /** Close the underlying DB. Call on process exit or when swapping adapters. */
  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------------------
  // Blob key layout
  // ---------------------------------------------------------------------------

  blobKeyFor(projectId: string, packageId: string): string {
    // Same portable key the Supabase adapter uses. Lets backup NDJSON
    // round-trip between the two adapters unchanged.
    return `${projectId}/${packageId}.relay.zip`;
  }

  private blobDiskPath(key: string): string {
    return path.join(this.blobsDir, key);
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  async getProject(id: string): Promise<Project | null> {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as UnknownRow | undefined;
    return row ? this.rowToProject(row) : null;
  }

  async listProjects(opts: { includeArchived?: boolean } = {}): Promise<Project[]> {
    const sql = opts.includeArchived
      ? 'SELECT * FROM projects ORDER BY created_at ASC'
      : 'SELECT * FROM projects WHERE archived_at IS NULL ORDER BY created_at ASC';
    const rows = this.db.prepare(sql).all() as UnknownRow[];
    return rows.map((r) => this.rowToProject(r));
  }

  async insertProject(p: ProjectInsert): Promise<Project> {
    const id = p.id ?? `proj_${randomUuidNoDashes()}`;
    const now = isoNow();
    const settings = JSON.stringify(p.settings ?? {});
    this.db
      .prepare(
        `INSERT INTO projects (id, name, description, owner_id, settings, created_at, updated_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        p.name,
        p.description ?? null,
        p.owner_id ?? 'jordan',
        settings,
        now,
        now,
        p.archived_at ?? null,
      );
    return (await this.getProject(id))!;
  }

  async updateProject(id: string, updates: ProjectUpdate): Promise<Project> {
    const sets: string[] = [];
    const params: SqliteParam[] = [];
    if (updates.name !== undefined) {
      sets.push('name = ?');
      params.push(updates.name);
    }
    if (updates.description !== undefined) {
      sets.push('description = ?');
      params.push(updates.description);
    }
    if (updates.settings !== undefined) {
      sets.push('settings = ?');
      params.push(JSON.stringify(updates.settings));
    }
    if (sets.length === 0) {
      const current = await this.getProject(id);
      if (!current) throw new Error(`Failed to update project: not found: ${id}`);
      return current;
    }
    sets.push(`updated_at = ?`);
    params.push(isoNow());
    params.push(id);
    this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    const after = await this.getProject(id);
    if (!after) throw new Error(`Failed to update project: not found: ${id}`);
    return after;
  }

  async updateProjectArchived(id: string, archivedAt: string | null): Promise<Project> {
    this.db
      .prepare('UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?')
      .run(archivedAt, isoNow(), id);
    const after = await this.getProject(id);
    if (!after) throw new Error(`Failed to update project: not found: ${id}`);
    return after;
  }

  // ---------------------------------------------------------------------------
  // Packages
  // ---------------------------------------------------------------------------

  async getPackage(id: string): Promise<PackageRow | null> {
    const row = this.db
      .prepare('SELECT * FROM context_packages WHERE id = ?')
      .get(id) as UnknownRow | undefined;
    return row ? this.rowToPackage(row) : null;
  }

  async listPackages(q: {
    projectId: string;
    limit?: number;
    sinceIso?: string;
  }): Promise<PackageRow[]> {
    const parts: string[] = ['SELECT * FROM context_packages WHERE project_id = ?'];
    const params: SqliteParam[] = [q.projectId];
    if (q.sinceIso) {
      parts.push('AND created_at >= ?');
      params.push(q.sinceIso);
    }
    parts.push('ORDER BY created_at DESC');
    if (q.limit) {
      parts.push('LIMIT ?');
      params.push(q.limit);
    }
    const rows = this.db.prepare(parts.join(' ')).all(...params) as UnknownRow[];
    return rows.map((r) => this.rowToPackage(r));
  }

  async insertPackage(p: PackageInsert): Promise<void> {
    const row = p.row;
    const verb = p.upsert ? 'INSERT OR REPLACE' : 'INSERT';
    const createdAt = (row as PackageRow & { created_at?: string }).created_at ?? isoNow();
    this.db
      .prepare(
        `${verb} INTO context_packages (
          id, project_id, title, description, status, package_type, review_type,
          parent_package_id, created_by_type, created_by_id, session_id,
          tags, open_questions, decisions_made, handoff_note, estimated_next_actor,
          deliverables, storage_path, context_md, significance, manifest,
          topic, artifact_type, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.project_id,
        row.title,
        row.description ?? null,
        row.status,
        row.package_type,
        row.review_type,
        row.parent_package_id,
        row.created_by_type,
        row.created_by_id,
        row.session_id,
        JSON.stringify(row.tags ?? []),
        JSON.stringify(row.open_questions ?? []),
        JSON.stringify(row.decisions_made ?? []),
        row.handoff_note ?? null,
        row.estimated_next_actor,
        JSON.stringify(row.deliverables ?? []),
        row.storage_path,
        row.context_md ?? null,
        row.significance ?? 0,
        JSON.stringify(row.manifest ?? {}),
        row.topic,
        row.artifact_type,
        createdAt,
        isoNow(),
      );
  }

  async findPackageByDescriptionLike(q: {
    projectId: string;
    pattern: string;
    limit?: number;
  }): Promise<Pick<PackageRow, 'id'>[]> {
    const parts: string[] = [
      'SELECT id FROM context_packages WHERE project_id = ? AND description LIKE ?',
    ];
    const params: SqliteParam[] = [q.projectId, q.pattern];
    if (q.limit) {
      parts.push('LIMIT ?');
      params.push(q.limit);
    }
    const rows = this.db.prepare(parts.join(' ')).all(...params) as { id: string }[];
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Facts
  // ---------------------------------------------------------------------------

  async queryFacts(q: FactQuery & { projectId: string }): Promise<RelayFact[]> {
    const parts: string[] = ['SELECT * FROM relay_facts WHERE project_id = ?'];
    const params: SqliteParam[] = [q.projectId];
    if (q.subject) {
      parts.push('AND subject = ?');
      params.push(q.subject);
    }
    if (q.relation) {
      parts.push('AND relation = ?');
      params.push(q.relation);
    }
    if (q.object) {
      parts.push('AND object = ?');
      params.push(q.object);
    }
    if (q.asOf) {
      // Time-travel: facts active at q.asOf.
      parts.push('AND valid_from <= ? AND (ended_at IS NULL OR ended_at > ?)');
      params.push(q.asOf, q.asOf);
    } else if (!q.includeEnded) {
      parts.push('AND ended_at IS NULL');
    }
    parts.push('ORDER BY valid_from DESC');
    if (q.limit) {
      parts.push('LIMIT ?');
      params.push(q.limit);
    }
    const rows = this.db.prepare(parts.join(' ')).all(...params) as UnknownRow[];
    return rows.map((r) => this.rowToFact(r));
  }

  async insertFact(f: FactInsert): Promise<RelayFact> {
    const id = f.id ?? `fact_${randomUuidNoDashes()}`;
    const validFrom = f.valid_from ?? isoNow();
    const createdAt = isoNow();
    this.db
      .prepare(
        `INSERT INTO relay_facts (
          id, project_id, subject, relation, object, source_package_id,
          asserted_by_type, asserted_by_id, valid_from, ended_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        f.project_id,
        f.subject,
        f.relation,
        f.object,
        f.source_package_id,
        f.asserted_by_type,
        f.asserted_by_id,
        validFrom,
        f.ended_at ?? null,
        createdAt,
      );
    const row = this.db
      .prepare('SELECT * FROM relay_facts WHERE id = ?')
      .get(id) as UnknownRow;
    return this.rowToFact(row);
  }

  async endFact(id: string, endedAt: string): Promise<void> {
    this.db.prepare('UPDATE relay_facts SET ended_at = ? WHERE id = ?').run(endedAt, id);
  }

  async endFactsMatching(q: {
    projectId: string;
    subject: string;
    relation: string;
    object?: string;
    endedAt: string;
  }): Promise<number> {
    const parts: string[] = [
      'UPDATE relay_facts SET ended_at = ? WHERE project_id = ? AND subject = ? AND relation = ? AND ended_at IS NULL',
    ];
    const params: SqliteParam[] = [q.endedAt, q.projectId, q.subject, q.relation];
    if (q.object !== undefined) {
      parts.push('AND object = ?');
      params.push(q.object);
    }
    const info = this.db.prepare(parts.join(' ')).run(...params);
    return Number(info.changes ?? 0);
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  async listSessions(q: { projectId: string }): Promise<Session[]> {
    const rows = this.db
      .prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC')
      .all(q.projectId) as UnknownRow[];
    return rows.map((r) => this.rowToSession(r));
  }

  async insertSession(s: SessionInsert): Promise<Session> {
    const startedAt = s.started_at ?? isoNow();
    this.db
      .prepare(
        `INSERT INTO sessions (
          id, project_id, actor_type, actor_id, agent_description,
          packages_pulled, packages_deposited, started_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.id,
        s.project_id,
        s.actor_type,
        s.actor_id,
        s.agent_description ?? null,
        JSON.stringify(s.packages_pulled ?? []),
        JSON.stringify(s.packages_deposited ?? []),
        startedAt,
        s.ended_at ?? null,
      );
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(s.id) as UnknownRow;
    return this.rowToSession(row);
  }

  async endSession(id: string, endedAt: string): Promise<void> {
    this.db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(endedAt, id);
  }

  // ---------------------------------------------------------------------------
  // Embeddings
  // ---------------------------------------------------------------------------

  async insertEmbeddings(rows: EmbeddingRow[]): Promise<void> {
    if (rows.length === 0) return;
    const insert = this.db.prepare(
      `INSERT INTO package_embeddings (id, package_id, content_type, content, embedding, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const r of rows) {
      const id = `emb_${randomUuidNoDashes()}`;
      insert.run(
        id,
        r.package_id,
        r.content_type,
        r.content,
        packFloat32(r.embedding),
        isoNow(),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Blobs
  // ---------------------------------------------------------------------------

  async getBlob(key: string): Promise<Uint8Array | null> {
    const diskPath = this.blobDiskPath(key);
    if (!fs.existsSync(diskPath)) return null;
    const body = await fs.promises.readFile(diskPath);
    return new Uint8Array(body);
  }

  async putBlob(key: string, body: Uint8Array, _contentType?: string): Promise<void> {
    const diskPath = this.blobDiskPath(key);
    await fs.promises.mkdir(path.dirname(diskPath), { recursive: true });
    await fs.promises.writeFile(diskPath, body);
  }

  // ---------------------------------------------------------------------------
  // Search — not supported; kept as explicit stubs so callers hitting
  // them get a clear `StorageCapabilityError` instead of silent
  // undefined-method-call behavior. Capability flags are already false.
  // ---------------------------------------------------------------------------

  async hybridSearch(_q: HybridSearchQuery): Promise<SearchHit[]> {
    throw new Error('SqliteStorage does not support hybridSearch (capability=false).');
  }

  async semanticSearch(_q: SemanticSearchQuery): Promise<SearchHit[]> {
    throw new Error('SqliteStorage does not support semanticSearch (capability=false).');
  }

  // ---------------------------------------------------------------------------
  // Row -> domain mappers. Kept private because the SQL row shape is
  // implementation-detail.
  // ---------------------------------------------------------------------------

  private rowToProject(r: UnknownRow): Project {
    return {
      id: String(r.id),
      name: String(r.name),
      description: String(r.description ?? ''),
      created_at: String(r.created_at),
      owner_id: String(r.owner_id),
      settings: safeJsonObject(r.settings as string | null),
      archived_at: (r.archived_at as string | null) ?? null,
    };
  }

  private rowToPackage(r: UnknownRow): PackageRow {
    return {
      id: String(r.id),
      project_id: String(r.project_id),
      title: String(r.title),
      description: String(r.description ?? ''),
      status: String(r.status) as PackageStatus,
      package_type: String(r.package_type) as PackageType,
      review_type: String(r.review_type) as ReviewType,
      parent_package_id: (r.parent_package_id as string | null) ?? null,
      created_by_type: String(r.created_by_type) as ActorType,
      created_by_id: String(r.created_by_id),
      session_id: (r.session_id as string | null) ?? null,
      tags: safeJsonArray<string>(r.tags as string | null),
      open_questions: safeJsonArray<string>(r.open_questions as string | null),
      decisions_made: safeJsonArray<string>(r.decisions_made as string | null),
      handoff_note: String(r.handoff_note ?? ''),
      estimated_next_actor: (r.estimated_next_actor as ActorType | null) ?? null,
      deliverables: safeJsonArray<Deliverable>(r.deliverables as string | null),
      storage_path: (r.storage_path as string | null) ?? null,
      context_md: String(r.context_md ?? ''),
      significance: Number(r.significance ?? 0),
      manifest: safeJsonObject(r.manifest as string | null) as unknown as RelayManifest,
      topic: (r.topic as string | null) ?? null,
      artifact_type: (r.artifact_type as string | null) ?? null,
      created_at: String(r.created_at),
    };
  }

  private rowToFact(r: UnknownRow): RelayFact {
    return {
      id: String(r.id),
      project_id: String(r.project_id),
      subject: String(r.subject),
      relation: String(r.relation),
      object: String(r.object),
      source_package_id: (r.source_package_id as string | null) ?? null,
      asserted_by_type: String(r.asserted_by_type) as ActorType,
      asserted_by_id: String(r.asserted_by_id),
      valid_from: String(r.valid_from),
      ended_at: (r.ended_at as string | null) ?? null,
      created_at: String(r.created_at),
    };
  }

  private rowToSession(r: UnknownRow): Session {
    return {
      id: String(r.id),
      project_id: String(r.project_id),
      actor: {
        type: String(r.actor_type) as ActorType,
        id: String(r.actor_id),
      },
      agent_description: (r.agent_description as string | undefined) ?? undefined,
      started_at: String(r.started_at),
      ended_at: (r.ended_at as string | null) ?? null,
      packages_pulled: safeJsonArray<string>(r.packages_pulled as string | null),
      packages_deposited: safeJsonArray<string>(r.packages_deposited as string | null),
    };
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Random 32-char hex id, matching Postgres' `replace(gen_random_uuid()::text,'-','')`. */
function randomUuidNoDashes(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '');
}

/** ISO-8601 millisecond UTC, matching Postgres `timestamptz` serialization. */
function isoNow(): string {
  return new Date().toISOString();
}

function safeJsonArray<T>(s: string | null | undefined): T[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function safeJsonObject(s: string | null | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Pack number[] -> Float32 LE Buffer. 4 bytes per element, LE for portability. */
function packFloat32(embedding: number[]): Buffer {
  const buf = Buffer.alloc(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) {
    buf.writeFloatLE(embedding[i], i * 4);
  }
  return buf;
}
