// SessionStamp read-side + project-path encoding shared by hook, deposit, and resume.
import { existsSync, readFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

export const CURRENT_SESSION_PATH = join(homedir(), '.relay', 'current-session.json');

export interface SessionRef {
  session_id: string;
  transcript_path: string;
  cwd: string;
  project_path_encoded: string;
  host: string;
}

/**
 * Claude Code derives the projects-dir folder from cwd by replacing every
 * non-[A-Za-z0-9-] character with '-'. Existing dashes are preserved and runs of
 * dashes are NOT collapsed — e.g. "C:\code\_src\app" becomes "C--code--src-app"
 * (the "\_" yields "--"). Verified against the real ~/.claude/projects layout.
 */
export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9-]/g, '-');
}

export function claudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

export function readCurrentSession(): SessionRef | null {
  if (!existsSync(CURRENT_SESSION_PATH)) return null;
  try { return JSON.parse(readFileSync(CURRENT_SESSION_PATH, 'utf8')) as SessionRef; }
  catch { return null; }
}

export function thisHost(): string { return hostname(); }
