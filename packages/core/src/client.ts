import type {
  Project,
  Session,
  RelayManifest,
  SearchResult,
  SearchOptions,
  DepositOptions,
  AutoDepositOptions,
  OrientationBundle,
  OrientationOptions,
  RelayFact,
  FactQuery,
  AssertFactOptions,
  InvalidateFactOptions,
  GradientDay,
  RenderTier,
  OrientPackage,
} from './types.js';
import { AlreadyInStateError, MetaProjectGuardError, StorageCapabilityError } from './types.js';
import { buildManifest, buildContextPackage } from './context-package.js';
import { generatePackageId, generateSessionId } from './manifest.js';
import { generateCallsign } from './callsign.js';
import { getGitInfo, getGitDiff, getGitFingerprint } from './git-utils.js';
import { generateContextMd } from './context-md.js';
import { SessionManager } from './session-manager.js';
import { generateAndStoreEmbeddings, generateQueryEmbedding } from './embeddings.js';
import { computeSignificance } from './significance.js';
import { inferTopic, inferArtifactType } from './inference.js';
import { rerank } from './reranker.js';
import type { PackageRow, StorageCapabilities, RelayStorage } from './storage/types.js';
import { SupabaseStorage } from './storage/supabase.js';
import { openStorage } from './storage/factory.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface RelayConfig {
  core_url: string;
  api_key: string;
  default_project?: string;
  actor_id: string;
  actor_type: 'agent' | 'human';
  openai_api_key?: string;
  project_paths?: Record<string, string[]>;
  /**
   * Storage URL. If present, overrides the default SupabaseStorage.
   * Supported schemes:
   *   - `sqlite:///<path>` — local SQLite file via @relay/storage-sqlite.
   *   - `supabase://<host>#<key>` — explicit Supabase override.
   *   - unset / `config:` — default SupabaseStorage using core_url + api_key.
   */
  storage?: string;
}

/**
 * Resolve project ID from the current working directory by matching
 * against project_paths in config. Returns empty string if no match found.
 */
function resolveProjectFromCwd(config: RelayConfig): string {
  // Check local .relay/config.json first (explicit project override)
  // But only trust it if the project_id is in our known project_paths
  const localConfigPath = path.join(process.cwd(), '.relay', 'config.json');
  if (fs.existsSync(localConfigPath)) {
    try {
      const local = JSON.parse(fs.readFileSync(localConfigPath, 'utf-8'));
      if (local.project_id) {
        const knownIds = config.project_paths ? Object.keys(config.project_paths) : [];
        if (knownIds.includes(local.project_id) || knownIds.length === 0) {
          return local.project_id;
        }
        console.error(`[Relay] Local .relay/config.json has unknown project_id "${local.project_id}" — ignoring. Delete it or update project_paths.`);
      }
    } catch { /* ignore */ }
  }

  // Match CWD against project_paths
  if (config.project_paths) {
    const cwd = process.cwd().replace(/\\/g, '/').toLowerCase();
    for (const [projectId, paths] of Object.entries(config.project_paths)) {
      for (const p of paths) {
        const normalized = p.replace(/\\/g, '/').toLowerCase();
        if (cwd.startsWith(normalized)) {
          return projectId;
        }
      }
    }
  }

  // No match — return empty (caller decides what to do)
  return '';
}

export class RelayClient {
  /**
   * Storage adapter. All DB and blob access flows through here — `@relay/
   * core` no longer imports `@supabase/supabase-js` outside
   * `storage/supabase.ts`. Swapping this field is the one change a future
   * v0.2 `SqliteStorage` or `InMemoryStorage` will require.
   */
  private storage: RelayStorage;
  private config: RelayConfig;

  /**
   * Construct a RelayClient.
   *
   * If `storage` is passed, it's used directly and the config is just
   * used for non-storage concerns (actor id, default_project, etc).
   * Otherwise the constructor defaults to a SupabaseStorage — matches
   * the v0.1 behavior for callers that don't yet plumb a storage in.
   *
   * Callers wanting URL-based storage (`sqlite://`, `supabase://`)
   * should use `RelayClient.fromConfig()` which parses `config.storage`
   * via `openStorage()`.
   */
  constructor(config: RelayConfig, storage?: RelayStorage) {
    this.config = config;
    this.storage =
      storage ??
      new SupabaseStorage({
        url: config.core_url,
        key: config.api_key,
      });
  }

  /**
   * Public handle on the underlying storage adapter. Exposed so services
   * that take a `RelayStorage` directly (e.g. `BackupService`,
   * `RestoreService`) can be constructed without indirecting through
   * `RelayClient`'s public methods.
   */
  getStorage(): RelayStorage {
    return this.storage;
  }

  /**
   * Create a RelayClient from ~/.relay/config.json + local .relay/config.json
   */
  static async fromConfig(): Promise<RelayClient> {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const globalConfigPath = path.join(homeDir, '.relay', 'config.json');
    const localConfigPath = path.join(process.cwd(), '.relay', 'config.json');

    let config: RelayConfig = {
      core_url: '',
      api_key: '',
      actor_id: 'jordan',
      actor_type: 'human',
    };

    if (fs.existsSync(globalConfigPath)) {
      const global = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
      config = { ...config, ...global };
    }

    if (fs.existsSync(localConfigPath)) {
      const local = JSON.parse(fs.readFileSync(localConfigPath, 'utf-8'));
      if (local.project_id) {
        config.default_project = local.project_id;
      }
    }

    // If the config names a storage URL other than "config:", resolve
    // it via the factory (SQLite / Supabase / future). Otherwise the
    // constructor default of SupabaseStorage kicks in.
    let storage: RelayStorage | undefined;
    if (config.storage && config.storage !== 'config:') {
      storage = await openStorage(config.storage, {
        core_url: config.core_url,
        api_key: config.api_key,
      });
    }
    return new RelayClient(config, storage);
  }

  /**
   * Create a RelayClient from environment variables.
   */
  static fromEnv(): RelayClient {
    // Prefer service_role keys for write paths (CLI, MCP). Fall back to the
    // anon key for read-only consumers. RLS (migration 007) grants anon SELECT
    // only; inserts require the service_role key.
    const apiKey =
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.RELAY_API_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      '';
    return new RelayClient({
      core_url: process.env.SUPABASE_URL || process.env.RELAY_CORE_URL || '',
      api_key: apiKey,
      default_project: process.env.RELAY_DEFAULT_PROJECT,
      actor_id: process.env.RELAY_ACTOR_ID || 'agent',
      actor_type: (process.env.RELAY_ACTOR_TYPE as 'agent' | 'human') || 'agent',
      openai_api_key: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Resolve the current project ID: session > local config > CWD match
   */
  private resolveProject(sessionProjectId?: string): string {
    return sessionProjectId || resolveProjectFromCwd(this.config);
  }

  /**
   * Public: resolve the "target project" for a deposit given the current
   * SessionManager + CWD + config. Used by CLI/MCP callers that need to
   * run archive-guard checks before calling deposit/autoDeposit. Returns
   * empty string if no project can be resolved.
   */
  resolveDepositTargetProject(explicitProjectId?: string): string {
    if (explicitProjectId) return explicitProjectId;
    const sm = new SessionManager();
    const session = sm.getSession();
    return this.resolveProject(session?.project_id);
  }

  /**
   * Best-effort blob upload. Returns the key on success, `null` on any
   * failure (including an adapter without `putBlob`). Callers set
   * `storage_path = returned value` so `BackupService` can distinguish
   * "uploaded" from "missing" without a second round trip.
   */
  private async tryPutBlob(key: string, body: Uint8Array): Promise<string | null> {
    if (typeof this.storage.putBlob !== 'function') return null;
    try {
      await this.storage.putBlob(key, body, 'application/zip');
      return key;
    } catch (e) {
      console.error(`Storage upload skipped: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Assemble the full row payload for a `context_packages` INSERT. Shared
   * between `deposit` and `autoDeposit` — both had a copy of the same
   * 22-field mapping; the helper keeps them in sync.
   */
  private buildPackageInsertRow(args: {
    manifest: RelayManifest;
    contextMd: string;
    storagePath: string | null;
    significance: number;
    topic: string | null;
    artifactType: string | null;
  }): Omit<PackageRow, 'created_at'> {
    const m = args.manifest;
    return {
      id: m.package_id,
      project_id: m.project_id,
      title: m.title,
      description: m.description,
      status: m.status,
      package_type: m.package_type,
      review_type: m.review_type,
      parent_package_id: m.parent_package_id,
      created_by_type: m.created_by.type,
      created_by_id: m.created_by.id,
      session_id: m.created_by.session_id || null,
      tags: m.tags,
      open_questions: m.open_questions,
      decisions_made: m.decisions_made,
      handoff_note: m.handoff_note,
      estimated_next_actor: m.estimated_next_actor,
      deliverables: m.deliverables,
      storage_path: args.storagePath,
      context_md: args.contextMd,
      significance: args.significance,
      manifest: m,
      topic: args.topic,
      artifact_type: args.artifactType,
    };
  }

  private skippedManifest(id: string, title: string): RelayManifest {
    return {
      relay_version: '0.1', package_id: id, created_at: new Date().toISOString(),
      created_by: { type: 'agent', id: 'skip', session_id: '' },
      title, description: '', status: 'complete',
      package_type: 'standard', review_type: 'none', parent_package_id: null,
      child_package_ids: [], dependencies: [], tags: [], project_id: '',
      deliverables: [], open_questions: [], decisions_made: [],
      handoff_note: '', estimated_next_actor: null, context_diff_ref: '.cdiff',
    };
  }

  // --- Sessions ---

  async startSession(projectId?: string, agentDescription?: string): Promise<Session> {
    const id = generateSessionId();
    const pid = projectId || this.config.default_project;
    if (!pid) throw new Error('No project ID provided and no default set');

    return this.storage.insertSession({
      id,
      project_id: pid,
      actor_type: this.config.actor_type,
      actor_id: this.config.actor_id,
      agent_description: agentDescription,
      callsign: generateCallsign(),
    });
  }

  async endSession(sessionId: string): Promise<void> {
    await this.storage.endSession(sessionId, new Date().toISOString());
  }

  // --- Packages ---

  async deposit(opts: DepositOptions): Promise<RelayManifest> {
    const sm = new SessionManager();
    const session = sm.getSession();

    const packageId = generatePackageId();
    const manifest = buildManifest({
      packageId,
      projectId: opts.projectId || this.resolveProject(session?.project_id),
      title: opts.title,
      description: opts.description,
      createdBy: {
        type: session?.actor_type || this.config.actor_type,
        id: session?.actor_id || this.config.actor_id,
        session_id: session?.session_id || '',
      },
      status: opts.status,
      reviewType: opts.reviewType,
      parentPackageId: opts.parentId || session?.parent_package_id || undefined,
      openQuestions: opts.openQuestions,
      decisionsMade: opts.decisions,
      handoffNote: opts.handoffNote,
    });

    // Infer topic/artifact_type if not provided
    const topic = opts.topic ?? inferTopic(manifest) ?? null;
    const artifactType = opts.artifactType ?? inferArtifactType(manifest) ?? null;

    // Build zip
    const zipBuffer = await buildContextPackage(manifest, opts.deliverablePaths || []);

    // Upload to storage (best-effort — insert continues even if blob fails;
    // storage_path is set to null so BackupService marks it as blob_missing).
    const storagePath = this.storage.blobKeyFor(manifest.project_id, manifest.package_id);
    const uploadedPath = await this.tryPutBlob(storagePath, zipBuffer);

    // Generate CONTEXT.md text for DB storage
    const contextMd = generateContextMd(manifest);

    await this.storage.insertPackage({
      row: this.buildPackageInsertRow({
        manifest,
        contextMd,
        storagePath: uploadedPath,
        significance: computeSignificance(manifest, false),
        topic,
        artifactType,
      }),
    });

    // Generate embeddings (local — no API key needed)
    try {
      await generateAndStoreEmbeddings(this.storage, manifest, contextMd);
    } catch (e) {
      console.error(`Embedding generation skipped: ${(e as Error).message}`);
    }

    // Track in session
    sm.trackDeposited(manifest.package_id);

    return manifest;
  }

  async autoDeposit(opts: AutoDepositOptions): Promise<RelayManifest> {
    const sm = new SessionManager();
    const session = sm.getSession();

    // Check project mapping FIRST — before touching git
    const resolvedProject = this.resolveProject(session?.project_id);
    if (!resolvedProject) {
      const cwd = process.cwd().replace(/\\/g, '/');
      console.error(`[Relay] No project mapped for ${cwd}. Skipping auto-deposit.`);
      console.error(`[Relay] To register: relay projects create "Name" --description "..." then add path to ~/.relay/config.json project_paths`);
      return this.skippedManifest('skipped_no_project', '(skipped — no project mapping)');
    }

    const gitInfo = getGitInfo();

    // Skip empty/zero-signal deposits
    if (!gitInfo.branch && !gitInfo.has_uncommitted && !gitInfo.last_commit_message && !session) {
      return this.skippedManifest('skipped_empty', '(skipped — no signal)');
    }

    // Dedup: skip if the same git state was already deposited recently
    const fingerprint = getGitFingerprint();
    const existing = await this.storage.findPackageByDescriptionLike({
      projectId: resolvedProject,
      pattern: `%fingerprint:${fingerprint}%`,
      limit: 1,
    });

    if (existing.length > 0) {
      // Already deposited this exact state — return a dummy manifest
      return {
        relay_version: '0.1',
        package_id: existing[0].id,
        created_at: new Date().toISOString(),
        created_by: { type: 'agent', id: 'dedup', session_id: '' },
        title: '(duplicate skipped)',
        description: '',
        status: 'complete',
        package_type: 'standard',
        review_type: 'none',
        parent_package_id: null,
        child_package_ids: [],
        dependencies: [],
        tags: [],
        project_id: resolvedProject,
        deliverables: [],
        open_questions: [],
        decisions_made: [],
        handoff_note: '',
        estimated_next_actor: null,
        context_diff_ref: '.cdiff',
      };
    }

    const gitDiff = getGitDiff();

    // Auto-deposits get an [auto] title prefix so the dashboard timeline
    // can visually distinguish them from manual strategic deposits and
    // hide them by default behind a toggle. Title-based instead of
    // package_type-based so we don't need a DB schema migration; can
    // promote to a real package_type later if the title prefix proves
    // too brittle.
    const baseTitle = gitInfo.last_commit_message
      || `${gitInfo.branch} (${gitInfo.changed_files.length} files changed)`;
    const title = `[auto] ${baseTitle}`;
    const description = [
      `Branch: ${gitInfo.branch}`,
      `Changed files: ${gitInfo.changed_files.join(', ') || 'none'}`,
      `Commits (last 24h): ${gitInfo.commit_count}`,
      gitInfo.has_uncommitted ? 'Has uncommitted changes' : 'Working tree clean',
      `fingerprint:${fingerprint}`,
    ].join('\n');

    const packageId = generatePackageId();
    const parentId = opts.parentId || session?.parent_package_id || null;

    const manifest = buildManifest({
      packageId,
      projectId: resolvedProject,
      title,
      description,
      createdBy: {
        type: session?.actor_type || this.config.actor_type,
        id: session?.actor_id || this.config.actor_id,
        session_id: session?.session_id || '',
      },
      status: opts.status || 'complete',
      reviewType: opts.reviewType || 'none',
      parentPackageId: parentId,
      deliverables: gitInfo.changed_files.map((f) => ({
        path: f,
        type: path.extname(f).slice(1) || 'file',
      })),
    });

    // Infer metadata from content + changed files
    const topic = inferTopic(manifest, gitInfo.changed_files) ?? null;
    const artifactType = inferArtifactType(manifest) ?? null;

    // Build zip with git diff included
    const zipBuffer = await buildContextPackage(manifest, [], gitDiff);

    // Upload to storage (best-effort — see deposit() for rationale).
    const storagePath = this.storage.blobKeyFor(manifest.project_id, manifest.package_id);
    const uploadedPath = await this.tryPutBlob(storagePath, zipBuffer);

    // Generate CONTEXT.md text for DB
    const contextMd = generateContextMd(manifest, gitDiff);

    await this.storage.insertPackage({
      row: this.buildPackageInsertRow({
        manifest,
        contextMd,
        storagePath: uploadedPath,
        significance: computeSignificance(manifest, true),
        topic,
        artifactType,
      }),
    });

    // Generate embeddings (local — no API key needed)
    try {
      await generateAndStoreEmbeddings(this.storage, manifest, contextMd);
    } catch (e) {
      console.error(`Embedding generation skipped: ${(e as Error).message}`);
    }

    // Track in session
    sm.trackDeposited(manifest.package_id);

    return manifest;
  }

  async pullPackage(packageId: string): Promise<RelayManifest | null> {
    const row = await this.storage.getPackage(packageId);
    return row ? row.manifest : null;
  }

  async getLatestPackages(projectId?: string, limit = 20): Promise<RelayManifest[]> {
    const pid = projectId || this.config.default_project;
    if (!pid) throw new Error('No project ID provided and no default set');
    // listPackages returns full rows — we project manifest here and heal
    // manifests with missing `created_at` using the row-level column.
    // Three ANVIL2 packages (and probably others) have a 6-field manifest
    // stub missing created_at; the row column is correct in every case.
    const rows = await this.storage.listPackages({ projectId: pid, limit });
    return rows.map((r) => {
      const m = (r.manifest ?? {}) as RelayManifest;
      if (!m.created_at && r.created_at) return { ...m, created_at: r.created_at };
      return m;
    });
  }

  // --- Search ---

  async search(query: string, projectId?: string, limit = 25, opts?: SearchOptions): Promise<SearchResult[]> {
    const pid = projectId || this.config.default_project;
    if (!pid) throw new Error('No project ID provided and no default set');

    const queryEmbedding = await generateQueryEmbedding(query);

    // Over-retrieve 3x for reranking headroom.
    const retrieveCount = limit * 3;

    // Prefer hybrid when the adapter advertises it; fall back to semantic
    // when the hybrid RPC itself is missing OR the adapter's capability is
    // false. Per V02_PLAN §6(b), an adapter without either capability
    // throws `StorageCapabilityError` — for now that surfaces as a plain
    // Error since the class lands in Session B.
    const caps = this.storage.capabilities;
    if (caps.hybridSearch && typeof this.storage.hybridSearch === 'function') {
      try {
        const hits = await this.storage.hybridSearch({
          projectId: pid,
          queryText: query,
          queryEmbedding,
          matchCount: retrieveCount,
          topic: opts?.topic ?? null,
          artifactType: opts?.artifactType ?? null,
        });
        return rerank(query, hits as SearchResult[], limit);
      } catch (e) {
        // Fall through to semantic only if the hybrid RPC is missing.
        const msg = (e as Error).message || '';
        const tag = (e as Error & { rpc?: string }).rpc;
        const missingHybrid = tag === 'hybrid_search' || /hybrid_search/.test(msg);
        if (!missingHybrid) throw new Error(`Search failed: ${msg}`);
      }
    }

    if (caps.semanticSearch && typeof this.storage.semanticSearch === 'function') {
      const hits = await this.storage.semanticSearch({
        projectId: pid,
        queryEmbedding,
        matchCount: limit,
      });
      return hits as SearchResult[];
    }

    throw new StorageCapabilityError(
      `Search not supported by the configured storage. Use 'relay pull --latest' or configure Supabase storage.`,
      caps.hybridSearch ? 'hybridSearch' : 'semanticSearch',
    );
  }

  // --- Projects ---

  async getProject(projectId: string): Promise<Project | null> {
    return this.storage.getProject(projectId);
  }

  /**
   * List projects. Default excludes archived; pass `{ includeArchived: true }`
   * to include them (archived rows carry a non-null `archived_at` for UI hints).
   * Matches the `RelayStorage` contract.
   */
  async listProjects(opts: { includeArchived?: boolean } = {}): Promise<Project[]> {
    return this.storage.listProjects(opts);
  }

  async createProject(name: string, description?: string): Promise<Project> {
    return this.storage.insertProject({ name, description: description ?? '' });
  }

  /**
   * Rename a project. Thin wrapper around `storage.updateProject` so the
   * CLI and MCP can mutate names without knowing adapter details.
   * Throws if the new name is empty — keeping names non-empty is a UI
   * invariant (the dashboard falls back to the ID when name is missing).
   */
  async renameProject(id: string, name: string): Promise<Project> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Project name cannot be empty');
    return this.storage.updateProject(id, { name: trimmed });
  }

  /**
   * Soft-archive a project. Sets `archived_at = now()`. Idempotency:
   * throws AlreadyInStateError if the project is already archived — the
   * error carries the current row so callers can display a friendly message.
   *
   * Meta-project guard: refuses to archive `proj_dev_relay` or any project
   * with `settings.meta === true` unless `force: true` is passed. Archiving
   * Relay itself would stop the stop-hook from recording deposits for the
   * system that manages archiving.
   */
  async archiveProject(id: string, opts: { force?: boolean } = {}): Promise<Project> {
    // Fetch current state first for guard + idempotency checks.
    const current = await this.getProject(id);
    if (!current) {
      throw new Error(`Project not found: ${id}`);
    }

    if (!opts.force) {
      const isMeta =
        id === 'proj_dev_relay' ||
        (current.settings && (current.settings as Record<string, unknown>).meta === true);
      if (isMeta) {
        throw new MetaProjectGuardError(
          `Refusing to archive meta project "${id}". Pass force=true to override.`,
          current,
        );
      }
    }

    if (current.archived_at) {
      throw new AlreadyInStateError(
        `Project ${id} is already archived (at ${current.archived_at}).`,
        current,
        'archived',
      );
    }

    return this.storage.updateProjectArchived(id, new Date().toISOString());
  }

  /**
   * Restore an archived project. Clears `archived_at`. Throws
   * AlreadyInStateError if the project is already active.
   */
  async restoreProject(id: string): Promise<Project> {
    const current = await this.getProject(id);
    if (!current) {
      throw new Error(`Project not found: ${id}`);
    }
    if (!current.archived_at) {
      throw new AlreadyInStateError(
        `Project ${id} is already active.`,
        current,
        'active',
      );
    }

    return this.storage.updateProjectArchived(id, null);
  }

  /**
   * Quick check used by the auto-deposit guard. Returns true if the
   * project exists and has a non-null `archived_at`. Returns false on
   * missing project (caller decides whether that's an error).
   *
   * Non-throwing on missing row so the stop hook is maximally robust —
   * a missing project shouldn't block Claude from exiting.
   */
  async isProjectArchived(id: string): Promise<boolean> {
    if (!id) return false;
    // Don't fail the caller on a transient DB error — the auto-deposit path
    // will hit the same DB next anyway and surface a clearer error.
    try {
      const project = await this.storage.getProject(id);
      return Boolean(project?.archived_at);
    } catch {
      return false;
    }
  }

  // --- Meta Controls ---

  /**
   * Read a meta control value from the facts layer.
   * Meta controls are facts with subject prefix "meta:".
   * Returns the object value as a string, or null if not set.
   */
  async getMetaControl(group: string, key: string): Promise<string | null> {
    try {
      const facts = await this.queryFacts({
        subject: `meta:${group}`,
        relation: key,
      });
      return facts.length > 0 ? facts[0].object : null;
    } catch {
      return null;
    }
  }

  // --- Orientation (wake-up bundle) ---

  async getOrientation(
    projectId?: string,
    opts: OrientationOptions = {},
  ): Promise<OrientationBundle> {
    const pid = projectId || this.config.default_project;
    if (!pid) throw new Error('No project ID provided and no default set');

    const questionCount = opts.openQuestionCount ?? 5;
    const factCount = opts.activeFactCount ?? 8;
    const promotionThreshold = opts.significancePromotionThreshold ?? 9;

    // Resolve window_days: explicit param > meta control > default 14
    let windowDays = opts.windowDays ?? null;
    if (windowDays === null) {
      const metaWindow = await this.getMetaControl('orient', 'window_days');
      windowDays = metaWindow ? parseInt(metaWindow, 10) : 14;
      if (isNaN(windowDays) || windowDays < 1) windowDays = 14;
    }

    // ── Scan phase: all packages within time window ──
    const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString();
    // Per V02_PLAN §2: listPackages returns full rows, orient projects
    // client-side. Row count is bounded (~14d window) so the overfetch is
    // negligible.
    const rows = await this.storage.listPackages({ projectId: pid, sinceIso: cutoff });

    type Row = Pick<
      PackageRow,
      'id' | 'manifest' | 'significance' | 'created_at' | 'topic' | 'artifact_type'
    >;

    // ── Group phase: bucket by calendar day (UTC) ──
    const dayMap = new Map<string, Row[]>();
    const now = new Date();
    for (const row of rows) {
      const dateStr = row.created_at.slice(0, 10); // YYYY-MM-DD
      if (!dayMap.has(dateStr)) dayMap.set(dateStr, []);
      dayMap.get(dateStr)!.push(row);
    }

    // Sort days newest first
    const sortedDates = [...dayMap.keys()].sort((a, b) => b.localeCompare(a));

    // ── Compress + tier assignment ──
    const days: GradientDay[] = [];
    for (const dateStr of sortedDates) {
      const dayRows = dayMap.get(dateStr)!;
      const ageDays = Math.floor(
        (now.getTime() - new Date(dateStr + 'T12:00:00Z').getTime()) / 86400000,
      );

      // Determine base tier from age
      let baseTier: RenderTier;
      if (ageDays <= 1) baseTier = 'full';
      else if (ageDays <= 5) baseTier = 'medium';
      else if (ageDays <= 10) baseTier = 'light';
      else baseTier = 'minimal';

      // Sort day's packages by significance desc, then created_at asc (oldest first for bookend logic)
      const sorted = [...dayRows].sort((a, b) => {
        const sa = a.significance ?? 0;
        const sb = b.significance ?? 0;
        if (sb !== sa) return sb - sa;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      // Compression: preserve catalyst + bookends + promoted
      const preserved: OrientPackage[] = [];
      const compressed: Row[] = [];
      const maxSig = sorted[0]?.significance ?? 0;

      // Find all packages at max significance
      const topPackages = sorted.filter((r) => (r.significance ?? 0) === maxSig && maxSig >= 6);

      // Bookends: first (catalyst) and last (latest) at max significance
      const catalyst = topPackages.length > 0 ? topPackages[0] : null;
      const latest = topPackages.length > 1 ? topPackages[topPackages.length - 1] : null;

      const preservedIds = new Set<string>();

      if (catalyst) {
        preservedIds.add(catalyst.id);
      }
      if (latest && latest.id !== catalyst?.id) {
        preservedIds.add(latest.id);
      }

      // Significance promotion: preserve any package above the threshold
      for (const row of sorted) {
        if ((row.significance ?? 0) >= promotionThreshold && !preservedIds.has(row.id)) {
          preservedIds.add(row.id);
        }
      }

      // If no packages were preserved (all low significance), keep the single best
      if (preservedIds.size === 0 && sorted.length > 0) {
        preservedIds.add(sorted[0].id);
      }

      // Split into preserved vs compressed
      for (const row of sorted) {
        if (preservedIds.has(row.id)) {
          preserved.push({
            id: row.id,
            title: row.manifest.title,
            handoff_note: row.manifest.handoff_note ?? '',
            significance: row.significance ?? 0,
            created_at: row.created_at,
            topic: row.topic ?? row.manifest.topic ?? null,
            artifact_type: row.artifact_type ?? row.manifest.artifact_type ?? null,
            promoted: (row.significance ?? 0) >= promotionThreshold && ageDays > 1,
          });
        } else {
          compressed.push(row);
        }
      }

      // Sort preserved by created_at desc for display (newest first)
      preserved.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      // Build compressed type breakdown
      const compressedTypes: Record<string, number> = {};
      for (const row of compressed) {
        const t = row.artifact_type ?? row.manifest.artifact_type ?? 'other';
        compressedTypes[t] = (compressedTypes[t] ?? 0) + 1;
      }

      days.push({
        date: dateStr,
        age_days: ageDays,
        base_tier: baseTier,
        preserved,
        compressed_count: compressed.length,
        compressed_types: compressedTypes,
      });
    }

    // ── Latest handoff ──
    const latestHandoffRow = rows.find((r) => r.manifest.handoff_note?.trim());
    const latest_handoff = latestHandoffRow
      ? {
          package_id: latestHandoffRow.id,
          title: latestHandoffRow.manifest.title,
          handoff_note: latestHandoffRow.manifest.handoff_note,
          created_at: latestHandoffRow.created_at,
        }
      : null;

    // ── Open questions (deduplicated across window) ──
    const allQuestions = new Set<string>();
    for (const r of rows) {
      for (const q of r.manifest.open_questions ?? []) {
        const trimmed = q?.trim();
        if (trimmed) allQuestions.add(trimmed);
      }
    }
    const open_questions = [...allQuestions].slice(0, questionCount);

    // ── Project name ──
    let project_name = pid;
    try {
      const project = await this.getProject(pid);
      if (project?.name) project_name = project.name;
    } catch {
      // Non-fatal
    }

    // ── Active facts ──
    let active_facts: RelayFact[] = [];
    let total_active_facts = 0;
    try {
      const all = await this.queryFacts({ projectId: pid });
      total_active_facts = all.length;
      active_facts = all.slice(0, factCount);
    } catch {
      // Non-fatal
    }

    return {
      project_id: pid,
      project_name,
      generated_at: new Date().toISOString(),
      window_days: windowDays,
      days,
      latest_handoff,
      open_questions,
      active_facts,
      recent_package_count: rows.length,
      total_open_questions: allQuestions.size,
      total_active_facts,
    };
  }

  // --- Mutable facts (triples layer) ---
  //
  // Relay's "whiteboard" alongside the immutable context_packages "journal."
  // Packages stay immutable (the historical reasoning trail). Facts are
  // supersedable (the current truth about what we know).
  //
  // See migration 004_facts.sql and pkg_f7b1a8d6 for the design rationale.

  /**
   * Assert a fact (subject, relation, object) about a project.
   *
   * Auto-supersede semantics: if there's already an active fact with the
   * same (project_id, subject, relation), it gets ended_at = now() BEFORE
   * the new row is inserted. This is what makes the user-facing model
   * "rewriting on the whiteboard" actually work — you don't need separate
   * invalidate calls for the common case of "X is now Y instead of Z."
   *
   * Asserting the same (subject, relation, object) that's already active
   * is a no-op (returns the existing row) — keeps the orient bundle stable
   * across re-asserts.
   */
  async assertFact(opts: AssertFactOptions): Promise<RelayFact> {
    const pid = opts.projectId || this.config.default_project;
    if (!pid) throw new Error('No project ID provided and no default set');

    // Check for an existing active fact with the same (subject, relation).
    const existing = await this.storage.queryFacts({
      projectId: pid,
      subject: opts.subject,
      relation: opts.relation,
      limit: 1,
    });

    if (existing.length > 0) {
      const current = existing[0];
      if (current.object === opts.object) {
        // Idempotent: same triple is already asserted, just return it.
        return current;
      }
      // Different object: supersede the old one before inserting.
      await this.storage.endFact(current.id, new Date().toISOString());
    }

    // Insert the new active fact.
    return this.storage.insertFact({
      project_id: pid,
      subject: opts.subject,
      relation: opts.relation,
      object: opts.object,
      source_package_id: opts.sourcePackageId ?? null,
      asserted_by_type: this.config.actor_type,
      asserted_by_id: this.config.actor_id,
    });
  }

  /**
   * Invalidate one or more active facts. Sets ended_at = now() on matches.
   * Returns the number of rows ended.
   *
   * If `object` is provided, only that exact (subject, relation, object)
   * triple is ended. If omitted, ALL active facts matching (subject,
   * relation) are ended — useful for "no longer track this attribute."
   */
  async invalidateFact(opts: InvalidateFactOptions): Promise<number> {
    const pid = opts.projectId || this.config.default_project;
    if (!pid) throw new Error('No project ID provided and no default set');

    return this.storage.endFactsMatching({
      projectId: pid,
      subject: opts.subject,
      relation: opts.relation,
      object: opts.object,
      endedAt: new Date().toISOString(),
    });
  }

  /**
   * Query facts with optional filters and time-travel.
   *
   * Default behavior: returns currently-active facts only (ended_at IS NULL).
   * Pass `asOf` to get facts that were active at a specific past timestamp.
   * Pass `includeEnded=true` to get the full history regardless of timing.
   */
  async queryFacts(opts: FactQuery & { projectId?: string } = {}): Promise<RelayFact[]> {
    const pid = opts.projectId || this.config.default_project;
    if (!pid) throw new Error('No project ID provided and no default set');
    return this.storage.queryFacts({ ...opts, projectId: pid });
  }

  // --- Helpers ---

  packageUrl(packageId: string): string {
    return `${this.config.core_url}/packages/${packageId}`;
  }

  /**
   * Public wrapper around CWD-to-project resolution.
   *
   * Exposed so CLI commands (e.g. `relay backup`) can replicate the same
   * resolution that `autoDeposit` does, without duplicating the config
   * parsing logic. Returns an empty string when no mapping matches —
   * callers decide how to treat that.
   */
  resolveProjectFromCwd(): string {
    return resolveProjectFromCwd(this.config);
  }

  // ==========================================================================
  //  RelayStorage — read-only subset (v0.1)
  //
  //  Thin wrappers that adapt the existing `RelayClient` methods to the
  //  `RelayStorage` contract declared in `./storage/types.ts`. These do
  //  NOT refactor the client's internals — direct Supabase calls above
  //  stay as-is. The goal is to let `BackupService` (and any future
  //  portable consumer) depend on the interface rather than the class.
  //
  //  Full RelayStorage implementation (inserts, updates, semantic search,
  //  realtime) lands in v0.2 when the refactor is scoped.
  // ==========================================================================

  /** Capability flags. Supabase backend speaks all three. */
  get capabilities(): StorageCapabilities {
    return {
      hybridSearch: true,
      semanticSearch: true,
      realtime: true,
    };
  }

  /**
   * Fetch a single context_packages row by id.
   *
   * The interface wants a PackageRow (the flat row shape) — the
   * existing `pullPackage()` returns the manifest only, so this is a new
   * code path. It's still a read-only SELECT on the same table used
   * everywhere else in this class.
   */
  async getPackage(id: string): Promise<PackageRow | null> {
    return this.storage.getPackage(id);
  }

  /**
   * List context_packages rows for a project, newest first. Used by
   * `BackupService` to stream the full history into NDJSON.
   */
  async listPackages(q: {
    projectId: string;
    limit?: number;
    sinceIso?: string;
  }): Promise<PackageRow[]> {
    return this.storage.listPackages(q);
  }

  /**
   * List all sessions for a project. Used by `BackupService`.
   */
  async listSessions(q: { projectId: string }): Promise<Session[]> {
    return this.storage.listSessions(q);
  }

  /**
   * Download a blob from Supabase Storage by key.
   *
   * Returns `null` if the object is missing. Network / permission
   * failures throw — `BackupService` catches them and records a
   * per-package `blob_error` rather than aborting the whole backup.
   */
  async getBlob(key: string): Promise<Uint8Array | null> {
    // Matches the optional `getBlob?` on RelayStorage — if the configured
    // adapter doesn't support blob reads, surface `null` so BackupService
    // records a per-package blob_missing rather than crashing.
    if (typeof this.storage.getBlob !== 'function') return null;
    return this.storage.getBlob(key);
  }
}

// `RelayClient` satisfies the read-only subset of `RelayStorage`. We
// don't enforce this with a `satisfies` expression because v0.1's
// `queryFacts()` accepts a looser `{ projectId?: string }` signature
// (project defaulting is a client-only convenience) while the interface
// requires `projectId`. The widened client signature is a strict
// super-set, so passing a `RelayClient` wherever `RelayStorage` is
// expected works at the call sites that do specify `projectId`.
// See RelayStorage.queryFacts in ./storage/types.ts.
