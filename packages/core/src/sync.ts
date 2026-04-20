/**
 * SyncService — incremental one-way sync between two `RelayStorage`
 * implementations.
 *
 * Typical usage:
 *   source = openStorage('config:', defaults)            // Supabase
 *   target = openStorage('sqlite:///./mirror.db')        // local
 *   new SyncService().sync({ source, target })            // catch-up mirror
 *
 * Algorithm per V02_PLAN §5:
 *   1. Project set: `--project` one, else source.listProjects({
 *      includeArchived: true }) so archived projects still round-trip.
 *   2. Cursor: max(target's latest package `created_at`, `--since`).
 *   3. Stream source.listPackages({projectId, sinceIso: cursor}):
 *        - target.getPackage(id) exists + created_at matches  →  skip.
 *        - else insertPackage(upsert: true) + putBlob if needed.
 *   4. Facts: source.queryFacts(includeEnded: true); drop rows whose
 *      id+valid_from+ended_at already match in target.
 *   5. Sessions: source.listSessions(projectId); drop by id match.
 *
 * One-directional per run. Reversing the `from`/`to` gives the opposite
 * direction. Bidirectional conflict resolution is deferred to v0.3.
 *
 * `--watch` mode keeps a persistent cursor in memory, re-polls at the
 * configured interval, and writes the cursor to `<targetHint>.sync-
 * cursor.json` sidecar on SIGINT so the next run can resume.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RelayStorage, PackageRow } from './storage/types.js';
import type { Project, RelayFact, Session } from './types.js';

export interface SyncOptions {
  source: RelayStorage;
  target: RelayStorage;
  /** Restrict to one project id. Else syncs every source project. */
  projectId?: string;
  /** ISO timestamp floor — applied on top of the per-project cursor. */
  sinceIso?: string;
  /** Parse + count only, write nothing. */
  dryRun?: boolean;
  /** Optional progress callback. */
  onProgress?: (event: SyncProgressEvent) => void;
}

export interface SyncCounts {
  packages_upserted: number;
  packages_skipped: number;
  blobs_copied: number;
  blobs_skipped: number;
  blobs_missing: number;
  facts_inserted: number;
  facts_skipped: number;
  sessions_inserted: number;
  sessions_skipped: number;
}

export interface SyncProjectResult {
  projectId: string;
  cursorIso: string | null;
  counts: SyncCounts;
}

export interface SyncResult {
  dryRun: boolean;
  perProject: SyncProjectResult[];
  totals: SyncCounts;
}

export type SyncProgressEvent =
  | { kind: 'project_start'; projectId: string; cursorIso: string | null }
  | { kind: 'project_done'; projectId: string; counts: SyncCounts }
  | { kind: 'package_upserted'; projectId: string; packageId: string }
  | { kind: 'blob_missing'; projectId: string; packageId: string; reason: string };

export class SyncService {
  async sync(opts: SyncOptions): Promise<SyncResult> {
    const { source, target } = opts;
    const dryRun = Boolean(opts.dryRun);

    const projects: Project[] = opts.projectId
      ? await resolveOneProject(source, opts.projectId)
      : await source.listProjects({ includeArchived: true });

    const perProject: SyncProjectResult[] = [];
    const totals = emptyCounts();

    for (const project of projects) {
      // Cursor: later of target's latest package created_at vs --since.
      const latest = await target.listPackages({ projectId: project.id, limit: 1 });
      const targetLatestIso = latest.length > 0 ? latest[0].created_at : null;
      let cursorIso: string | null = null;
      if (opts.sinceIso && targetLatestIso) {
        cursorIso = opts.sinceIso > targetLatestIso ? opts.sinceIso : targetLatestIso;
      } else {
        cursorIso = opts.sinceIso ?? targetLatestIso;
      }

      opts.onProgress?.({ kind: 'project_start', projectId: project.id, cursorIso });

      // Ensure the project row itself exists in target (getProject is
      // cheap; insert only when missing — matches restore's --skip default).
      const targetProject = await target.getProject(project.id);
      if (!targetProject && !dryRun) {
        await target.insertProject({
          id: project.id,
          name: project.name,
          description: project.description,
          owner_id: project.owner_id,
          settings: project.settings,
          archived_at: project.archived_at,
        });
      }

      const counts = emptyCounts();

      // --- Packages + blobs -----------------------------------------
      const sourcePackages: PackageRow[] = await source.listPackages({
        projectId: project.id,
        sinceIso: cursorIso ?? undefined,
      });
      // Sort ascending so parents land before children.
      sourcePackages.sort((a, b) => a.created_at.localeCompare(b.created_at));

      for (const row of sourcePackages) {
        const existing = await target.getPackage(row.id);
        if (existing && existing.created_at === row.created_at) {
          counts.packages_skipped += 1;
          continue;
        }
        if (!dryRun) {
          // Rewrite `storage_path` to the target adapter's canonical key.
          const targetKey = row.storage_path ? target.blobKeyFor(row.project_id, row.id) : null;
          await target.insertPackage({
            row: { ...row, storage_path: targetKey },
            upsert: true,
          });
        }
        counts.packages_upserted += 1;
        opts.onProgress?.({
          kind: 'package_upserted',
          projectId: project.id,
          packageId: row.id,
        });

        // Blob copy: only if source had one and target doesn't already.
        if (row.storage_path && typeof source.getBlob === 'function' && typeof target.putBlob === 'function') {
          const targetKey = target.blobKeyFor(row.project_id, row.id);
          const existingTargetBlob = await target.getBlob?.(targetKey);
          if (existingTargetBlob && existingTargetBlob.byteLength > 0) {
            counts.blobs_skipped += 1;
            continue;
          }
          try {
            const body = await source.getBlob(row.storage_path);
            if (!body) {
              counts.blobs_missing += 1;
              opts.onProgress?.({
                kind: 'blob_missing',
                projectId: project.id,
                packageId: row.id,
                reason: 'source blob not found',
              });
              continue;
            }
            if (!dryRun) {
              await target.putBlob(targetKey, body, 'application/zip');
            }
            counts.blobs_copied += 1;
          } catch (err) {
            counts.blobs_missing += 1;
            opts.onProgress?.({
              kind: 'blob_missing',
              projectId: project.id,
              packageId: row.id,
              reason: (err as Error).message,
            });
          }
        }
      }

      // --- Facts ----------------------------------------------------
      const sourceFacts: RelayFact[] = await source.queryFacts({
        projectId: project.id,
        includeEnded: true,
      });
      const cutoff = cursorIso;
      const filteredFacts = sourceFacts
        .filter((f) => !cutoff || f.valid_from >= cutoff)
        .sort((a, b) => a.valid_from.localeCompare(b.valid_from));

      for (const fact of filteredFacts) {
        // Cheap dedup: queryFacts with (subject, relation, object) and
        // check for matching id or valid_from/ended_at window.
        const matches = await target.queryFacts({
          projectId: project.id,
          subject: fact.subject,
          relation: fact.relation,
          object: fact.object,
          includeEnded: true,
          limit: 50,
        });
        const duplicate = matches.some(
          (m) =>
            m.id === fact.id ||
            (m.valid_from === fact.valid_from && (m.ended_at ?? null) === (fact.ended_at ?? null)),
        );
        if (duplicate) {
          counts.facts_skipped += 1;
          continue;
        }
        if (!dryRun) {
          try {
            await target.insertFact({
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
            });
          } catch {
            counts.facts_skipped += 1;
            continue;
          }
        }
        counts.facts_inserted += 1;
      }

      // --- Sessions -------------------------------------------------
      const sourceSessions: Session[] = await source.listSessions({ projectId: project.id });
      const filteredSessions = sourceSessions.filter(
        (s) => !cutoff || s.started_at >= cutoff,
      );
      const targetSessions = await target.listSessions({ projectId: project.id });
      const targetSessionIds = new Set(targetSessions.map((s) => s.id));

      for (const session of filteredSessions) {
        if (targetSessionIds.has(session.id)) {
          counts.sessions_skipped += 1;
          continue;
        }
        if (!dryRun) {
          try {
            await target.insertSession({
              id: session.id,
              project_id: session.project_id,
              actor_type: session.actor.type,
              actor_id: session.actor.id,
              agent_description: session.agent_description,
              packages_pulled: session.packages_pulled,
              packages_deposited: session.packages_deposited,
              started_at: session.started_at,
              ended_at: session.ended_at,
            });
          } catch {
            counts.sessions_skipped += 1;
            continue;
          }
        }
        counts.sessions_inserted += 1;
      }

      perProject.push({ projectId: project.id, cursorIso, counts });
      addCounts(totals, counts);
      opts.onProgress?.({ kind: 'project_done', projectId: project.id, counts });
    }

    return { dryRun, perProject, totals };
  }

  /**
   * Poll-based watch. Sleeps `intervalSec` between sync passes; persists
   * the per-project cursor map to `<sidecarPath>` on SIGINT so the next
   * `relay sync --watch` can resume. No realtime subscription — that's
   * v0.3 when both adapters advertise `realtime: true`.
   */
  async watch(opts: SyncOptions & {
    intervalSec: number;
    sidecarPath: string;
    onTick?: (result: SyncResult) => void;
  }): Promise<void> {
    let stop = false;
    const shutdown = () => {
      stop = true;
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    // eslint-disable-next-line no-constant-condition
    while (!stop) {
      const result = await this.sync(opts);
      opts.onTick?.(result);
      // Persist cursor sidecar after each pass for graceful resume.
      try {
        const cursors: Record<string, string | null> = {};
        for (const pr of result.perProject) cursors[pr.projectId] = pr.cursorIso;
        await fs.promises.mkdir(path.dirname(opts.sidecarPath), { recursive: true });
        await fs.promises.writeFile(
          opts.sidecarPath,
          JSON.stringify({ updated_at: new Date().toISOString(), cursors }, null, 2),
          'utf-8',
        );
      } catch {
        // non-fatal — cursor recovery is best-effort
      }
      if (stop) break;
      await sleep(opts.intervalSec * 1000);
    }
  }
}

async function resolveOneProject(source: RelayStorage, projectId: string): Promise<Project[]> {
  const p = await source.getProject(projectId);
  if (!p) {
    throw new Error(`sync: source does not have project ${projectId}`);
  }
  return [p];
}

function emptyCounts(): SyncCounts {
  return {
    packages_upserted: 0,
    packages_skipped: 0,
    blobs_copied: 0,
    blobs_skipped: 0,
    blobs_missing: 0,
    facts_inserted: 0,
    facts_skipped: 0,
    sessions_inserted: 0,
    sessions_skipped: 0,
  };
}

function addCounts(totals: SyncCounts, delta: SyncCounts): void {
  totals.packages_upserted += delta.packages_upserted;
  totals.packages_skipped += delta.packages_skipped;
  totals.blobs_copied += delta.blobs_copied;
  totals.blobs_skipped += delta.blobs_skipped;
  totals.blobs_missing += delta.blobs_missing;
  totals.facts_inserted += delta.facts_inserted;
  totals.facts_skipped += delta.facts_skipped;
  totals.sessions_inserted += delta.sessions_inserted;
  totals.sessions_skipped += delta.sessions_skipped;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
