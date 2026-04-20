import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';

function getGlobalConfigPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(homeDir, '.relay', 'config.json');
}

function readConfig(): Record<string, string> {
  const configPath = getGlobalConfigPath();
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return {};
}

function writeConfig(config: Record<string, string>): void {
  const configPath = getGlobalConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function configCommand(): Command {
  const cmd = new Command('config').description('Manage Relay configuration');

  cmd
    .command('set')
    .description('Set a config value')
    .argument('<key>', 'Config key')
    .argument('<value>', 'Config value')
    .action((key, value) => {
      const config = readConfig();
      config[key.replace(/-/g, '_')] = value;
      writeConfig(config);
      console.log(`Set ${key} = ${value}`);
    });

  cmd
    .command('get')
    .description('Get a config value')
    .argument('<key>', 'Config key')
    .action((key) => {
      const config = readConfig();
      const normalizedKey = key.replace(/-/g, '_');
      console.log(config[normalizedKey] ?? '(not set)');
    });

  cmd
    .command('show')
    .description('Show all config')
    .action(() => {
      const config = readConfig();
      console.log(JSON.stringify(config, null, 2));
    });

  return cmd;
}
