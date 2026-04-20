import { Command } from 'commander';
import { RelayClient } from '@relay/core';

/**
 * `relay facts` — assert / invalidate / query mutable facts on the
 * project whiteboard.
 *
 * The whiteboard sits alongside the immutable context_packages journal:
 * packages are the historical reasoning trail, facts are the supersedable
 * current truth. See migration 004_facts.sql and pkg_f7b1a8d6.
 */
export function factsCommand(): Command {
  const cmd = new Command('facts').description('Manage mutable facts (the project whiteboard)');

  cmd
    .command('assert')
    .description('Assert a (subject, relation, object) fact. Auto-supersedes any existing active fact with the same (subject, relation).')
    .argument('<subject>', 'free-form subject (e.g. "session_start_hook", "kai", "relay-dashboard")')
    .argument('<relation>', 'free-form relation (e.g. "installed", "works_on", "font")')
    .argument('<object>', 'free-form object (e.g. "true", "orion", "JetBrains Mono")')
    .option('--source <pkg_id>', 'optional package this fact was derived from')
    .option('--project <id>', 'project ID (omit to use default)')
    .action(async (subject, relation, object, opts) => {
      const client = await RelayClient.fromConfig();
      const fact = await client.assertFact({
        subject,
        relation,
        object,
        sourcePackageId: opts.source,
        projectId: opts.project,
      });
      console.log(`asserted: ${fact.subject} ${fact.relation} ${fact.object}`);
      console.log(`  id:    ${fact.id}`);
      console.log(`  since: ${fact.valid_from}`);
    });

  cmd
    .command('invalidate')
    .description('Mark active facts as ended. If no object is given, all active (subject, relation) facts are ended.')
    .argument('<subject>')
    .argument('<relation>')
    .argument('[object]', 'optional — if provided, only this exact triple is invalidated')
    .option('--project <id>', 'project ID (omit to use default)')
    .action(async (subject, relation, object, opts) => {
      const client = await RelayClient.fromConfig();
      const count = await client.invalidateFact({
        subject,
        relation,
        object,
        projectId: opts.project,
      });
      console.log(`invalidated ${count} fact${count === 1 ? '' : 's'}`);
    });

  cmd
    .command('query')
    .description('Query facts. Default returns currently-active facts only.')
    .option('--subject <s>', 'filter by subject')
    .option('--relation <r>', 'filter by relation')
    .option('--object <o>', 'filter by object')
    .option('--as-of <iso>', 'time-travel: facts active at this ISO timestamp')
    .option('--include-ended', 'also return ended facts')
    .option('--limit <n>', 'cap result count', (v) => parseInt(v, 10))
    .option('--project <id>', 'project ID (omit to use default)')
    .option('--json', 'emit JSON instead of formatted lines')
    .action(async (opts) => {
      const client = await RelayClient.fromConfig();
      const facts = await client.queryFacts({
        subject: opts.subject,
        relation: opts.relation,
        object: opts.object,
        asOf: opts.asOf,
        includeEnded: opts.includeEnded,
        limit: opts.limit,
        projectId: opts.project,
      });
      if (opts.json) {
        console.log(JSON.stringify(facts, null, 2));
        return;
      }
      if (facts.length === 0) {
        console.log('(no facts)');
        return;
      }
      for (const f of facts) {
        const status = f.ended_at ? `ended ${f.ended_at}` : 'active';
        console.log(`${f.subject} ${f.relation} ${f.object}  [${status}]`);
        console.log(`  id: ${f.id}  since: ${f.valid_from}`);
      }
    });

  return cmd;
}
