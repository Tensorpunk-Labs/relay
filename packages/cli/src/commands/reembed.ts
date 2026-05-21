import { Command } from 'commander';
import { RelayClient, generateAndStoreEmbeddings, generateContextMd } from '@relay/core';

/**
 * `relay reembed` — backfill / rebuild package embeddings.
 *
 * Why this exists: embeddings are generated AT deposit time from a snapshot
 * of context_md as it looked then. When generateContextMd evolves (e.g. the
 * context_snapshot heavyweights section was added), existing packages don't
 * automatically pick up the new searchable text. This command iterates
 * packages, rebuilds context_md from each manifest, deletes the existing
 * embedding rows, and re-inserts fresh vectors.
 *
 * Defaults are deliberately narrow — single project, with-snapshot only —
 * so an accidental invocation doesn't churn the whole DB.
 *
 *   relay reembed --project <id>            # all packages in one project
 *   relay reembed --project <id> --since 14d
 *   relay reembed --all-projects            # full sweep, requires confirm
 *   relay reembed --dry-run                 # show counts, write nothing
 *   relay reembed --only-with-snapshot      # default ON; pass --no-only-with-snapshot to widen
 *
 * Best-effort: per-package failures are logged and the next package
 * continues — partial completion is better than aborting on first error.
 */
export function reembedCommand(): Command {
  return new Command('reembed')
    .description('Rebuild package embeddings from current context_md generation. Use after a generateContextMd change to backfill existing packages.')
    .option('--project <id>', 'Limit to one project (preferred default)')
    .option('--all-projects', 'Sweep across every non-archived project (heavier; requires --yes to confirm)')
    .option('--yes', 'Confirm --all-projects without an interactive prompt')
    .option('--since <duration>', 'Only packages created on/after this point. e.g. "14d", "2026-01-01", or an ISO timestamp')
    .option('--limit <n>', 'Cap packages per project (useful for spot-checks)', parseIntOpt)
    .option('--only-with-snapshot', 'Only reembed packages that carry a context_snapshot (default ON — the v0.1 -> v0.2 backfill case)', true)
    .option('--no-only-with-snapshot', 'Disable the only-with-snapshot filter — process every package')
    .option('--dry-run', 'Print counts and the first few package titles; write nothing')
    .action(async (opts) => {
      try {
        const client = await RelayClient.fromConfig();
        const storage = (client as unknown as { storage: { deleteEmbeddings?: (id: string) => Promise<void>; insertEmbeddings: unknown; listPackages: (q: { projectId: string; limit?: number; sinceIso?: string }) => Promise<Array<{ id: string; title: string; manifest: unknown; context_snapshot?: unknown }>> } }).storage;

        if (typeof storage.deleteEmbeddings !== 'function') {
          console.error('[reembed] The configured storage adapter does not support deleteEmbeddings. Reembed requires a Supabase-backed deployment.');
          process.exit(1);
        }

        // Resolve project set
        let projectIds: string[] = [];
        if (opts.project) {
          projectIds = [opts.project];
        } else if (opts.allProjects) {
          if (!opts.yes && !opts.dryRun) {
            console.error('[reembed] --all-projects rewrites every embedding row across every active project.');
            console.error('[reembed] Re-run with --yes to confirm, or --dry-run to preview counts.');
            process.exit(1);
          }
          const projs = await client.listProjects({ includeArchived: false });
          projectIds = projs.map((p) => p.id);
        } else {
          console.error('[reembed] Specify --project <id> or --all-projects.');
          process.exit(1);
        }

        const sinceIso = parseSince(opts.since);
        const limit = typeof opts.limit === 'number' ? opts.limit : undefined;
        const onlyWithSnapshot = opts.onlyWithSnapshot !== false;

        let totalConsidered = 0;
        let totalEligible = 0;
        let totalReembedded = 0;
        let totalFailed = 0;

        for (const pid of projectIds) {
          const packages = await storage.listPackages({ projectId: pid, limit, sinceIso });
          totalConsidered += packages.length;

          const eligible = packages.filter((p) => {
            if (!onlyWithSnapshot) return true;
            return !!(p.manifest as { context_snapshot?: unknown })?.context_snapshot || !!p.context_snapshot;
          });
          totalEligible += eligible.length;

          if (opts.dryRun) {
            const preview = eligible.slice(0, 5).map((p) => `  - ${p.id.slice(0, 18)}  ${truncate(p.title, 70)}`).join('\n');
            console.log(`[reembed] ${pid}: ${eligible.length}/${packages.length} eligible${preview ? '\n' + preview : ''}`);
            continue;
          }

          for (const pkg of eligible) {
            try {
              const manifest = pkg.manifest as Parameters<typeof generateContextMd>[0];
              const contextMd = generateContextMd(manifest);
              await storage.deleteEmbeddings!(pkg.id);
              const count = await generateAndStoreEmbeddings(
                storage as unknown as Parameters<typeof generateAndStoreEmbeddings>[0],
                manifest,
                contextMd,
              );
              totalReembedded += 1;
              process.stdout.write(`. (${count}c) `);
              if (totalReembedded % 10 === 0) process.stdout.write('\n');
            } catch (e) {
              totalFailed += 1;
              console.error(`\n[reembed] FAIL ${pkg.id}: ${(e as Error).message}`);
            }
          }
        }

        console.log('');
        console.log(`[reembed] considered:  ${totalConsidered}`);
        console.log(`[reembed] eligible:    ${totalEligible}`);
        if (opts.dryRun) {
          console.log('[reembed] dry-run — nothing written.');
        } else {
          console.log(`[reembed] reembedded:  ${totalReembedded}`);
          if (totalFailed > 0) console.log(`[reembed] failed:      ${totalFailed}`);
        }
      } catch (e) {
        console.error(`[reembed] aborted: ${(e as Error).message}`);
        process.exit(1);
      }
    });
}

function parseIntOpt(v: string): number {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--limit must be a positive integer (got ${v})`);
  return n;
}

/**
 * Parse the --since flag. Accepts:
 *   - durations like "14d", "30d", "7d"
 *   - YYYY-MM-DD calendar dates
 *   - full ISO timestamps
 * Returns an ISO string, or undefined if --since was not given.
 */
function parseSince(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const durMatch = /^(\d+)d$/.exec(s);
  if (durMatch) {
    const days = parseInt(durMatch[1], 10);
    return new Date(Date.now() - days * 86_400_000).toISOString();
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`--since: unparseable value "${s}". Use "14d", a YYYY-MM-DD date, or an ISO timestamp.`);
  }
  return d.toISOString();
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}
