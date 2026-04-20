import { Command } from 'commander';
import * as path from 'node:path';
import { RelayClient, BackupService, type BackupProgressEvent } from '@relay/core';

/**
 * `relay backup` — read-only export of a Relay project (or all projects)
 * into a self-contained directory of NDJSON + blobs.
 *
 * This is the first feature that exercises the `RelayStorage` contract.
 * It makes zero writes against the database; every call path is a SELECT
 * or a Storage download.
 */
export function backupCommand(): Command {
  return new Command('backup')
    .description('Export a project (or all projects) to a local backup directory')
    .option('--project <id>', 'Project ID to back up (defaults to CWD mapping)')
    .option('--out <path>', 'Output directory (default: ./relay-backup-<iso>/)')
    .option('--all-projects', 'Back up every non-archived project')
    .action(async (opts) => {
      try {
        const client = await RelayClient.fromConfig();

        const outDir = resolveOutDir(opts.out);

        // Progress callback prints one line per completed project; batches
        // are quiet so the output stays readable even for large projects.
        const progress: Record<string, { packages: number }> = {};
        const onProgress = (event: BackupProgressEvent) => {
          if (event.kind === 'packages_batch') {
            progress[event.projectId] = { packages: event.cumulative };
          }
        };

        const backup = new BackupService(client, { onProgress });

        if (opts.allProjects) {
          console.log(`Backing up ALL non-archived projects to ${outDir} ...`);
          const result = await backup.backupAllProjects({ outDir });
          for (const pr of result.perProject) {
            console.log(
              `  ${pr.projectId}: ${pr.packageCount} packages, ${pr.factCount} facts, ${pr.sessionCount} sessions, ${pr.blobCount}/${pr.blobTotal} blobs.`,
            );
            if (pr.blobErrors.length > 0) {
              console.log(`    (${pr.blobErrors.length} blob errors)`);
            }
          }
          const totalPackages = result.perProject.reduce((a, b) => a + b.packageCount, 0);
          const totalFacts = result.perProject.reduce((a, b) => a + b.factCount, 0);
          const totalSessions = result.perProject.reduce((a, b) => a + b.sessionCount, 0);
          const totalBlobs = result.perProject.reduce((a, b) => a + b.blobCount, 0);
          const totalBlobsAttempted = result.perProject.reduce((a, b) => a + b.blobTotal, 0);
          console.log('');
          console.log(`Backup written to ${outDir}`);
          console.log(
            `Totals: ${result.perProject.length} projects, ${totalPackages} packages, ${totalFacts} facts, ${totalSessions} sessions, ${totalBlobs}/${totalBlobsAttempted} blobs.`,
          );
          console.log(`\u2713 Backup complete.`);
          return;
        }

        const projectId = opts.project || client.resolveProjectFromCwd();
        if (!projectId) {
          const cwd = process.cwd().replace(/\\/g, '/');
          console.error(`[Relay] No project mapped for ${cwd}. Pass --project <id> or --all-projects.`);
          console.error(`[Relay] To register: relay projects create "Name" --description "..." then add path to ~/.relay/config.json project_paths`);
          process.exit(1);
        }

        console.log(`Backing up ${projectId} to ${outDir} ...`);
        const result = await backup.backupProject({ projectId, outDir });
        console.log(
          `  done (${result.packageCount} packages, ${result.factCount} facts, ${result.sessionCount} sessions, ${result.blobCount}/${result.blobTotal} blobs).`,
        );
        if (result.blobErrors.length > 0) {
          console.log(`  ${result.blobErrors.length} blob errors — see manifest.json.`);
          for (const err of result.blobErrors.slice(0, 5)) {
            console.log(`    - ${err.packageId}: ${err.reason}`);
          }
          if (result.blobErrors.length > 5) {
            console.log(`    ... (${result.blobErrors.length - 5} more)`);
          }
        }
        console.log('');
        console.log(`Backup written to ${outDir}`);
        console.log(`\u2713 Backup complete.`);
      } catch (err) {
        console.error(`Backup failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

/**
 * Default output directory uses an ISO timestamp with `-` instead of `:`
 * so it's a valid filename on Windows. Trailing `Z` is preserved, and we
 * drop the fractional seconds to keep paths short.
 */
function resolveOutDir(explicit: string | undefined): string {
  if (explicit) return path.resolve(explicit);
  const iso = new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}/, '');
  return path.resolve(`./relay-backup-${iso}`);
}
