/**
 * BackupService — portable, read-only snapshot of a Relay project.
 *
 * Takes any `RelayStorage` implementation and writes a self-contained
 * directory of NDJSON + blobs. The shape is intentionally simple so a
 * future `relay restore` command (v0.2) can round-trip it back into any
 * other storage backend.
 *
 * Backup format version: "1".
 *
 *   <outDir>/
 *     manifest.json              — backup metadata + counts
 *     projects.ndjson            — one Project per line
 *     packages.ndjson            — one PackageRow per line (storage_path rewritten)
 *     facts.ndjson               — one RelayFact per line (full history)
 *     sessions.ndjson            — one Session per line
 *     blobs/<project_id>/<package_id>.relay.zip  (when available)
 *
 * NDJSON is streamed line-by-line; we never materialize the entire
 * package list in memory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import type { ReadOnlyRelayStorage, PackageRow } from './storage/types.js';
import type { Project, RelayFact, Session } from './types.js';

export const BACKUP_FORMAT_VERSION = '1';
export const RELAY_PROTOCOL_VERSION = '0.1';

/**
 * Paginate `listPackages` in batches of `pageSize`, ordered by `created_at`
 * descending. We walk backwards in time using the oldest row's timestamp
 * as the upper bound for the next call, minus 1 ms to avoid re-pulling
 * the same row. This works with any RelayStorage impl that honors the
 * `sinceIso` lower bound — we simply keep requesting the most recent N
 * packages and filter client-side.
 *
 * For the v0.1 subset we don't add a "before" bound to the interface;
 * instead each page uses the full `limit` and we stop when we see a page
 * smaller than `pageSize` OR when the oldest id has already been seen.
 */
const DEFAULT_PAGE_SIZE = 200;

export interface BackupResult {
  projectId: string;
  outDir: string;
  packageCount: number;
  factCount: number;
  sessionCount: number;
  blobCount: number;
  blobTotal: number;
  blobErrors: BlobError[];
}

export interface BlobError {
  packageId: string;
  storagePath: string;
  reason: string;
}

/** A project that could not be exported during an --all-projects run. */
export interface ProjectFailure {
  projectId: string;
  projectName?: string;
  reason: string;
}

export interface BackupManifest {
  tool_version: string;
  protocol_version: string;
  backup_format_version: string;
  backup_generated_at: string;
  project_ids: string[];
  counts: {
    projects: number;
    packages: number;
    facts: number;
    sessions: number;
    blobs_stored: number;
    blobs_attempted: number;
  };
  blob_errors: BlobError[];
  /**
   * Projects that failed during an --all-projects run. Absent or empty on a
   * clean export. A restore tool should treat a non-empty list as a partial
   * snapshot and refuse to present it as a complete one.
   */
  failed_projects?: ProjectFailure[];
  /** True when at least one project failed — the backup is incomplete. */
  partial?: boolean;
}

export interface BackupAllResult {
  outDir: string;
  perProject: BackupResult[];
  failures: ProjectFailure[];
}

export interface BackupServiceOptions {
  /** Override the `tool_version` stamped into the backup manifest. */
  toolVersion?: string;
  /** Stream-level batch size for package pagination. Default 200. */
  pageSize?: number;
  /** Optional progress callback — fires once per batch. */
  onProgress?: (event: BackupProgressEvent) => void;
}

export type BackupProgressEvent =
  | { kind: 'projects_listed'; count: number }
  | { kind: 'packages_batch'; projectId: string; cumulative: number }
  | { kind: 'facts_done'; projectId: string; count: number }
  | { kind: 'sessions_done'; projectId: string; count: number }
  | { kind: 'blob_ok'; projectId: string; packageId: string }
  | { kind: 'blob_miss'; projectId: string; packageId: string; reason: string }
  | { kind: 'retry'; projectId: string; attempt: number; reason: string }
  | { kind: 'project_failed'; projectId: string; reason: string };

export class BackupService {
  private storage: ReadOnlyRelayStorage;
  private toolVersion: string;
  private pageSize: number;
  private onProgress?: (event: BackupProgressEvent) => void;

  constructor(storage: ReadOnlyRelayStorage, opts: BackupServiceOptions = {}) {
    this.storage = storage;
    this.toolVersion = opts.toolVersion ?? '0.1.0';
    this.pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
    this.onProgress = opts.onProgress;
  }

  /**
   * Back up a single project to `outDir`. The directory is created if
   * it does not exist; existing files are overwritten.
   */
  async backupProject(opts: { projectId: string; outDir: string }): Promise<BackupResult> {
    const { projectId, outDir } = opts;
    await fs.promises.mkdir(outDir, { recursive: true });
    await fs.promises.mkdir(path.join(outDir, 'blobs', projectId), { recursive: true });

    // 1. Project row ------------------------------------------------
    const project = await this.storage.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found.`);
    }
    await writeNdjson(path.join(outDir, 'projects.ndjson'), [project]);

    // 2. Packages (streamed, paginated) -----------------------------
    const blobErrors: BlobError[] = [];
    let packageCount = 0;
    let blobCount = 0;
    let blobTotal = 0;

    const packagesPath = path.join(outDir, 'packages.ndjson');
    const packagesStream = fs.createWriteStream(packagesPath, { encoding: 'utf-8' });
    try {
      await streamPackages(
        this.storage,
        projectId,
        this.pageSize,
        async (batch) => {
          for (const row of batch) {
            // Fetch blob if available + rewrite storage_path to be relative.
            let rewrittenStoragePath = row.storage_path;
            if (row.storage_path && typeof this.storage.getBlob === 'function') {
              blobTotal += 1;
              try {
                const blob = await withRetry(
                  () => this.storage.getBlob!(row.storage_path!),
                  'Failed to fetch blob ' + row.storage_path,
                  (attempt, e) =>
                    this.onProgress?.({ kind: 'retry', projectId, attempt, reason: e.message }),
                );
                if (blob && blob.byteLength > 0) {
                  const relPath = `blobs/${projectId}/${row.id}.relay.zip`;
                  const absPath = path.join(outDir, relPath);
                  await fs.promises.writeFile(absPath, Buffer.from(blob));
                  rewrittenStoragePath = relPath;
                  blobCount += 1;
                  this.onProgress?.({ kind: 'blob_ok', projectId, packageId: row.id });
                } else {
                  const reason = 'blob not found in storage';
                  blobErrors.push({ packageId: row.id, storagePath: row.storage_path, reason });
                  this.onProgress?.({ kind: 'blob_miss', projectId, packageId: row.id, reason });
                }
              } catch (err) {
                const reason = (err as Error).message || 'unknown error';
                blobErrors.push({ packageId: row.id, storagePath: row.storage_path, reason });
                this.onProgress?.({ kind: 'blob_miss', projectId, packageId: row.id, reason });
              }
            }

            const rewritten: PackageRow = {
              ...row,
              storage_path: rewrittenStoragePath,
            };
            packagesStream.write(JSON.stringify(rewritten) + '\n');
            packageCount += 1;
          }
          this.onProgress?.({ kind: 'packages_batch', projectId, cumulative: packageCount });
        },
        (attempt, err) =>
          this.onProgress?.({ kind: 'retry', projectId, attempt, reason: err.message }),
      );
    } finally {
      await endStream(packagesStream);
    }

    // 3. Facts ------------------------------------------------------
    // Include ended facts for full history — round-trip restore should
    // reproduce the complete assertion/invalidation trail.
    const facts = await this.storage.queryFacts({
      projectId,
      includeEnded: true,
    });
    await writeNdjson(path.join(outDir, 'facts.ndjson'), facts as RelayFact[]);
    this.onProgress?.({ kind: 'facts_done', projectId, count: facts.length });

    // 4. Sessions ---------------------------------------------------
    const sessions = await this.storage.listSessions({ projectId });
    await writeNdjson(path.join(outDir, 'sessions.ndjson'), sessions as Session[]);
    this.onProgress?.({ kind: 'sessions_done', projectId, count: sessions.length });

    // 5. Backup manifest -------------------------------------------
    const manifest: BackupManifest = {
      tool_version: this.toolVersion,
      protocol_version: RELAY_PROTOCOL_VERSION,
      backup_format_version: BACKUP_FORMAT_VERSION,
      backup_generated_at: new Date().toISOString(),
      project_ids: [projectId],
      counts: {
        projects: 1,
        packages: packageCount,
        facts: facts.length,
        sessions: sessions.length,
        blobs_stored: blobCount,
        blobs_attempted: blobTotal,
      },
      blob_errors: blobErrors,
    };
    await fs.promises.writeFile(
      path.join(outDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );

    return {
      projectId,
      outDir,
      packageCount,
      factCount: facts.length,
      sessionCount: sessions.length,
      blobCount,
      blobTotal,
      blobErrors,
    };
  }

  /**
   * Back up every non-archived project into `<outDir>/<project_id>/`.
   * Writes a top-level `manifest.json` summarizing the whole run.
   */
  async backupAllProjects(opts: { outDir: string }): Promise<BackupAllResult> {
    const { outDir } = opts;
    await fs.promises.mkdir(outDir, { recursive: true });

    const projects = await this.storage.listProjects({ includeArchived: false });
    this.onProgress?.({ kind: 'projects_listed', count: projects.length });

    const perProject: BackupResult[] = [];
    const aggregateBlobErrors: BlobError[] = [];
    let totalPackages = 0;
    let totalFacts = 0;
    let totalSessions = 0;
    let totalBlobs = 0;
    let totalBlobsAttempted = 0;

    // One project must never take down the run. A single oversized or
    // transiently-unavailable project used to abort every project after it,
    // leaving a directory that looked plausible but was silently truncated.
    const failures: ProjectFailure[] = [];

    for (const project of projects) {
      const projectDir = path.join(outDir, project.id);
      try {
        const result = await this.backupProject({
          projectId: project.id,
          outDir: projectDir,
        });
        perProject.push(result);
        totalPackages += result.packageCount;
        totalFacts += result.factCount;
        totalSessions += result.sessionCount;
        totalBlobs += result.blobCount;
        totalBlobsAttempted += result.blobTotal;
        aggregateBlobErrors.push(...result.blobErrors);
      } catch (err) {
        const reason = (err as Error).message || 'unknown error';
        failures.push({ projectId: project.id, projectName: project.name, reason });
        this.onProgress?.({ kind: 'project_failed', projectId: project.id, reason });
      }
    }

    const topManifest: BackupManifest = {
      tool_version: this.toolVersion,
      protocol_version: RELAY_PROTOCOL_VERSION,
      backup_format_version: BACKUP_FORMAT_VERSION,
      backup_generated_at: new Date().toISOString(),
      // Only projects actually written are listed, so a partial snapshot
      // never claims coverage it does not have.
      project_ids: perProject.map((r) => r.projectId),
      counts: {
        projects: perProject.length,
        packages: totalPackages,
        facts: totalFacts,
        sessions: totalSessions,
        blobs_stored: totalBlobs,
        blobs_attempted: totalBlobsAttempted,
      },
      blob_errors: aggregateBlobErrors,
      failed_projects: failures,
      partial: failures.length > 0,
    };
    await fs.promises.writeFile(
      path.join(outDir, 'manifest.json'),
      JSON.stringify(topManifest, null, 2),
      'utf-8',
    );

    return { outDir, perProject, failures };
  }
}

/**
 * Transient-failure classifier. Postgres statement timeouts, upstream 5xx
 * (including Cloudflare 520-527 when the database is briefly unreachable),
 * and socket-level resets are worth retrying. Everything else — auth
 * failures, missing projects, malformed queries — is fatal and should
 * surface immediately rather than burn three attempts.
 */
function isTransientError(err: unknown): boolean {
  const msg = ((err as Error)?.message ?? String(err)).toLowerCase();
  return (
    msg.includes('statement timeout') ||
    msg.includes('canceling statement') ||
    msg.includes('timeout') ||
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('econnrefused') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    /5[0-9]{2}/.test(msg)
  );
}

const RETRY_ATTEMPTS = 4;
const RETRY_BASE_MS = 500;

/**
 * Retry `fn` with exponential backoff on transient failures. A multi-minute
 * export will eventually straddle a backend hiccup; without this, one blip
 * discards the whole run.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  onRetry?: (attempt: number, err: Error) => void,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === RETRY_ATTEMPTS || !isTransientError(err)) break;
      onRetry?.(attempt, err as Error);
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** (attempt - 1)));
    }
  }
  const detail = (lastErr as Error)?.message ?? String(lastErr);
  throw new Error(label + ': ' + detail);
}

/**
 * Stream a project's packages in `pageSize` chunks using a real LIMIT/OFFSET
 * cursor.
 *
 * The previous implementation issued a single `limit: 100_000` query and
 * sliced client-side. `select('*')` pulls the full `context_md` and
 * `context_snapshot` payloads, so once a project accumulated enough rows
 * that one statement exceeded the Postgres timeout, the export failed
 * outright — and because `backupAllProjects` had no isolation, a single
 * oversized project aborted every remaining one.
 *
 * Safety properties:
 *  - `seen` dedupes across pages, so a row shifting between pages (from a
 *    concurrent insert) can never be written twice.
 *  - If a page yields no unseen ids the cursor is not advancing — an adapter
 *    ignoring `offset` would otherwise loop forever — so we stop.
 */
async function streamPackages(
  storage: ReadOnlyRelayStorage,
  projectId: string,
  pageSize: number,
  onBatch: (batch: PackageRow[]) => Promise<void>,
  onRetry?: (attempt: number, err: Error) => void,
): Promise<void> {
  const seen = new Set<string>();
  let offset = 0;

  for (;;) {
    const page = await withRetry(
      () => storage.listPackages({ projectId, limit: pageSize, offset }),
      'Failed to list packages for ' + projectId + ' at offset ' + offset,
      onRetry,
    );
    if (page.length === 0) break;

    const fresh = page.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    // No new ids means the cursor stalled (adapter ignoring `offset`).
    if (fresh.length === 0) break;

    await onBatch(fresh);

    // A short page is the last page.
    if (page.length < pageSize) break;
    offset += page.length;
  }
}

async function writeNdjson(filePath: string, rows: unknown[]): Promise<void> {
  const stream = fs.createWriteStream(filePath, { encoding: 'utf-8' });
  try {
    await pipeline(
      (async function* () {
        for (const row of rows) {
          yield JSON.stringify(row) + '\n';
        }
      })(),
      stream as unknown as Writable,
    );
  } catch (err) {
    // Ensure the stream is closed even on pipeline error.
    stream.destroy();
    throw err;
  }
}

function endStream(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.once('finish', resolve);
    stream.end();
  });
}
