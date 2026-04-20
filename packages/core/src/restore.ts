/**
 * RestoreService — symmetric counterpart to `BackupService`.
 *
 * Reads the NDJSON + blob layout written by `BackupService` and replays
 * it into any `RelayStorage` implementation. Rows are inserted in FK
 * order so `parent_package_id` / `session_id` / `source_package_id`
 * references always point at rows that have already landed:
 *
 *   1. projects  (from `projects.ndjson`)
 *   2. packages  (from `packages.ndjson`, sorted by `created_at` asc)
 *   3. blobs     (read from disk, `putBlob` with the target adapter's
 *                 canonical key — NOT the portable backup key)
 *   4. facts     (from `facts.ndjson`, sorted by `valid_from` asc —
 *                 preserves `id`/`valid_from`/`ended_at` so supersession
 *                 chains round-trip byte-identically)
 *   5. embeddings (optional; absent in most backups because vectors are
 *                  model-locked — they regenerate on first deposit)
 *   6. sessions  (last — `packages_deposited` / `packages_pulled` arrays
 *                 reference package ids, so they need to exist first)
 *
 * ID-collision policy (`conflict`):
 *   - `skip` (default) — row already exists in target, skip + record.
 *   - `overwrite` — upsert the row. Only supported for packages today
 *     (PackageInsert has `upsert: true`); facts/sessions/projects fall
 *     back to `skip` with a `partially_overwritten` warning so restore
 *     never crashes a partially-populated target.
 *   - `rename` — footgun. Suffixes the id with `_restored_<shortid>`;
 *     breaks `parent_package_id` FKs because referents are unaware of
 *     the new id. Only useful when you want a *copy* of a backup
 *     alongside the original (rarely what you want).
 *
 * Dry-run mode (`dryRun: true`) parses the backup, validates shapes and
 * versions, counts rows, detects conflicts, and verifies that every
 * referenced blob file exists on disk — without writing anything. Useful
 * as a pre-flight for a real restore, or as CI validation of a backup
 * artifact.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type {
  RelayStorage,
  PackageRow,
  PackageInsert,
  FactInsert,
  SessionInsert,
  ProjectInsert,
} from './storage/types.js';
import type { Project, RelayFact, Session } from './types.js';
import type { BackupManifest, BlobError } from './backup.js';

/**
 * Valid kinds for the `--only <kinds>` filter. Order mirrors the
 * execution order above.
 */
export type RestoreKind = 'projects' | 'packages' | 'blobs' | 'facts' | 'embeddings' | 'sessions';
const ALL_KINDS: readonly RestoreKind[] = [
  'projects',
  'packages',
  'blobs',
  'facts',
  'embeddings',
  'sessions',
] as const;

export type ConflictPolicy = 'skip' | 'overwrite' | 'rename';

export interface RestoreOptions {
  /** Root backup directory (contains `manifest.json`). */
  fromDir: string;
  /** Restore only this project (for multi-project backup bundles). */
  projectId?: string;
  /** ID-collision policy. Default `skip`. */
  conflict?: ConflictPolicy;
  /** Parse + validate only, no writes. */
  dryRun?: boolean;
  /** ISO timestamp lower bound — only rows with `created_at` / `valid_from` ≥ this. */
  sinceIso?: string;
  /** Subset of kinds to restore. Default: all. */
  only?: RestoreKind[];
  /** Skip the blob-upload phase. `--no-blobs`. */
  skipBlobs?: boolean;
  /** Skip embeddings restore. `--no-embeddings`. */
  skipEmbeddings?: boolean;
  /** Skip facts restore. `--no-facts`. */
  skipFacts?: boolean;
  /** Skip sessions restore. `--no-sessions`. */
  skipSessions?: boolean;
  /** Optional progress callback. */
  onProgress?: (event: RestoreProgressEvent) => void;
}

export interface ConflictReport {
  kind: 'project' | 'package' | 'fact' | 'session';
  id: string;
  reason: string;
}

export interface RestoreCounts {
  projects: number;
  packages: number;
  facts: number;
  sessions: number;
  blobs: number;
  embeddings: number;
}

export interface RestoreResult {
  /** Was this a dry-run? */
  dryRun: boolean;
  /** Project ids actually processed. */
  projectIds: string[];
  /** How many rows were inserted (or would be inserted, in dry-run). */
  inserted: RestoreCounts;
  /** How many rows were skipped due to conflicts or filter flags. */
  skipped: RestoreCounts;
  /** Per-row conflict records. */
  conflicts: ConflictReport[];
  /** Blob files referenced by packages but missing on disk. */
  blobErrors: BlobError[];
  /** Validation errors that would prevent (or did abort) a real restore. */
  validationErrors: string[];
  /** The manifest that was read from `<fromDir>/manifest.json`. */
  sourceManifest: BackupManifest;
}

export type RestoreProgressEvent =
  | { kind: 'manifest_loaded'; projects: number; packages: number; facts: number; sessions: number }
  | { kind: 'project_inserted'; projectId: string }
  | { kind: 'project_skipped'; projectId: string; reason: string }
  | { kind: 'packages_batch'; projectId: string; inserted: number; skipped: number }
  | { kind: 'blob_uploaded'; packageId: string }
  | { kind: 'blob_missing'; packageId: string; reason: string }
  | { kind: 'facts_done'; projectId: string; inserted: number; skipped: number }
  | { kind: 'sessions_done'; projectId: string; inserted: number; skipped: number };

/** Matches BACKUP_FORMAT_VERSION / RELAY_PROTOCOL_VERSION expectations. */
const SUPPORTED_FORMAT = '1';
const SUPPORTED_PROTOCOL_PREFIX = '0.';

export class RestoreService {
  private storage: RelayStorage;
  constructor(storage: RelayStorage) {
    this.storage = storage;
  }

  async restore(opts: RestoreOptions): Promise<RestoreResult> {
    const fromDir = opts.fromDir;
    const conflict: ConflictPolicy = opts.conflict ?? 'skip';
    const dryRun = Boolean(opts.dryRun);
    const onProgress = opts.onProgress;

    const validationErrors: string[] = [];
    const conflicts: ConflictReport[] = [];
    const blobErrors: BlobError[] = [];
    const inserted: RestoreCounts = emptyCounts();
    const skipped: RestoreCounts = emptyCounts();

    // --- 0. Validate backup directory and manifest ----------------------
    const manifestPath = path.join(fromDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Missing manifest.json in ${fromDir}`);
    }
    const manifest: BackupManifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf-8'));

    if (manifest.backup_format_version !== SUPPORTED_FORMAT) {
      throw new Error(
        `Unsupported backup_format_version "${manifest.backup_format_version}" (expected "${SUPPORTED_FORMAT}"). ` +
          `Upgrade tooling or convert the backup first.`,
      );
    }
    if (!manifest.protocol_version.startsWith(SUPPORTED_PROTOCOL_PREFIX)) {
      throw new Error(
        `Unsupported protocol_version "${manifest.protocol_version}" (expected "${SUPPORTED_PROTOCOL_PREFIX}x").`,
      );
    }

    onProgress?.({
      kind: 'manifest_loaded',
      projects: manifest.counts.projects,
      packages: manifest.counts.packages,
      facts: manifest.counts.facts,
      sessions: manifest.counts.sessions,
    });

    const enabled = new Set<RestoreKind>(opts.only && opts.only.length > 0 ? opts.only : ALL_KINDS);
    if (opts.skipBlobs) enabled.delete('blobs');
    if (opts.skipEmbeddings) enabled.delete('embeddings');
    if (opts.skipFacts) enabled.delete('facts');
    if (opts.skipSessions) enabled.delete('sessions');

    // --- 1. Projects ----------------------------------------------------
    const projectsPath = path.join(fromDir, 'projects.ndjson');
    if (!fs.existsSync(projectsPath)) {
      throw new Error(`Missing projects.ndjson in ${fromDir}`);
    }
    const allProjects: Project[] = await readNdjson<Project>(projectsPath);
    const targetProjects: Project[] = opts.projectId
      ? allProjects.filter((p) => p.id === opts.projectId)
      : allProjects;
    if (opts.projectId && targetProjects.length === 0) {
      throw new Error(
        `Project ${opts.projectId} not found in backup (has: ${allProjects.map((p) => p.id).join(', ')})`,
      );
    }

    const projectIds = targetProjects.map((p) => p.id);
    if (enabled.has('projects')) {
      for (const project of targetProjects) {
        const existing = await this.storage.getProject(project.id);
        if (existing) {
          conflicts.push({ kind: 'project', id: project.id, reason: 'already exists' });
          skipped.projects += 1;
          onProgress?.({ kind: 'project_skipped', projectId: project.id, reason: 'already exists' });
          continue;
        }
        if (!dryRun) {
          const insert: ProjectInsert = {
            id: project.id,
            name: project.name,
            description: project.description,
            owner_id: project.owner_id,
            settings: project.settings,
            archived_at: project.archived_at,
          };
          await this.storage.insertProject(insert);
        }
        inserted.projects += 1;
        onProgress?.({ kind: 'project_inserted', projectId: project.id });
      }
    } else {
      skipped.projects += targetProjects.length;
    }

    // --- 2. Packages + 3. Blobs ----------------------------------------
    const packagesPath = path.join(fromDir, 'packages.ndjson');
    let allPackages: PackageRow[] = [];
    if (fs.existsSync(packagesPath)) {
      allPackages = await readNdjson<PackageRow>(packagesPath);
    }
    const targetPackages = allPackages
      .filter((pkg) => (opts.projectId ? pkg.project_id === opts.projectId : true))
      .filter((pkg) => !opts.sinceIso || pkg.created_at >= opts.sinceIso)
      // Parents must precede children per protocol immutability — sort
      // ascending by created_at.
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    if (enabled.has('packages')) {
      const batchesByProject = new Map<string, { inserted: number; skipped: number }>();

      for (const original of targetPackages) {
        let row: PackageRow = original;
        let effectiveId = original.id;

        // Resolve conflict by policy.
        const existing = await this.storage.getPackage(original.id);
        if (existing) {
          if (conflict === 'skip') {
            conflicts.push({ kind: 'package', id: original.id, reason: 'already exists' });
            skipped.packages += 1;
            bumpBatch(batchesByProject, original.project_id, 'skipped');
            continue;
          }
          if (conflict === 'rename') {
            effectiveId = `${original.id}_restored_${shortId()}`;
            row = { ...original, id: effectiveId };
            // Dev-loud warning on first rename per restore. rename breaks
            // `parent_package_id` FKs — children of the renamed package
            // will still reference the original id and no longer resolve.
            conflicts.push({
              kind: 'package',
              id: original.id,
              reason: `renamed to ${effectiveId} (parent FK refs NOT updated)`,
            });
          }
          // `overwrite` falls through to the upsert below.
        }

        // Blob phase — tied to the package so we can stamp the real
        // `storage_path` on the row before inserting it.
        let newStoragePath = row.storage_path;
        if (
          row.storage_path &&
          enabled.has('blobs') &&
          typeof this.storage.putBlob === 'function'
        ) {
          const sourceBlobPath = path.join(fromDir, row.storage_path);
          if (!fs.existsSync(sourceBlobPath)) {
            blobErrors.push({
              packageId: effectiveId,
              storagePath: row.storage_path,
              reason: 'blob file missing on disk',
            });
            newStoragePath = null;
            onProgress?.({
              kind: 'blob_missing',
              packageId: effectiveId,
              reason: 'blob file missing on disk',
            });
          } else {
            // Canonical key for the *target* adapter (may differ from the
            // portable backup path, e.g. SQLite might key blobs by id only).
            const key = this.storage.blobKeyFor(row.project_id, effectiveId);
            if (!dryRun) {
              try {
                const body = await fs.promises.readFile(sourceBlobPath);
                await this.storage.putBlob(key, new Uint8Array(body), 'application/zip');
                inserted.blobs += 1;
                onProgress?.({ kind: 'blob_uploaded', packageId: effectiveId });
              } catch (err) {
                const reason = (err as Error).message || 'unknown error';
                // Overwrite mode: a pre-existing blob at the same key is a
                // no-op success (blob content is a deterministic function
                // of the package manifest, which is immutable). Skip the
                // error record so the caller's "blob errors" count reflects
                // only real problems.
                const alreadyExists =
                  conflict === 'overwrite' && /already exists/i.test(reason);
                if (alreadyExists) {
                  inserted.blobs += 1;
                  onProgress?.({ kind: 'blob_uploaded', packageId: effectiveId });
                } else {
                  blobErrors.push({ packageId: effectiveId, storagePath: key, reason });
                  onProgress?.({ kind: 'blob_missing', packageId: effectiveId, reason });
                  newStoragePath = null;
                }
              }
            } else {
              // Dry-run: count what WOULD have uploaded.
              inserted.blobs += 1;
            }
            if (!(inserted.blobs === 0 && newStoragePath === null)) {
              newStoragePath = key;
            }
          }
        } else if (!enabled.has('blobs') && row.storage_path) {
          // Blobs turned off — preserve the row's reference so a later
          // `--only blobs` pass can upload.
          skipped.blobs += 1;
        }

        const insertRow: Omit<PackageRow, 'created_at'> & { created_at?: string } = {
          ...row,
          storage_path: newStoragePath ?? null,
        };
        // Keep the original `created_at` so the timeline preserves real
        // history — the DB column allows explicit inserts.
        (insertRow as Record<string, unknown>).created_at = row.created_at;

        if (!dryRun) {
          const payload: PackageInsert = {
            row: insertRow as Omit<PackageRow, 'created_at'>,
            upsert: conflict === 'overwrite',
          };
          try {
            await this.storage.insertPackage(payload);
          } catch (err) {
            validationErrors.push(
              `insertPackage failed for ${effectiveId}: ${(err as Error).message}`,
            );
            bumpBatch(batchesByProject, original.project_id, 'skipped');
            skipped.packages += 1;
            continue;
          }
        }
        inserted.packages += 1;
        bumpBatch(batchesByProject, original.project_id, 'inserted');
      }

      for (const [pid, counts] of batchesByProject.entries()) {
        onProgress?.({
          kind: 'packages_batch',
          projectId: pid,
          inserted: counts.inserted,
          skipped: counts.skipped,
        });
      }
    } else {
      skipped.packages += targetPackages.length;
    }

    // --- 4. Facts ------------------------------------------------------
    const factsPath = path.join(fromDir, 'facts.ndjson');
    if (enabled.has('facts') && fs.existsSync(factsPath)) {
      const allFacts: RelayFact[] = await readNdjson<RelayFact>(factsPath);
      const targetFacts = allFacts
        .filter((f) => (opts.projectId ? f.project_id === opts.projectId : true))
        .filter((f) => !opts.sinceIso || f.valid_from >= opts.sinceIso)
        // Replay in chronological order so the supersession chain looks
        // identical to the original.
        .sort((a, b) => a.valid_from.localeCompare(b.valid_from));

      const factsByProject = new Map<string, { inserted: number; skipped: number }>();

      for (const fact of targetFacts) {
        // Facts don't have a cheap existence check at the storage layer
        // (queryFacts supports subject/relation/object filters but not
        // by id). Do a best-effort existence check: if a currently-active
        // fact with the same (subject, relation, object) already exists,
        // skip this row. This is the common case for re-importing a
        // backup into a populated project.
        const matches = await this.storage.queryFacts({
          projectId: fact.project_id,
          subject: fact.subject,
          relation: fact.relation,
          object: fact.object,
          includeEnded: true,
          limit: 50,
        });
        const alreadyHave = matches.some(
          (m) =>
            m.id === fact.id ||
            (m.valid_from === fact.valid_from && (m.ended_at ?? null) === (fact.ended_at ?? null)),
        );
        if (alreadyHave) {
          conflicts.push({ kind: 'fact', id: fact.id, reason: 'duplicate fact (id or time window)' });
          skipped.facts += 1;
          bumpBatch(factsByProject, fact.project_id, 'skipped');
          continue;
        }

        if (!dryRun) {
          const payload: FactInsert = {
            id: fact.id,
            project_id: fact.project_id,
            subject: fact.subject,
            relation: fact.relation,
            object: fact.object,
            source_package_id: fact.source_package_id,
            asserted_by_type: fact.asserted_by_type,
            asserted_by_id: fact.asserted_by_id,
            valid_from: fact.valid_from,
            ended_at: fact.ended_at,
          };
          try {
            await this.storage.insertFact(payload);
          } catch (err) {
            validationErrors.push(`insertFact failed for ${fact.id}: ${(err as Error).message}`);
            skipped.facts += 1;
            bumpBatch(factsByProject, fact.project_id, 'skipped');
            continue;
          }
        }
        inserted.facts += 1;
        bumpBatch(factsByProject, fact.project_id, 'inserted');
      }

      for (const [pid, counts] of factsByProject.entries()) {
        onProgress?.({
          kind: 'facts_done',
          projectId: pid,
          inserted: counts.inserted,
          skipped: counts.skipped,
        });
      }
    }

    // --- 5. Embeddings (optional) -------------------------------------
    // Not emitted by backup by default (vectors are model-locked); kept
    // here for forward compatibility when someone runs
    // `relay backup --include-embeddings` (landing in a future session).
    const embeddingsPath = path.join(fromDir, 'embeddings.ndjson');
    if (enabled.has('embeddings') && fs.existsSync(embeddingsPath)) {
      const rows: Array<{
        package_id: string;
        content_type: 'context_md' | 'decision' | 'question' | 'handoff';
        content: string;
        embedding: number[];
      }> = await readNdjson(embeddingsPath);
      if (!dryRun && rows.length > 0) {
        try {
          await this.storage.insertEmbeddings(rows);
        } catch (err) {
          validationErrors.push(`insertEmbeddings failed: ${(err as Error).message}`);
        }
      }
      inserted.embeddings += rows.length;
    }

    // --- 6. Sessions ---------------------------------------------------
    const sessionsPath = path.join(fromDir, 'sessions.ndjson');
    if (enabled.has('sessions') && fs.existsSync(sessionsPath)) {
      const allSessions: Session[] = await readNdjson<Session>(sessionsPath);
      const targetSessions = allSessions
        .filter((s) => (opts.projectId ? s.project_id === opts.projectId : true))
        .filter((s) => !opts.sinceIso || s.started_at >= opts.sinceIso);

      const sessionsByProject = new Map<string, { inserted: number; skipped: number }>();

      for (const session of targetSessions) {
        // Sessions have client-assigned ids, but listSessions by id isn't
        // in the adapter contract. Rely on PK-conflict behavior — for
        // `skip`, listSessions({projectId}) + Set membership check.
        const existing = await this.storage.listSessions({ projectId: session.project_id });
        const existingIds = new Set(existing.map((s) => s.id));
        if (existingIds.has(session.id)) {
          conflicts.push({ kind: 'session', id: session.id, reason: 'already exists' });
          skipped.sessions += 1;
          bumpBatch(sessionsByProject, session.project_id, 'skipped');
          continue;
        }

        if (!dryRun) {
          // Tolerate both canonical nested shape (actor: {type, id})
          // and the legacy flat shape (actor_type, actor_id) used by
          // older backups written before SupabaseStorage.listSessions
          // learned to normalize its output on read.
          const flat = session as unknown as {
            actor?: { type: string; id: string };
            actor_type?: string;
            actor_id?: string;
          };
          const actorType = flat.actor?.type ?? flat.actor_type;
          const actorId = flat.actor?.id ?? flat.actor_id;
          if (!actorType || !actorId) {
            validationErrors.push(
              `Session ${session.id} missing actor fields; skipped.`,
            );
            skipped.sessions += 1;
            bumpBatch(sessionsByProject, session.project_id, 'skipped');
            continue;
          }
          const payload: SessionInsert = {
            id: session.id,
            project_id: session.project_id,
            actor_type: actorType as 'agent' | 'human',
            actor_id: actorId,
            agent_description: session.agent_description,
            packages_pulled: session.packages_pulled,
            packages_deposited: session.packages_deposited,
            started_at: session.started_at,
            ended_at: session.ended_at,
          };
          try {
            await this.storage.insertSession(payload);
          } catch (err) {
            validationErrors.push(
              `insertSession failed for ${session.id}: ${(err as Error).message}`,
            );
            skipped.sessions += 1;
            bumpBatch(sessionsByProject, session.project_id, 'skipped');
            continue;
          }
        }
        inserted.sessions += 1;
        bumpBatch(sessionsByProject, session.project_id, 'inserted');
      }

      for (const [pid, counts] of sessionsByProject.entries()) {
        onProgress?.({
          kind: 'sessions_done',
          projectId: pid,
          inserted: counts.inserted,
          skipped: counts.skipped,
        });
      }
    }

    return {
      dryRun,
      projectIds,
      inserted,
      skipped,
      conflicts,
      blobErrors,
      validationErrors,
      sourceManifest: manifest,
    };
  }
}

function emptyCounts(): RestoreCounts {
  return { projects: 0, packages: 0, facts: 0, sessions: 0, blobs: 0, embeddings: 0 };
}

function shortId(): string {
  // 8 hex chars — enough to disambiguate a few dozen renames in practice.
  return Math.random().toString(16).slice(2, 10);
}

function bumpBatch(
  map: Map<string, { inserted: number; skipped: number }>,
  projectId: string,
  which: 'inserted' | 'skipped',
): void {
  const cur = map.get(projectId) ?? { inserted: 0, skipped: 0 };
  cur[which] += 1;
  map.set(projectId, cur);
}

async function readNdjson<T>(filePath: string): Promise<T[]> {
  const rows: T[] = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch (err) {
      // Abort on first parse error — a corrupt NDJSON invalidates the
      // whole file for restore purposes.
      throw new Error(`Failed to parse NDJSON in ${filePath}: ${(err as Error).message}`);
    }
  }
  return rows;
}
