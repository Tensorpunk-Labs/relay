import { Command } from 'commander';
import * as path from 'node:path';
import {
  RelayClient,
  SyncService,
  openStorage,
  type SyncProgressEvent,
  type SyncResult,
} from '@relay/core';

/**
 * `relay sync` — incremental one-way mirror between two storages.
 *
 * Typical usage:
 *   relay sync --from config: --to sqlite:///./mirror.db
 *   relay sync --from config: --to sqlite:///./mirror.db --watch
 *
 * The source / target URLs accept the same scheme set as
 * `relay restore --to`: `config:`, `supabase://<host>#<key>`, or
 * `sqlite:///<path>`. A `config:` URL resolves to the adapter named
 * by `~/.relay/config.json` (typically SupabaseStorage).
 *
 * Exit codes:
 *   0 success
 *   1 validation (missing --from/--to, unknown scheme)
 *   3 target storage error (e.g. SQLite URL without registerSqliteFactory)
 */
export function syncCommand(): Command {
  return new Command('sync')
    .description('Incrementally sync one Relay storage into another (one-way)')
    .requiredOption('--from <url>', 'Source storage URL')
    .requiredOption('--to <url>', 'Target storage URL')
    .option('--project <id>', 'Sync only this project')
    .option('--since <iso>', 'Lower bound on row timestamps (ISO-8601)')
    .option('--dry-run', 'Count what would move; write nothing')
    .option('--watch', 'Poll-based live sync — keeps running, one pass per interval')
    .option('--interval <seconds>', 'Poll interval for --watch (default 30)', '30')
    .action(async (opts) => {
      try {
        // Pull Supabase defaults from the configured client so `config:`
        // resolves consistently on both sides.
        const client = await RelayClient.fromConfig();
        const defaults = {
          core_url: client['config']?.core_url ?? '',
          api_key: client['config']?.api_key ?? '',
        };

        const source = await openStorage(opts.from, defaults);
        const target = await openStorage(opts.to, defaults);

        const service = new SyncService();

        const onProgress = (event: SyncProgressEvent) => {
          switch (event.kind) {
            case 'project_start':
              console.log(
                `  sync ${event.projectId} (cursor: ${event.cursorIso ?? 'beginning'})`,
              );
              break;
            case 'package_upserted':
              // Too chatty for normal runs — only print when --watch is
              // off. `--watch` noise is per-tick summary below.
              if (!opts.watch) console.log(`    + ${event.packageId}`);
              break;
            case 'blob_missing':
              console.log(`    ! blob ${event.packageId}: ${event.reason}`);
              break;
            case 'project_done':
              console.log(
                `  ${event.projectId}: ${event.counts.packages_upserted}p + ${event.counts.blobs_copied}b + ${event.counts.facts_inserted}f + ${event.counts.sessions_inserted}s`,
              );
              break;
          }
        };

        const baseOpts = {
          source,
          target,
          projectId: opts.project,
          sinceIso: opts.since,
          dryRun: Boolean(opts.dryRun),
          onProgress,
        };

        if (opts.watch) {
          const intervalSec = parseInt(opts.interval, 10) || 30;
          if (intervalSec < 5) {
            console.error('--interval must be >= 5 seconds to avoid rate-limiting source storage.');
            process.exit(1);
          }
          const sidecar =
            opts.to.startsWith('sqlite://')
              ? path.resolve(
                  opts.to.replace(/^sqlite:\/+/, '').replace(/^([a-zA-Z])\//, '$1:/'),
                ) + '.sync-cursor.json'
              : path.resolve('./.relay-sync-cursor.json');

          console.log(
            `${opts.dryRun ? '[DRY-RUN] ' : ''}Watching: sync every ${intervalSec}s. Ctrl-C to stop. Cursor sidecar: ${sidecar}`,
          );
          await service.watch({
            ...baseOpts,
            intervalSec,
            sidecarPath: sidecar,
            onTick: (result: SyncResult) => {
              const t = result.totals;
              console.log(
                `  tick: +${t.packages_upserted}p / +${t.blobs_copied}b / +${t.facts_inserted}f / +${t.sessions_inserted}s (skipped ${t.packages_skipped}p/${t.blobs_skipped}b/${t.facts_skipped}f/${t.sessions_skipped}s)`,
              );
            },
          });
        } else {
          console.log(`${opts.dryRun ? '[DRY-RUN] ' : ''}Syncing ${opts.from} -> ${opts.to} ...`);
          const result = await service.sync(baseOpts);
          console.log('');
          console.log(
            `${result.dryRun ? 'would sync' : 'synced'} ${result.perProject.length} project(s):`,
          );
          for (const pr of result.perProject) {
            const c = pr.counts;
            console.log(
              `  ${pr.projectId}: +${c.packages_upserted}p / +${c.blobs_copied}b / +${c.facts_inserted}f / +${c.sessions_inserted}s (skipped ${c.packages_skipped}p/${c.blobs_skipped}b/${c.facts_skipped}f/${c.sessions_skipped}s, ${c.blobs_missing} missing blobs)`,
            );
          }
          const t = result.totals;
          console.log('');
          console.log(
            `totals: +${t.packages_upserted} pkgs, +${t.blobs_copied} blobs, +${t.facts_inserted} facts, +${t.sessions_inserted} sessions`,
          );
          console.log(result.dryRun ? '\u2713 Dry-run clean.' : '\u2713 Sync complete.');
        }
      } catch (err) {
        console.error(`Sync failed: ${(err as Error).message}`);
        process.exit(err instanceof Error && /requires registerSqliteFactory/i.test(err.message) ? 3 : 1);
      }
    });
}
