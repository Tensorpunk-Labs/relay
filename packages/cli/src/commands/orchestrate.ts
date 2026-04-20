import { Command } from 'commander';
import { RelayClient } from '@relay/core';
import { assembleProjectDigest, assembleGlobalDigest } from '@relay/orchestrator';

export function orchestrateCommand(): Command {
  return new Command('orchestrate')
    .description('Assemble project context for synthesis (output to stdout for agent consumption)')
    .option('--project <id>', 'Project ID (omit for global digest across all projects)')
    .option('--focus <topic>', 'Focus on specific area')
    .option('--snippets <count>', 'Number of semantic search snippets to include (default: 25)', '25')
    .option('-a, --include-archived', 'For global digest: include archived projects')
    .action(async (opts) => {
      const client = await RelayClient.fromConfig();
      const snippetCount = parseInt(opts.snippets, 10);

      if (opts.project) {
        const result = await assembleProjectDigest(client, opts.project, opts.focus, snippetCount);
        console.log(result.assembledContext);
        console.error(`\n[${result.packagesAnalyzed} packages, ${result.decisionsLogged} decisions, ${result.openQuestionsFound} open questions, ${snippetCount} semantic snippets requested]`);
      } else {
        const results = await assembleGlobalDigest(client, opts.focus, snippetCount, {
          includeArchived: Boolean(opts.includeArchived),
        });

        if (results.length === 0) {
          console.log('No packages found across any project.');
          return;
        }

        for (const { projectId, digest } of results) {
          console.log(`\n${'='.repeat(60)}`);
          console.log(`PROJECT: ${projectId}`);
          console.log('='.repeat(60));
          console.log(digest.assembledContext);
        }
      }
    });
}
