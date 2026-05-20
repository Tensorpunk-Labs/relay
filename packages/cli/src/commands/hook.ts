import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * `relay hook` subcommand family — handlers wired into Claude Code's hook
 * events via the global settings.json. Each subcommand reads the hook event
 * JSON from stdin and produces side effects on disk; nothing it does is
 * allowed to throw a non-zero exit code (would break the user's hook chain).
 *
 * Today: `relay hook log-tool` — capture per-session file-touch telemetry
 * for the Fork B context_snapshot path on auto-deposits.
 */
export function hookCommand(): Command {
  const cmd = new Command('hook').description('Handlers for Claude Code hook events (stdin JSON in)');

  cmd
    .command('log-tool')
    .description(
      'Read a PostToolUse / PreToolUse event from stdin and append a per-session file-touch record to .relay/context-log.jsonl. Wire as a PostToolUse hook for the file tools (Read, Edit, Write, Glob, Grep, NotebookEdit, MultiEdit). Defensive: any failure exits 0 silently — never blocks the hook chain.'
    )
    .action(async () => {
      try {
        const raw = await readStdin();
        if (!raw.trim()) return; // empty stdin — nothing to log
        const event = JSON.parse(raw) as HookEvent;
        const entries = extractEntries(event);
        if (entries.length === 0) return; // tool we don't care about

        const cwd = event.cwd || process.cwd();
        const relayDir = path.join(cwd, '.relay');
        try { fs.mkdirSync(relayDir, { recursive: true }); } catch { /* ignore */ }
        const logPath = path.join(relayDir, 'context-log.jsonl');
        const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
        fs.appendFileSync(logPath, lines, 'utf8');
      } catch {
        // Hooks must never break the chain. Swallow everything.
      }
      // Always exit 0.
    });

  return cmd;
}

// ---------------------------------------------------------------------------
// Event shapes
// ---------------------------------------------------------------------------

interface HookEvent {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
  hook_event_name?: 'PreToolUse' | 'PostToolUse';
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  tool_response?: unknown;
}

export interface ContextLogEntry {
  ts: string;
  session_id: string;
  tool: string;
  role: 'read' | 'edit' | 'write' | 'reference';
  path: string;
}

// ---------------------------------------------------------------------------
// Extraction — exported for unit tests in core, kept here for hook-local use
// ---------------------------------------------------------------------------

/**
 * Map a tool name + tool_input to zero or more ContextLogEntry records.
 *
 * Tools we track (anything else returns []):
 *   Read       -> file_path,            role 'read'
 *   Edit       -> file_path,            role 'edit'
 *   MultiEdit  -> file_path,            role 'edit'
 *   Write      -> file_path,            role 'write'
 *   NotebookEdit -> notebook_path,      role 'edit'
 *   Glob       -> path (the dir),       role 'reference'  (the dir was searched)
 *   Grep       -> path (the dir),       role 'reference'
 */
export function extractEntries(event: HookEvent): ContextLogEntry[] {
  const tool = event.tool_name;
  const input = event.tool_input || {};
  const session_id = event.session_id || '';
  const ts = new Date().toISOString();
  if (!tool) return [];

  const out: ContextLogEntry[] = [];
  const push = (p: unknown, role: ContextLogEntry['role']) => {
    if (typeof p === 'string' && p.length > 0) {
      out.push({ ts, session_id, tool, role, path: p });
    }
  };

  switch (tool) {
    case 'Read':
      push(input.file_path, 'read');
      break;
    case 'Edit':
    case 'MultiEdit':
      push(input.file_path, 'edit');
      break;
    case 'Write':
      push(input.file_path, 'write');
      break;
    case 'NotebookEdit':
      // notebook_path on newer CCs; some payloads use file_path
      push(input.notebook_path ?? input.file_path, 'edit');
      break;
    case 'Glob':
    case 'Grep':
      push(input.path, 'reference');
      break;
    default:
      // Unknown tool — log nothing
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stdin helper
// ---------------------------------------------------------------------------

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
    // Soft timeout — hook should never block the agent loop
    setTimeout(() => resolve(data), 2000);
  });
}
