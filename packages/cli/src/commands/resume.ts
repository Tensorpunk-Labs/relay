import { Command } from 'commander';
import { join } from 'node:path';
import { RelayClient, encodeProjectPath, claudeProjectsDir } from '@relay/core';

export function resumeCommand(): Command {
  return new Command('resume')
    .description('Resume a deposited Claude Code session (by package id or Claude session id)')
    .argument('<idOrSession>', 'Package id (pkg_…) or Claude session id')
    .option('--inline', 'Print the decrypted transcript instead of writing it (for in-context resume)')
    .option(
      '--here',
      "Materialize into the CURRENT directory's Claude projects folder (cross-machine helper)",
    )
    .action(async (idOrSession: string, opts: { inline?: boolean; here?: boolean }) => {
      try {
        const client = await RelayClient.fromConfig();
        const targetProjectDir = opts.here
          ? join(claudeProjectsDir(), encodeProjectPath(process.cwd()))
          : undefined;

        const res = await client.resume(idOrSession, { inline: opts.inline, targetProjectDir });

        if (res.mode === 'inline') {
          process.stdout.write(res.transcript ?? '');
          return;
        }

        console.log(`Restored session ${res.sessionId} (${res.bytes} bytes)`);
        console.log(`Wrote: ${res.jsonlPath}`);
        if (res.crossMachine) {
          console.log(
            `\nNote: recorded on "${res.originHost}". The conversation resumes faithfully, ` +
              `but absolute paths and tool references from that machine may not resolve here.`,
          );
        }
        console.log(`\nResume it:\n  ${res.resumeCommand}`);
      } catch (err) {
        console.error(`Resume failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
