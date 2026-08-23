// SessionStamp read-side + project-path encoding shared by hook, deposit, and resume.
//
// pkg_7a00e2b8 (2026-06-12): a single global ~/.relay/current-session.json meant N
// concurrent Claude shells all deposited against whichever shell stamped LAST. Stamps
// are now per-session (~/.relay/sessions/<session_id>.json) and a deposit resolves
// ITS OWN shell: explicit id -> cwd match (most recently active transcript) -> legacy.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';

export const CURRENT_SESSION_PATH = join(homedir(), '.relay', 'current-session.json');

export interface SessionRef {
  session_id: string;
  transcript_path: string;
  cwd: string;
  project_path_encoded: string;
  host: string;
}

export interface ResolveSessionOptions {
  /** Explicit Claude session id (hook stdin payload, RELAY_SESSION_ID / CLAUDE_SESSION_ID env). */
  sessionId?: string | null;
  /** Calling shell's cwd (defaults to process.cwd()). */
  cwd?: string;
  /** Home dir override (tests). */
  home?: string;
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

export function sessionsDir(home: string = homedir()): string {
  return join(home, '.relay', 'sessions');
}

function legacyPath(home: string): string {
  return join(home, '.relay', 'current-session.json');
}

function readJson(p: string): SessionRef | null {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')) as SessionRef; } catch { return null; }
}

function normCwd(p: string | undefined | null): string {
  return String(p || '').replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
}

/** Write a per-session stamp (and the legacy singleton for older readers). */
export function stampSession(ref: SessionRef, opts: { home?: string } = {}): string {
  const home = opts.home ?? homedir();
  const out = join(sessionsDir(home), `${ref.session_id}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(ref, null, 2));
  try { writeFileSync(legacyPath(home), JSON.stringify(ref, null, 2)); } catch { /* best-effort */ }
  return out;
}

function listStamps(home: string): SessionRef[] {
  const dir = sessionsDir(home);
  if (!existsSync(dir)) return [];
  const out: SessionRef[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const r = readJson(join(dir, f));
    if (r?.session_id) out.push(r);
  }
  return out;
}

function transcriptMtime(r: SessionRef): number {
  try { return r.transcript_path ? statSync(r.transcript_path).mtimeMs : -1; } catch { return -1; }
}

/**
 * Resolve the session the CALLING shell belongs to.
 *   1. explicit id (opts.sessionId, else RELAY_SESSION_ID / CLAUDE_SESSION_ID env)
 *   2. stamp whose cwd matches the calling cwd; ties broken by the most recently
 *      modified transcript (the shell that is actually talking right now)
 *   3. legacy ~/.relay/current-session.json
 */
export function resolveSessionRef(opts: ResolveSessionOptions = {}): SessionRef | null {
  const home = opts.home ?? homedir();
  const sid = opts.sessionId || process.env.RELAY_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
  if (sid) {
    const direct = readJson(join(sessionsDir(home), `${sid}.json`));
    if (direct) return direct;
  }
  const cwd = normCwd(opts.cwd ?? process.cwd());
  const matches = listStamps(home).filter((r) => normCwd(r.cwd) === cwd);
  if (matches.length) {
    matches.sort((a, b) => transcriptMtime(b) - transcriptMtime(a));
    return matches[0];
  }
  return readJson(legacyPath(home));
}

/** Back-compat alias: resolves the calling shell's session (no longer a blind singleton read). */
export function readCurrentSession(opts: ResolveSessionOptions = {}): SessionRef | null {
  return resolveSessionRef(opts);
}

export function thisHost(): string { return hostname(); }
