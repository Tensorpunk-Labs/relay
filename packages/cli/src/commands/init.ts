import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function initCommand(): Command {
  return new Command('init')
    .description('Initialize Relay in current directory')
    .option('--project <id>', 'Project ID to link to')
    .action(async (opts) => {
      const relayDir = path.join(process.cwd(), '.relay');
      fs.mkdirSync(relayDir, { recursive: true });

      const config = {
        project_id: opts.project || '',
        project_name: '',
        initialized_at: new Date().toISOString(),
      };

      fs.writeFileSync(
        path.join(relayDir, 'config.json'),
        JSON.stringify(config, null, 2),
      );

      console.log('Relay initialized in', relayDir);
      if (!opts.project) {
        console.log('Set project: relay config set project-id <id>');
      }
    });
}
