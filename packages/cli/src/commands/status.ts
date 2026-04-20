import { Command } from 'commander';
import { RelayClient } from '@relay/core';

export function statusCommand(): Command {
  return new Command('status')
    .description('Show project status overview')
    .option('--project <id>', 'Project ID')
    .action(async (opts) => {
      const client = await RelayClient.fromConfig();
      const packages = await client.getLatestPackages(opts.project, 10);

      console.log(`\nRecent packages (${packages.length}):`);
      for (const pkg of packages) {
        console.log(`  [${pkg.status}] ${pkg.package_id} — ${pkg.title}`);
      }

      const pendingReview = packages.filter((p) => p.status === 'pending_review');
      if (pendingReview.length > 0) {
        console.log(`\nPending review: ${pendingReview.length}`);
      }

      const openQuestions = packages.flatMap((p) => p.open_questions);
      if (openQuestions.length > 0) {
        console.log(`\nOpen questions: ${openQuestions.length}`);
        for (const q of openQuestions.slice(0, 5)) {
          console.log(`  ? ${q}`);
        }
      }
    });
}
