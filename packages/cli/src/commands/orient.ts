import { Command } from 'commander';
import { RelayClient, formatOrientationBundle } from '@relay/core';

/**
 * `relay orient` — print the wake-up bundle for the current (or specified)
 * project. Designed to be invoked from a Claude Code SessionStart hook so
 * every session begins oriented without the agent having to call
 * relay_pull_context manually.
 *
 * Implements the "every session starts oriented" half of Relay's mission.
 */
export function orientCommand(): Command {
  return new Command('orient')
    .description('Print the wake-up bundle for the current project (use in SessionStart hooks)')
    .option('--project <id>', 'Project ID (omit to use CWD-resolved or default)')
    .option('--json', 'Emit JSON instead of markdown')
    .option('--key-packages <n>', 'How many top-significance packages to include (default 3)', (v) => parseInt(v, 10))
    .option('--open-questions <n>', 'How many open questions to include (default 5)', (v) => parseInt(v, 10))
    .option('--window <days>', 'Time window in days (overrides meta control, default 14)', (v) => parseInt(v, 10))
    .action(async (opts) => {
      try {
        const client = await RelayClient.fromConfig();
        const bundle = await client.getOrientation(opts.project, {
          windowDays: opts.window,
          openQuestionCount: opts.openQuestions,
        });
        if (opts.json) {
          process.stdout.write(JSON.stringify(bundle, null, 2) + '\n');
        } else {
          process.stdout.write(formatOrientationBundle(bundle) + '\n');
        }
      } catch (err) {
        // Non-fatal: SessionStart hooks should never block session creation.
        // Print a tiny note to stderr (which Claude Code surfaces to the
        // user but doesn't inject as context) and exit 0.
        process.stderr.write(`[relay orient] ${(err as Error).message}\n`);
        process.exit(0);
      }
    });
}
