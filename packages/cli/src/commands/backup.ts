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
          } else if (event.kind === 'project_done') {
            // Emit as each project lands so a long --all-projects run is
            // observably alive rather than silent until the final summary.
            console.log(
              '  ✓ ' + event.projectId + ' (' + event.packages + ' packages, ' +
                event.blobs + ' blobs)',
            );
          } else if (event.kind === 'retry') {
            console.log(
              '  ~ ' + event.projectId + ': transient failure (attempt ' +
                event.attempt + '), retrying — ' + event.reason,
            );
          } else if (event.kind === 'project_failed') {
            console.error('  ! ' + event.projectId + ': FAILED — ' + event.reason);
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
          // A partial export must never look like a clean one. Report the
          // failed projects and exit non-zero so unattended schedulers and
          // CI treat it as the failure it is.
          if (result.failures.length > 0) {
            const total = result.failures.length + result.perProject.length;
            console.error("");
            console.error(
              "✗ PARTIAL BACKUP — " + result.failures.length + " of " + total +
                " projects failed:",
            );
            for (const f of result.failures) {
              console.error(
                "    - " + (f.projectName ?? f.projectId) + " (" + f.projectId + "): " + f.reason,
              );
            }
            console.error("");
            console.error("manifest.json is marked \"partial\": true and lists only the");
            console.error("projects actually written. Re-run to retry the failures.");
            process.exit(1);
          }

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
