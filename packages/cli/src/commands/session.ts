import { Command } from 'commander';
import { RelayClient, SessionManager } from '@relay/core';

export function sessionCommand(): Command {
  const cmd = new Command('session').description('Manage Relay sessions');

  cmd
    .command('start')
    .description('Start a new session, register with Context Core')
    .option('--project <id>', 'Project ID')
    .option('--description <desc>', 'Description of this agent/session')
    .action(async (opts) => {
      const sm = new SessionManager();
      if (sm.hasActiveSession()) {
        const existing = sm.getSession()!;
        console.error(`Session already active: ${existing.session_id}`);
        console.error('Run "relay session end" first.');
        process.exit(1);
      }

      const client = await RelayClient.fromConfig();
      const session = await client.startSession(opts.project, opts.description);

      sm.startSession({
        session_id: session.id,
        project_id: session.project_id,
        actor_id: 'jordan',
        actor_type: 'human',
        started_at: session.started_at,
        packages_pulled: [],
        packages_deposited: [],
        parent_package_id: null,
      });

      console.log(`Session started: ${session.id}`);
      console.log(`Project: ${session.project_id}`);
    });

  cmd
    .command('end')
    .description('End current session')
    .action(async () => {
      const sm = new SessionManager();
      const session = sm.getSession();
      if (!session) {
        console.error('No active session.');
        process.exit(1);
      }

      const client = await RelayClient.fromConfig();
      await client.endSession(session.session_id);
      sm.endSession();

      console.log(`Session ended: ${session.session_id}`);
      console.log(`Packages deposited: ${session.packages_deposited.length}`);
    });

  cmd
    .command('status')
    .description('Show current session info')
    .action(async () => {
      const sm = new SessionManager();
      const session = sm.getSession();
      if (!session) {
        console.log('No active session.');
        return;
      }

      console.log(`Session: ${session.session_id}`);
      console.log(`Project: ${session.project_id}`);
      console.log(`Actor: ${session.actor_type}/${session.actor_id}`);
      console.log(`Started: ${session.started_at}`);
      console.log(`Packages pulled: ${session.packages_pulled.length}`);
      console.log(`Packages deposited: ${session.packages_deposited.length}`);
      if (session.parent_package_id) {
        console.log(`Last deposit: ${session.parent_package_id}`);
      }
    });

  return cmd;
}
