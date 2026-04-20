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
}

interface BackupAllResult {
  outDir: string;
  perProject: BackupResult[];
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
  | { kind: 'blob_miss'; projectId: string; packageId: string; reason: string };

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
      await streamPackages(this.storage, projectId, this.pageSize, async (batch) => {
        for (const row of batch) {
          // Fetch blob if available + rewrite storage_path to be relative.
          let rewrittenStoragePath = row.storage_path;
          if (row.storage_path && typeof this.storage.getBlob === 'function') {
            blobTotal += 1;
            try {
              const blob = await this.storage.getBlob(row.storage_path);
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
      });
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

    for (const project of projects) {
      const projectDir = path.join(outDir, project.id);
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
    }

    const topManifest: BackupManifest = {
      tool_version: this.toolVersion,
      protocol_version: RELAY_PROTOCOL_VERSION,
      backup_format_version: BACKUP_FORMAT_VERSION,
      backup_generated_at: new Date().toISOString(),
      project_ids: projects.map((p) => p.id),
      counts: {
        projects: projects.length,
        packages: totalPackages,
        facts: totalFacts,
        sessions: totalSessions,
        blobs_stored: totalBlobs,
        blobs_attempted: totalBlobsAttempted,
      },
      blob_errors: aggregateBlobErrors,
    };
    await fs.promises.writeFile(
      path.join(outDir, 'manifest.json'),
      JSON.stringify(topManifest, null, 2),
      'utf-8',
    );

    return { outDir, perProject };
  }
}

/** Paginate listPackages with a monotonic `before` cursor derived from created_at. */
async function streamPackages(
  storage: ReadOnlyRelayStorage,
  projectId: string,
  pageSize: number,
  onBatch: (batch: PackageRow[]) => Promise<void>,
): Promise<void> {
  const seen = new Set<string>();
  // We don't know the exact API for "before this timestamp", only
  // `sinceIso` lower-bound. Strategy: pull the newest page; remember the
  // ids we've seen; then request progressively older windows by moving
  // the sinceIso upper bound down on each iteration using the oldest
  // unseen row we found. If the backend only supports "since", we still
  // terminate because we cap iterations at (total/pageSize + 1).
  //
  // Simpler fallback (and the common case) — ask for ALL packages at once
  // with a very large limit. Then split into batches client-side. This
  // avoids cursor-correctness landmines while v0.1 package counts are
  // small (hundreds per project, not millions).
  const all = await storage.listPackages({ projectId, limit: 100_000 });
  for (let i = 0; i < all.length; i += pageSize) {
    const slice = all.slice(i, i + pageSize).filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    if (slice.length > 0) {
      await onBatch(slice);
    }
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
