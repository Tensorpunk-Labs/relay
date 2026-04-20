#!/usr/bin/env node
import { Command } from 'commander';
import { registerSqliteFactory } from '@relay/core';
import { SqliteStorage } from '@relay/storage-sqlite';
import { initCommand } from './commands/init.js';
import { sessionCommand } from './commands/session.js';
import { pullCommand } from './commands/pull.js';
import { depositCommand } from './commands/deposit.js';
import { statusCommand } from './commands/status.js';
import { diffCommand } from './commands/diff.js';
import { orchestrateCommand } from './commands/orchestrate.js';
import { configCommand } from './commands/config.js';
import { projectsCommand } from './commands/projects.js';
import { dailyCommand } from './commands/daily.js';
import { orientCommand } from './commands/orient.js';
import { factsCommand } from './commands/facts.js';
import { backupCommand } from './commands/backup.js';
import { restoreCommand } from './commands/restore.js';
import { syncCommand } from './commands/sync.js';

// Wire the SqliteStorage factory into @relay/core's openStorage() so
// `relay restore --to sqlite:///...` and future `relay sync` targets
// resolve without @relay/core taking a build-time dep on
// @relay/storage-sqlite (which would be a cycle — storage-sqlite
// depends on core).
registerSqliteFactory((opts) => new SqliteStorage(opts));

const program = new Command();

program
  .name('relay')
  .description('Context flow for human-agent teams')
  .version('0.1.0');

program.addCommand(initCommand());
program.addCommand(sessionCommand());
program.addCommand(pullCommand());
program.addCommand(depositCommand());
program.addCommand(statusCommand());
program.addCommand(diffCommand());
program.addCommand(orchestrateCommand());
program.addCommand(configCommand());
program.addCommand(projectsCommand());
program.addCommand(dailyCommand());
program.addCommand(orientCommand());
program.addCommand(factsCommand());
program.addCommand(backupCommand());
program.addCommand(restoreCommand());
program.addCommand(syncCommand());

program.parse();
