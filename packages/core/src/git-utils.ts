import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface GitInfo {
  branch: string;
  diff_summary: string;
  changed_files: string[];
  commit_count: number;
  last_commit_message: string;
  has_uncommitted: boolean;
}

function run(cmd: string, cwd?: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

export function getGitInfo(cwd?: string): GitInfo {
  const branch = run('git rev-parse --abbrev-ref HEAD', cwd);
  const diffStat = run('git diff --stat', cwd);
  const stagedStat = run('git diff --cached --stat', cwd);
  const diff_summary = [diffStat, stagedStat].filter(Boolean).join('\n');

  const untrackedRaw = run('git ls-files --others --exclude-standard', cwd);
  const modifiedRaw = run('git diff --name-only', cwd);
  const stagedRaw = run('git diff --cached --name-only', cwd);
  const changed_files = [...new Set([
    ...modifiedRaw.split('\n').filter(Boolean),
    ...stagedRaw.split('\n').filter(Boolean),
    ...untrackedRaw.split('\n').filter(Boolean),
  ])];

  const has_uncommitted = changed_files.length > 0;
  const last_commit_message = run('git log -1 --pretty=%s', cwd);

  // Count commits since session start (approximation: commits in last 24h)
  const commitLog = run('git log --oneline --since="24 hours ago"', cwd);
  const commit_count = commitLog ? commitLog.split('\n').filter(Boolean).length : 0;

  return { branch, diff_summary, changed_files, commit_count, last_commit_message, has_uncommitted };
}

/**
 * Generate a fingerprint of the current git state.
 * Used for dedup — if two sessions have the same fingerprint, skip duplicate deposits.
 */
export function getGitFingerprint(cwd?: string): string {
  const commitHash = run('git rev-parse HEAD', cwd);
  const dirtyFiles = run('git diff --name-only', cwd);
  const stagedFiles = run('git diff --cached --name-only', cwd);
  const raw = `${commitHash}|${dirtyFiles}|${stagedFiles}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export function getGitDiff(cwd?: string): string {
  const staged = run('git diff --cached', cwd);
  const unstaged = run('git diff', cwd);
  const combined = [staged, unstaged].filter(Boolean).join('\n');
  // Truncate to ~50KB to avoid oversized packages
  if (combined.length > 50000) {
    return combined.slice(0, 50000) + '\n\n... (truncated, full diff too large)';
  }
  return combined;
}
