import { Command } from 'commander';
import { RelayClient, AlreadyInStateError, MetaProjectGuardError } from '@relay/core';

// ANSI helpers — we dim archived rows in `list -a` output. Kept inline
// to avoid a chalk dependency for something this small.
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function formatArchivedDate(iso: string): string {
  // YYYY-MM-DD for the list suffix.
  return iso.slice(0, 10);
}

export function projectsCommand(): Command {
  const cmd = new Command('projects').description('Manage Relay projects');

  cmd
    .command('list')
    .description('List projects you have access to')
    .option('-a, --include-archived', 'Include archived projects (rendered dim)')
    .action(async (opts) => {
      const client = await RelayClient.fromConfig();
      const projects = await client.listProjects({
        includeArchived: Boolean(opts.includeArchived),
      });
      // Sort: active first, then archived by most-recently archived first.
      const active = projects.filter((p) => !p.archived_at);
      const archived = projects
        .filter((p) => !!p.archived_at)
        .sort((a, b) => (b.archived_at ?? '').localeCompare(a.archived_at ?? ''));

      for (const proj of active) {
        console.log(`  ${proj.id} — ${proj.name}`);
      }
      for (const proj of archived) {
        const date = proj.archived_at ? formatArchivedDate(proj.archived_at) : '';
        console.log(`${DIM}  ${proj.id} — ${proj.name} [archived ${date}]${RESET}`);
      }
    });

  cmd
    .command('create')
    .description('Create a new project')
    .argument('<name>', 'Project name')
    .option('--description <desc>', 'Project description')
    .action(async (name, opts) => {
      const client = await RelayClient.fromConfig();
      const project = await client.createProject(name, opts.description);
      console.log(`Created: ${project.id} — ${project.name}`);
    });

  cmd
    .command('info')
    .description('Show project details')
    .argument('[id]', 'Project ID')
    .action(async (id) => {
      const client = await RelayClient.fromConfig();
      const project = await client.getProject(id || '');
      if (project) {
        console.log(JSON.stringify(project, null, 2));
      } else {
        console.error('Project not found');
      }
    });

  cmd
    .command('archive')
    .description('Archive a project (soft; can be restored). Deposits to archived projects are skipped.')
    .argument('<id>', 'Project ID to archive')
    .option('--force', 'Override meta-project guard (needed for proj_dev_relay or settings.meta=true)')
    .action(async (id, opts) => {
      const client = await RelayClient.fromConfig();
      try {
        const project = await client.archiveProject(id, { force: Boolean(opts.force) });
        console.log(
          `Archived: ${project.id} — ${project.name} (at ${project.archived_at})`,
        );
        console.log(
          `Deposits to this project will be skipped. Run \`relay projects restore ${project.id}\` to undo.`,
        );
      } catch (err) {
        if (err instanceof AlreadyInStateError) {
          const p = err.project;
          console.error(
            `Already archived: ${p.id} — ${p.name} (at ${p.archived_at}). No change.`,
          );
          process.exit(0);
        }
        if (err instanceof MetaProjectGuardError) {
          console.error(
            `Refused: ${err.project.id} — ${err.project.name} is a meta project.`,
          );
          console.error(
            `Archiving it would break the Relay system. Pass --force if you're absolutely sure.`,
          );
          process.exit(1);
        }
        console.error(`Archive failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  cmd
    .command('rename')
    .description('Rename a project (also updates the dashboard label)')
    .argument('<id>', 'Project ID')
    .argument('<new-name>', 'New name (wrap in quotes if multi-word)')
    .action(async (id, newName) => {
      const client = await RelayClient.fromConfig();
      try {
        const project = await client.renameProject(id, newName);
        console.log(`Renamed: ${project.id} — ${project.name}`);
      } catch (err) {
        console.error(`Rename failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  cmd
    .command('restore')
    .description('Restore an archived project')
    .argument('<id>', 'Project ID to restore')
    .action(async (id) => {
      const client = await RelayClient.fromConfig();
      try {
        const project = await client.restoreProject(id);
        console.log(`Restored: ${project.id} — ${project.name} (now active)`);
        console.log(`Deposits to this project will resume.`);
      } catch (err) {
        if (err instanceof AlreadyInStateError) {
          const p = err.project;
          console.error(`Already active: ${p.id} — ${p.name}. No change.`);
          process.exit(0);
        }
        console.error(`Restore failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return cmd;
}
