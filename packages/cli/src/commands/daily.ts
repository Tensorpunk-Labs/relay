import { Command } from 'commander';
import { RelayClient } from '@relay/core';
import type { RelayManifest } from '@relay/core';
import { assembleGlobalDigest } from '@relay/orchestrator';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// --- Config helpers ---

interface DailyConfig {
  obsidianVault: string | null;
  todoTodayRel: string;
  todoTomorrowRel: string;
  metaProject: string | null;
  thoughtsProject: string | null;
}

function loadDailyConfig(): DailyConfig {
  const configPath = join(homedir(), '.relay', 'config.json');
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  }
  const daily = (config.daily as Record<string, unknown>) || {};

  return {
    obsidianVault: (config.obsidian_vault as string) || findObsidianVault(),
    todoTodayRel: (daily.todo_today as string) || '01_TODO 📝/TODO TODAY.md',
    todoTomorrowRel: (daily.todo_tomorrow as string) || '01_TODO 📝/TODO TOMORROW.md',
    metaProject: (config.meta_project as string) || null,
    thoughtsProject: (config.thoughts_project as string) || null,
  };
}

function findObsidianVault(): string | null {
  const envVault = process.env.OBSIDIAN_VAULT;
  if (envVault && existsSync(envVault)) return envVault;

  const candidates = [
    join(homedir(), 'Documents', 'Obsidian Vault'),
    join(homedir(), 'Obsidian Vault'),
    join(homedir(), 'Documents', 'obsidian'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function readTodoFile(vault: string | null, relPath: string, override?: string): string | null {
  if (override && existsSync(override)) return readFileSync(override, 'utf-8');
  if (!vault) return null;
  const full = join(vault, relPath);
  if (existsSync(full)) return readFileSync(full, 'utf-8');
  return null;
}

// --- Brief builders ---

function todayDate(): string {
  return new Date().toISOString().split('T')[0];
}

function buildProjectPulse(digests: { projectId: string; digest: { assembledContext: string; packagesAnalyzed: number } }[], projectNames: Map<string, string>): string {
  const lines = ['| Project | Packages | Recent |', '|---------|----------|--------|'];
  for (const { projectId, digest } of digests) {
    const name = projectNames.get(projectId) || projectId.replace('proj_dev_', '').replace(/^proj_/, '');
    lines.push(`| ${name} | ${digest.packagesAnalyzed} | Active |`);
  }
  return lines.join('\n');
}

function buildDailyBrief(
  digests: { projectId: string; digest: { assembledContext: string; packagesAnalyzed: number; openQuestionsFound: number; decisionsLogged: number } }[],
  todayContent: string | null,
  tomorrowContent: string | null,
  projectNames: Map<string, string>,
): string {
  const lines: string[] = [];

  lines.push(`# Daily Boot — ${todayDate()}`);
  lines.push('');

  // Project pulse
  lines.push('## Project Pulse');
  lines.push(buildProjectPulse(digests, projectNames));
  lines.push('');

  // Total stats
  const totalPkgs = digests.reduce((s, d) => s + d.digest.packagesAnalyzed, 0);
  const totalQuestions = digests.reduce((s, d) => s + d.digest.openQuestionsFound, 0);
  const totalDecisions = digests.reduce((s, d) => s + d.digest.decisionsLogged, 0);
  lines.push(`**Total context:** ${totalPkgs} packages, ${totalDecisions} decisions, ${totalQuestions} open questions`);
  lines.push('');

  // TODO TODAY
  if (todayContent) {
    lines.push('## TODO Today (from Obsidian)');
    lines.push('');
    lines.push(todayContent.trim());
    lines.push('');
  }

  // Open questions from all projects
  if (totalQuestions > 0) {
    lines.push('## Open Questions Needing Attention');
    lines.push('');
    for (const { digest } of digests) {
      // Extract questions from the assembled context
      const qMatch = digest.assembledContext.match(/\*\*Open Questions:\*\* (.*)/g);
      if (qMatch) {
        for (const q of qMatch) {
          lines.push(`- ${q.replace('**Open Questions:** ', '')}`);
        }
      }
    }
    lines.push('');
  }

  // Tomorrow preview
  if (tomorrowContent) {
    lines.push('## Tomorrow Preview');
    lines.push('');
    lines.push(tomorrowContent.trim());
    lines.push('');
  }

  // Full context for agent consumption
  lines.push('## Full Project Context');
  lines.push('');
  for (const { projectId, digest } of digests) {
    lines.push(`### ${projectId}`);
    lines.push(digest.assembledContext);
    lines.push('');
  }

  return lines.join('\n');
}

function buildDaySummary(
  digests: { projectId: string; digest: { assembledContext: string; packagesAnalyzed: number; openQuestionsFound: number; decisionsLogged: number } }[],
  todayContent: string | null,
  projectNames: Map<string, string>,
  thoughts?: string,
): string {
  const lines: string[] = [];

  lines.push(`# Daily Logoff — ${todayDate()}`);
  lines.push('');

  // Day stats
  const totalPkgs = digests.reduce((s, d) => s + d.digest.packagesAnalyzed, 0);
  const totalDecisions = digests.reduce((s, d) => s + d.digest.decisionsLogged, 0);
  const totalQuestions = digests.reduce((s, d) => s + d.digest.openQuestionsFound, 0);

  lines.push('## Day Summary');
  lines.push(`**Packages deposited:** ${totalPkgs} across ${digests.length} projects`);
  lines.push(`**Decisions logged:** ${totalDecisions}`);
  lines.push(`**Open questions:** ${totalQuestions}`);
  lines.push('');

  // What moved per project
  lines.push('## What Moved');
  for (const { projectId, digest } of digests) {
    const name = projectNames.get(projectId) || projectId.replace('proj_dev_', '').replace(/^proj_/, '');
    lines.push(`- **${name}**: ${digest.packagesAnalyzed} packages`);
  }
  lines.push('');

  // TODO reconciliation
  if (todayContent) {
    lines.push('## TODO Reconciliation');
    lines.push('');
    const todoLines = todayContent.split('\n').filter((l) => l.trim().startsWith('- ['));
    for (const todo of todoLines) {
      const isDone = todo.includes('[x]') || todo.includes('[X]');
      lines.push(isDone ? todo.replace('- [x]', '- [x] ✅').replace('- [X]', '- [x] ✅') : `${todo} ⬜`);
    }
    lines.push('');

    // Carry to tomorrow
    const incomplete = todoLines.filter((l) => !l.includes('[x]') && !l.includes('[X]'));
    if (incomplete.length > 0) {
      lines.push('## Carry to Tomorrow');
      for (const item of incomplete) {
        lines.push(item);
      }
      lines.push('');
    }
  }

  // Jordan's thoughts
  if (thoughts) {
    lines.push("## Jordan's Thoughts");
    lines.push('');
    lines.push(thoughts);
    lines.push('');
  }

  return lines.join('\n');
}

// --- Commands ---

export function dailyCommand(): Command {
  const cmd = new Command('daily')
    .description('Daily workflow — boot (morning) and logoff (evening)');

  cmd.addCommand(
    new Command('boot')
      .description('Morning check-in: orchestrate + TODO cross-reference + daily brief')
      .option('--todo-today <path>', 'Path to TODO TODAY markdown')
      .option('--todo-tomorrow <path>', 'Path to TODO TOMORROW markdown')
      .option('--deposit', 'Deposit boot analysis to Tensorpunk Meta')
      .option('--focus <topic>', 'Focus area for orchestrate')
      .option('--quiet', 'Minimal output')
      .action(async (opts) => {
        const client = await RelayClient.fromConfig();
        const cfg = loadDailyConfig();

        if (!opts.quiet) console.error('[Relay] Running global orchestrate...');
        const [digests, projects] = await Promise.all([
          assembleGlobalDigest(client, opts.focus),
          client.listProjects(),
        ]);
        const projectNames = new Map(projects.map((p) => [p.id, p.name]));

        const todayContent = readTodoFile(cfg.obsidianVault, cfg.todoTodayRel, opts.todoToday);
        const tomorrowContent = readTodoFile(cfg.obsidianVault, cfg.todoTomorrowRel, opts.todoTomorrow);

        const brief = buildDailyBrief(digests, todayContent, tomorrowContent, projectNames);
        console.log(brief);

        if (opts.deposit && cfg.metaProject) {
          await client.deposit({
            projectId: cfg.metaProject,
            title: `Daily Boot — ${todayDate()}`,
            description: brief.substring(0, 500),
            decisions: [],
            openQuestions: [],
            handoffNote: 'Automated daily boot check-in',
            deliverablePaths: [],
            status: 'complete',
            reviewType: 'none',
          });
          if (!opts.quiet) console.error('[Deposited to Tensorpunk Meta]');
        }
      }),
  );

  cmd.addCommand(
    new Command('logoff')
      .description('Evening wrap-up: day summary + deposit')
      .option('--thoughts <text>', "End-of-day thoughts to include")
      .option('--skip-deposit', 'Generate summary without depositing')
      .option('--quiet', 'Minimal output')
      .action(async (opts) => {
        const client = await RelayClient.fromConfig();
        const cfg = loadDailyConfig();

        if (!opts.quiet) console.error('[Relay] Running global orchestrate...');
        const [digests, projects] = await Promise.all([
          assembleGlobalDigest(client),
          client.listProjects(),
        ]);
        const projectNames = new Map(projects.map((p) => [p.id, p.name]));

        const todayContent = readTodoFile(cfg.obsidianVault, cfg.todoTodayRel);
        const summary = buildDaySummary(digests, todayContent, projectNames, opts.thoughts);
        console.log(summary);

        if (!opts.skipDeposit && cfg.metaProject) {
          await client.deposit({
            projectId: cfg.metaProject,
            title: `Daily Logoff — ${todayDate()}`,
            description: summary.substring(0, 500),
            decisions: [],
            openQuestions: [],
            handoffNote: summary.substring(0, 1000),
            deliverablePaths: [],
            status: 'complete',
            reviewType: 'none',
          });
          if (!opts.quiet) console.error('[Deposited day summary to Tensorpunk Meta]');

          if (opts.thoughts && cfg.thoughtsProject) {
            await client.deposit({
              projectId: cfg.thoughtsProject,
              title: `Jordan Thoughts — ${todayDate()} (Logoff)`,
              description: opts.thoughts,
              decisions: [],
              openQuestions: [],
              handoffNote: '',
              deliverablePaths: [],
              status: 'complete',
              reviewType: 'none',
            });
            if (!opts.quiet) console.error('[Deposited thoughts to Jordan Thoughts]');
          }
        }
      }),
  );

  return cmd;
}
