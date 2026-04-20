import { Command } from 'commander';

export function diffCommand(): Command {
  return new Command('diff')
    .description('Show context diff between packages')
    .argument('[from_id]', 'Source package ID')
    .argument('[to_id]', 'Target package ID')
    .option('--latest', 'Diff current state against last deposit')
    .action(async (fromId, toId, opts) => {
      // TODO: Implement diff retrieval from Context Core
      if (opts.latest) {
        console.log('TODO: Diff current state against last deposit');
        return;
      }
      console.log(`TODO: Diff ${fromId} → ${toId}`);
    });
}
