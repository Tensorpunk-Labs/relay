/**
 * SupabaseStorage — the canonical `RelayStorage` adapter.
 *
 * Owns one `SupabaseClient` and routes every DB access through it. No
 * `@supabase/supabase-js` calls are made from outside this file — that
 * separation is what lets `RelayClient` be storage-agnostic and lets
 * other adapters (SQLite, in-memory) implement the same contract.
 *
 * Blob layout is adapter-internal: every blob lives at
 * `${bucket}/${projectId}/${packageId}.relay.zip`. Callers never construct
 * paths — they hand the adapter a `(projectId, packageId)` pair (via the
 * canonical key returned by `blobPathFor`) and the adapter does the rest.
 *
 * v0.2 migration: methods are initially stubs that throw
 * `NotImplementedError`. Each stub is replaced with its real
 * implementation as `RelayClient` is ported method-by-method. When the
 * final stub is replaced, the `private supabase: SupabaseClient` field on
 * `RelayClient` is deleted and this file becomes the ONLY place that
 * imports `@supabase/supabase-js` inside `@relay/core`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
} from './types.js';
import type {
  Project,
  Session,
  RelayFact,
  FactQuery,
} from '../types.js';

/**
 * Thrown by any adapter method that has not yet been ported. Exists only
 * during the v0.2 migration; once Session A is done, no path in normal
 * usage should hit this.
 */
export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`SupabaseStorage.${method} not yet implemented`);
    this.name = 'NotImplementedError';
  }
}

export interface SupabaseStorageOptions {
  url: string;
  key: string;
  /** Storage bucket for blobs. Default: 'context-packages'. */
  bucket?: string;
}

export class SupabaseStorage implements RelayStorage {
  private supabase: SupabaseClient;
  private bucket: string;

  readonly capabilities: StorageCapabilities = Object.freeze({
    hybridSearch: true,
    semanticSearch: true,
    realtime: true,
  });

  constructor(opts: SupabaseStorageOptions) {
    this.supabase = createClient(opts.url, opts.key);
    this.bucket = opts.bucket ?? 'context-packages';
  }

  /**
   * Canonical blob key for a `(projectId, packageId)` pair. Returns the
   * key a caller passes to `putBlob` / `getBlob` and writes to the row's
   * `storage_path`. Keeping the layout decision inside the adapter is
   * what lets a SQLite adapter (or any future adapter) use a completely
   * different keying scheme without `RelayClient` noticing.
   */
  blobKeyFor(projectId: string, packageId: string): string {
    return `${projectId}/${packageId}.relay.zip`;
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  async getProject(id: string): Promise<Project | null> {
    const { data, error } = await this.supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Failed to get project: ${error.message}`);
    return (data as Project) ?? null;
  }

  async listProjects(
    opts: { includeArchived?: boolean } = {},
  ): Promise<Project[]> {
    let query = this.supabase.from('projects').select('*');
    if (!opts.includeArchived) {
      query = query.is('archived_at', null);
    }
    const { data, error } = await query;
    if (error) throw new Error(`Failed to list projects: ${error.message}`);
    return (data as Project[]) ?? [];
  }

  async insertProject(p: ProjectInsert): Promise<Project> {
    // Only send defined columns — the DB has defaults for id, description,
    // owner_id, settings, archived_at. Sending `undefined` via Supabase-js
    // would be translated to `null` and clobber the defaults.
    const row: Record<string, unknown> = { name: p.name };
    if (p.id !== undefined) row.id = p.id;
    if (p.description !== undefined) row.description = p.description;
    if (p.owner_id !== undefined) row.owner_id = p.owner_id;
    if (p.settings !== undefined) row.settings = p.settings;
    if (p.archived_at !== undefined) row.archived_at = p.archived_at;

    const { data, error } = await this.supabase
      .from('projects')
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(`Failed to create project: ${error.message}`);
    return data as Project;
  }

  async updateProject(id: string, updates: ProjectUpdate): Promise<Project> {
    // Forward only defined fields so the DB's existing values are preserved
    // on columns the caller didn't mention. An empty updates object is a
    // no-op that still returns the current row (useful for callers that
    // want the current state after a speculative change).
    const patch: Record<string, unknown> = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.settings !== undefined) patch.settings = updates.settings;

    if (Object.keys(patch).length === 0) {
      const current = await this.getProject(id);
      if (!current) throw new Error(`Failed to update project: not found: ${id}`);
      return current;
    }

    const { data, error } = await this.supabase
      .from('projects')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`Failed to update project: ${error.message}`);
    return data as Project;
  }

  async updateProjectArchived(
    id: string,
    archivedAt: string | null,
  ): Promise<Project> {
    const { data, error } = await this.supabase
      .from('projects')
      .update({ archived_at: archivedAt })
      .eq('id', id)
      .select()
      .single();
    const verb = archivedAt === null ? 'restore' : 'archive';
    if (error) throw new Error(`Failed to ${verb} project: ${error.message}`);
    return data as Project;
  }

  // -------------------------------------------------------------------------
  // Packages
  // -------------------------------------------------------------------------

  async getPackage(id: string): Promise<PackageRow | null> {
    const { data, error } = await this.supabase
      .from('context_packages')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Failed to get package: ${error.message}`);
    return (data as PackageRow | null) ?? null;
  }

  async listPackages(q: {
    projectId: string;
    limit?: number;
    sinceIso?: string;
  }): Promise<PackageRow[]> {
    let query = this.supabase
      .from('context_packages')
      .select('*')
      .eq('project_id', q.projectId)
      .order('created_at', { ascending: false });
    if (q.sinceIso) query = query.gte('created_at', q.sinceIso);
    if (q.limit) query = query.limit(q.limit);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list packages: ${error.message}`);
    return (data as PackageRow[]) ?? [];
  }

  async insertPackage(p: PackageInsert): Promise<void> {
    // Upsert flips to ON CONFLICT (id) DO UPDATE for restore/sync; default
    // is plain INSERT and the DB's PK constraint surfaces the duplicate.
    const builder = this.supabase.from('context_packages');
    const { error } = p.upsert
      ? await builder.upsert(p.row, { onConflict: 'id' })
      : await builder.insert(p.row);
    if (error) throw new Error(`Failed to insert package: ${error.message}`);
  }

  async findPackageByDescriptionLike(q: {
    projectId: string;
    pattern: string;
    limit?: number;
  }): Promise<Pick<PackageRow, 'id'>[]> {
    let query = this.supabase
      .from('context_packages')
      .select('id')
      .eq('project_id', q.projectId)
      .like('description', q.pattern);
    if (q.limit) query = query.limit(q.limit);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to find package: ${error.message}`);
    return (data as Pick<PackageRow, 'id'>[]) ?? [];
  }

  // -------------------------------------------------------------------------
  // Facts
  // -------------------------------------------------------------------------

  async queryFacts(
    q: FactQuery & { projectId: string },
  ): Promise<RelayFact[]> {
    let query = this.supabase
      .from('relay_facts')
      .select('*')
      .eq('project_id', q.projectId)
      .order('valid_from', { ascending: false });

    if (q.subject) query = query.eq('subject', q.subject);
    if (q.relation) query = query.eq('relation', q.relation);
    if (q.object) query = query.eq('object', q.object);

    if (q.asOf) {
      // Time-travel: facts that were active at q.asOf.
      query = query.lte('valid_from', q.asOf);
      query = query.or(`ended_at.is.null,ended_at.gt.${q.asOf}`);
    } else if (!q.includeEnded) {
      query = query.is('ended_at', null);
    }

    if (q.limit) query = query.limit(q.limit);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to query facts: ${error.message}`);
    return (data ?? []) as RelayFact[];
  }

  async insertFact(f: FactInsert): Promise<RelayFact> {
    // Send only defined columns so the DB's defaults for id / valid_from /
    // ended_at survive when the caller is the "happy path" assertFact
    // (which leaves those fields undefined so the server fills them).
    // Restore passes all three explicitly to replay historic timestamps.
    const row: Record<string, unknown> = {
      project_id: f.project_id,
      subject: f.subject,
      relation: f.relation,
      object: f.object,
      source_package_id: f.source_package_id,
      asserted_by_type: f.asserted_by_type,
      asserted_by_id: f.asserted_by_id,
    };
    if (f.id !== undefined) row.id = f.id;
    if (f.valid_from !== undefined) row.valid_from = f.valid_from;
    if (f.ended_at !== undefined) row.ended_at = f.ended_at;

    const { data, error } = await this.supabase
      .from('relay_facts')
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(`Failed to insert fact: ${error.message}`);
    return data as RelayFact;
  }

  async endFact(id: string, endedAt: string): Promise<void> {
    const { error } = await this.supabase
      .from('relay_facts')
      .update({ ended_at: endedAt })
      .eq('id', id);
    if (error) throw new Error(`Failed to end fact: ${error.message}`);
  }

  async endFactsMatching(q: {
    projectId: string;
    subject: string;
    relation: string;
    object?: string;
    endedAt: string;
  }): Promise<number> {
    let query = this.supabase
      .from('relay_facts')
      .update({ ended_at: q.endedAt })
      .eq('project_id', q.projectId)
      .eq('subject', q.subject)
      .eq('relation', q.relation)
      .is('ended_at', null);
    if (q.object !== undefined) query = query.eq('object', q.object);

    const { data, error } = await query.select('id');
    if (error) throw new Error(`Failed to invalidate fact: ${error.message}`);
    return data?.length ?? 0;
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  async listSessions(q: { projectId: string }): Promise<Session[]> {
    const { data, error } = await this.supabase
      .from('sessions')
      .select('*')
      .eq('project_id', q.projectId)
      .order('started_at', { ascending: false });
    if (error) throw new Error(`Failed to list sessions: ${error.message}`);
    // DB has flat actor_type / actor_id columns; Session has nested
    // actor: {type, id}. Map here so backup + restore + all other
    // callers see the canonical shape.
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => this.rowToSession(r));
  }

  private rowToSession(r: Record<string, unknown>): Session {
    return {
      id: String(r.id),
      project_id: String(r.project_id),
      actor: {
        type: String(r.actor_type) as Session['actor']['type'],
        id: String(r.actor_id),
      },
      agent_description: (r.agent_description as string | undefined) ?? undefined,
      started_at: String(r.started_at),
      ended_at: (r.ended_at as string | null) ?? null,
      packages_pulled: (r.packages_pulled as string[]) ?? [],
      packages_deposited: (r.packages_deposited as string[]) ?? [],
    };
  }

  async insertSession(s: SessionInsert): Promise<Session> {
    const row: Record<string, unknown> = {
      id: s.id,
      project_id: s.project_id,
      actor_type: s.actor_type,
      actor_id: s.actor_id,
    };
    if (s.agent_description !== undefined) row.agent_description = s.agent_description;
    if (s.packages_pulled !== undefined) row.packages_pulled = s.packages_pulled;
    if (s.packages_deposited !== undefined) row.packages_deposited = s.packages_deposited;
    if (s.started_at !== undefined) row.started_at = s.started_at;
    if (s.ended_at !== undefined) row.ended_at = s.ended_at;

    const { data, error } = await this.supabase
      .from('sessions')
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(`Failed to start session: ${error.message}`);
    return this.rowToSession(data as Record<string, unknown>);
  }

  async endSession(id: string, endedAt: string): Promise<void> {
    const { error } = await this.supabase
      .from('sessions')
      .update({ ended_at: endedAt })
      .eq('id', id);
    if (error) throw new Error(`Failed to end session: ${error.message}`);
  }

  // -------------------------------------------------------------------------
  // Embeddings
  // -------------------------------------------------------------------------

  async insertEmbeddings(rows: EmbeddingRow[]): Promise<void> {
    if (rows.length === 0) return;
    // pgvector accepts the JSON-stringified vector form. Converting here
    // keeps the interface contract (`embedding: number[]`) portable — a
    // SQLite adapter can pack this to a Float32 BLOB on its side.
    const payload = rows.map((r) => ({
      package_id: r.package_id,
      content_type: r.content_type,
      content: r.content,
      embedding: JSON.stringify(r.embedding),
    }));
    const { error } = await this.supabase.from('package_embeddings').insert(payload);
    if (error) throw new Error(`Embedding storage failed: ${error.message}`);
  }

  // -------------------------------------------------------------------------
  // Blobs
  // -------------------------------------------------------------------------

  async getBlob(key: string): Promise<Uint8Array | null> {
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .download(key);
    if (error) {
      const msg = error.message || '';
      if (/not found|does not exist|NoSuchKey/i.test(msg)) return null;
      throw new Error(`Failed to download blob: ${msg}`);
    }
    if (!data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async putBlob(
    key: string,
    body: Uint8Array,
    contentType?: string,
  ): Promise<void> {
    // Preserve v0.1 upload semantics: non-upsert. Callers that want to
    // overwrite (e.g. `relay restore --overwrite`) will compose getBlob +
    // delete + putBlob rather than flag-flipping here.
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(key, body, {
        contentType: contentType ?? 'application/zip',
        upsert: false,
      });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  async hybridSearch(q: HybridSearchQuery): Promise<SearchHit[]> {
    const { data, error } = await this.supabase.rpc('hybrid_search', {
      query_text: q.queryText,
      query_embedding: JSON.stringify(q.queryEmbedding),
      project_filter: q.projectId,
      match_count: q.matchCount,
      topic_filter: q.topic ?? null,
      type_filter: q.artifactType ?? null,
    });
    if (error) {
      // Preserve the RPC-name signal so RelayClient.search can decide
      // whether the fallback to `search_context` is appropriate.
      const wrapped = new Error(error.message);
      (wrapped as Error & { rpc?: string }).rpc = 'hybrid_search';
      throw wrapped;
    }
    return (data as SearchHit[]) ?? [];
  }

  async semanticSearch(q: SemanticSearchQuery): Promise<SearchHit[]> {
    const { data, error } = await this.supabase.rpc('search_context', {
      query_embedding: JSON.stringify(q.queryEmbedding),
      project_filter: q.projectId,
      match_count: q.matchCount,
    });
    if (error) throw new Error(`Semantic search failed: ${error.message}`);
    return (data as SearchHit[]) ?? [];
  }
}
