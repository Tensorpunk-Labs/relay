import { Command } from 'commander';
import { RelayClient, SessionManager } from '@relay/core';

export function depositCommand(): Command {
  return new Command('deposit')
    .description('Package current work as a context package and upload')
    .option('--title <title>', 'Package title')
    .option('--description <desc>', 'Short description')
    .option('--project <id>', 'Target project ID (overrides CWD detection)')
    .option('--decisions <decisions...>', 'Decisions made')
    .option('--questions <questions...>', 'Open questions')
    .option('--handoff <note>', 'Handoff note for next actor')
    .option('--files <paths...>', 'Deliverable files to include')
    .option('--status <status>', 'Package status', 'complete')
    .option('--review <type>', 'Review type: human | agent | none', 'none')
    .option('--parent <id>', 'Parent package ID')
    .option('--auto', 'Auto-generate from git state + session info')
    .option('--quiet', 'Suppress output (for hooks)')
    .option('--topic <topic>', 'Topic/subject area (auto-inferred if omitted)')
    .option('--type <type>', 'Artifact type: decision, analysis, handoff, question, milestone (auto-inferred if omitted)')
    .action(async (opts) => {
      try {
        const client = await RelayClient.fromConfig();

        // Archive guard — resolve the target project and skip if archived.
        // MUST exit 0 on skip so the stop hook doesn't block Claude. This
        // is run BEFORE we touch git or build any zip.
        const targetProject = client.resolveDepositTargetProject(opts.project);
        if (targetProject) {
          try {
            const archived = await client.isProjectArchived(targetProject);
            if (archived) {
              const msg = `[relay] Skipping deposit: project ${targetProject} is archived.`;
              if (opts.quiet) {
                process.stderr.write(msg + '\n');
              } else {
                console.log(msg);
              }
              process.exit(0);
            }
          } catch {
            // Guard check itself failed — fall through and let the deposit
            // path surface the real error. Never block on a transient read.
          }
        }

        if (opts.auto) {
          const pkg = await client.autoDeposit({
            parentId: opts.parent,
            status: opts.status,
            reviewType: opts.review,
          });

          if (!opts.quiet) {
            console.log(`Deposited: ${pkg.package_id}`);
            console.log(`Title: ${pkg.title}`);
            console.log(`Status: ${pkg.status}`);
            console.log(`Deliverables: ${pkg.deliverables.length} files`);
          }
          return;
        }

        const sm = new SessionManager();
        const session = sm.getSession();

        const pkg = await client.deposit({
          title: opts.title || 'Untitled deposit',
          description: opts.description || '',
          decisions: opts.decisions || [],
          openQuestions: opts.questions || [],
          handoffNote: opts.handoff || '',
          deliverablePaths: opts.files || [],
          status: opts.status,
          reviewType: opts.review,
          parentId: opts.parent || session?.parent_package_id || undefined,
          projectId: opts.project,
          topic: opts.topic,
          artifactType: opts.type,
        });

        if (!opts.quiet) {
          console.log(`Deposited: ${pkg.package_id}`);
          console.log(`Title: ${pkg.title}`);
        }
      } catch (err) {
        if (!opts.quiet) {
          console.error(`Deposit failed: ${(err as Error).message}`);
        }
        process.exit(1);
      }
    });
}
