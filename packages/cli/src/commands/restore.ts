import { Command } from 'commander';
import * as path from 'node:path';
import {
  RelayClient,
  RestoreService,
  openStorage,
  type ConflictPolicy,
  type RestoreKind,
  type RestoreProgressEvent,
} from '@relay/core';

/**
 * `relay restore` — replay a backup directory into the configured
 * storage. Symmetric to `relay backup`.
 *
 * Exit codes match the V02_PLAN §3 contract:
 *   0 success
 *   1 validation / parse error (bad manifest, missing projects.ndjson, etc.)
 *   2 partial failure (inserted some rows but hit validation errors)
 *   3 target-storage error (e.g. unsupported `--to` URL scheme)
 *
 * Default conflict policy is `--skip`: restore is most commonly aimed at
 * an empty target, and collisions mean something unexpected about the
 * state. `--overwrite` upserts packages, `--rename` is a footgun that
 * breaks parent FKs (documented in RestoreService).
 */
export function restoreCommand(): Command {
  return new Command('restore')
    .description('Restore a Relay project from a backup directory (symmetric to relay backup)')
    .requiredOption('--from <path>', 'Backup directory (the one containing manifest.json)')
    .option('--project <id>', 'Restore only this project from a multi-project backup')
    .option('--overwrite', 'On id collision: upsert (packages) or note conflict (facts/sessions)')
    .option('--skip', 'On id collision: skip + record conflict (DEFAULT)')
    .option('--rename', 'On id collision: suffix id with _restored_<shortid> (footgun; breaks parent FKs)')
    .option('--dry-run', 'Parse + validate + count only, write nothing')
    .option('--since <iso>', 'Only rows with timestamp >= iso')
    .option('--only <kinds>', 'Comma-separated subset: packages,facts,sessions,blobs,embeddings,projects')
    .option('--no-blobs', 'Skip the blob upload phase (packages still insert)')
    .option('--no-embeddings', 'Skip embeddings restore')
    .option('--no-facts', 'Skip facts restore')
    .option('--no-sessions', 'Skip sessions restore')
    .option(
      '--to <storage-url>',
      'Target storage URL (config:, supabase://<url>#<key>, sqlite:///path). Default: configured storage.',
    )
    .action(async (opts) => {
      try {
        // --- Conflict policy -------------------------------------------
        const flags = [opts.overwrite, opts.skip, opts.rename].filter(Boolean).length;
        if (flags > 1) {
          console.error(`--overwrite, --skip, and --rename are mutually exclusive.`);
          process.exit(1);
        }
        const conflict: ConflictPolicy = opts.overwrite
          ? 'overwrite'
          : opts.rename
            ? 'rename'
            : 'skip';

        // --- --only parsing --------------------------------------------
        let only: RestoreKind[] | undefined;
        if (typeof opts.only === 'string' && opts.only.trim()) {
          const parts = opts.only
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
          const valid: RestoreKind[] = ['projects', 'packages', 'blobs', 'facts', 'embeddings', 'sessions'];
          const bad = parts.filter((p: string) => !valid.includes(p as RestoreKind));
          if (bad.length > 0) {
            console.error(
              `--only has unknown kinds: ${bad.join(', ')}. Valid: ${valid.join(', ')}`,
            );
            process.exit(1);
          }
          only = parts as RestoreKind[];
        }

        // --- Run --------------------------------------------------------
        const client = await RelayClient.fromConfig();

        // Target storage: --to <url> overrides the configured default.
        // Falls back to the RelayClient's own storage when --to is unset
        // or set to `config:`.
        let targetStorage = client.getStorage();
        if (opts.to && typeof opts.to === 'string' && opts.to !== 'config:') {
          try {
            targetStorage = await openStorage(opts.to, {
              core_url: client['config']?.core_url ?? '',
              api_key: client['config']?.api_key ?? '',
            });
          } catch (err) {
            console.error(`Target storage error: ${(err as Error).message}`);
            process.exit(3);
          }
        }

        const fromDir = path.resolve(opts.from);
        const service = new RestoreService(targetStorage);

        console.log(
          `${opts.dryRun ? '[DRY-RUN] ' : ''}Restoring from ${fromDir}${opts.project ? ` (project ${opts.project})` : ''} ...`,
        );

        const onProgress = (event: RestoreProgressEvent) => {
          switch (event.kind) {
            case 'manifest_loaded':
              console.log(
                `  manifest: ${event.projects} projects / ${event.packages} packages / ${event.facts} facts / ${event.sessions} sessions`,
              );
              break;
            case 'project_inserted':
              console.log(`  + project ${event.projectId}`);
              break;
            case 'project_skipped':
              console.log(`  ~ project ${event.projectId} (${event.reason})`);
              break;
            case 'packages_batch':
              console.log(
                `  packages ${event.projectId}: +${event.inserted} inserted, ${event.skipped} skipped`,
              );
              break;
            case 'blob_missing':
              console.log(`  ! blob ${event.packageId}: ${event.reason}`);
              break;
            case 'facts_done':
              console.log(
                `  facts ${event.projectId}: +${event.inserted}, ${event.skipped} skipped`,
              );
              break;
            case 'sessions_done':
              console.log(
                `  sessions ${event.projectId}: +${event.inserted}, ${event.skipped} skipped`,
              );
              break;
          }
        };

        const result = await service.restore({
          fromDir,
          projectId: opts.project,
          conflict,
          dryRun: Boolean(opts.dryRun),
          sinceIso: opts.since,
          only,
          skipBlobs: opts.blobs === false,
          skipEmbeddings: opts.embeddings === false,
          skipFacts: opts.facts === false,
          skipSessions: opts.sessions === false,
          onProgress,
        });

        // --- Summary ---------------------------------------------------
        const prefix = result.dryRun ? 'would restore' : 'restored';
        console.log('');
        console.log(
          `${prefix}: ${result.inserted.projects} projects, ${result.inserted.packages} packages, ` +
            `${result.inserted.blobs} blobs, ${result.inserted.facts} facts, ` +
            `${result.inserted.sessions} sessions` +
            (result.inserted.embeddings ? `, ${result.inserted.embeddings} embeddings` : ''),
        );
        console.log(
          `skipped: ${result.skipped.projects} projects, ${result.skipped.packages} packages, ` +
            `${result.skipped.facts} facts, ${result.skipped.sessions} sessions` +
            (result.skipped.blobs ? `, ${result.skipped.blobs} blob writes` : ''),
        );

        if (result.conflicts.length > 0) {
          console.log('');
          console.log(`conflicts (${result.conflicts.length}):`);
          for (const c of result.conflicts.slice(0, 10)) {
            console.log(`  - ${c.kind} ${c.id}: ${c.reason}`);
          }
          if (result.conflicts.length > 10) {
            console.log(`  ... (${result.conflicts.length - 10} more)`);
          }
        }

        if (result.blobErrors.length > 0) {
          console.log('');
          console.log(`blob errors (${result.blobErrors.length}):`);
          for (const b of result.blobErrors.slice(0, 5)) {
            console.log(`  - ${b.packageId}: ${b.reason}`);
          }
        }

        if (result.validationErrors.length > 0) {
          console.log('');
          console.log(`validation errors (${result.validationErrors.length}):`);
          for (const msg of result.validationErrors.slice(0, 10)) {
            console.log(`  - ${msg}`);
          }
          console.error(`\u2717 Restore completed with validation errors.`);
          process.exit(2);
        }

        console.log(result.dryRun ? '\n\u2713 Dry-run clean.' : '\n\u2713 Restore complete.');
      } catch (err) {
        console.error(`Restore failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
