import { Command } from 'commander';
import { RelayClient, type ResumableSession } from '@relay/core';

function printSessions(list: ResumableSession[]): void {
  if (list.length === 0) {
    console.log('No resumable sessions found.');
    return;
  }
  for (const s of list) {
    const tx = s.hasTranscript ? 'restorable' : 'session-id only';
    const host = s.originHost ? ` @${s.originHost}` : '';
    const score = s.similarity != null ? ` (${(s.similarity * 100).toFixed(0)}%)` : '';
    console.log(`\n${s.title}${score}`);
    console.log(`  session: ${s.sessionId}${host} — ${tx}`);
    console.log(`  ${s.createdAt}`);
    console.log(`  ${s.restoreCommand}`);
  }
}

export function sessionsCommand(): Command {
  const cmd = new Command('sessions').description('List or find resumable Claude Code sessions');

  cmd
    .command('list')
    .description('List recent resumable sessions for a project')
    .option('--project <id>', 'Project id (defaults to the CWD-mapped project)')
    .option('--limit <n>', 'Max sessions', '20')
    .action(async (opts: { project?: string; limit: string }) => {
      try {
        const client = await RelayClient.fromConfig();
        const projectId = client.resolveDepositTargetProject(opts.project);
        if (!projectId) {
          console.error('No project resolved. Pass --project <id>.');
          process.exit(1);
        }
        printSessions(await client.listResumableSessions(projectId, parseInt(opts.limit, 10)));
      } catch (err) {
        console.error(`sessions list failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  cmd
    .command('find')
    .description('Find the session that worked on a topic ("the shell we used for Y")')
    .argument('<query...>', 'Topic to search for')
    .option('--project <id>', 'Limit to a project')
    .option('--limit <n>', 'Max results', '10')
    .action(async (queryParts: string[], opts: { project?: string; limit: string }) => {
      try {
        const client = await RelayClient.fromConfig();
        const list = await client.findResumableSessions(
          queryParts.join(' '),
          opts.project,
          parseInt(opts.limit, 10),
        );
        printSessions(list);
      } catch (err) {
        console.error(`sessions find failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return cmd;
}
