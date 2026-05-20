import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ContextSnapshot, ContextSnapshotFile, ContextSnapshotRanked } from './types.js';

/**
 * A single tool-touch record appended by the `relay hook log-tool` CLI
 * handler. Schema mirrors the type in packages/cli/src/commands/hook.ts;
 * duplicated here to avoid a circular dep between core and cli.
 */
export interface ContextLogEntry {
  ts: string;
  session_id: string;
  tool: string;
  role: 'read' | 'edit' | 'write' | 'reference';
  path: string;
}

/**
 * Path to the per-cwd context log file written by the PostToolUse hook.
 * One log per working directory — append-only across the session, truncated
 * by autoDeposit after consumption.
 */
export function contextLogPath(cwd: string = process.cwd()): string {
  return path.join(cwd, '.relay', 'context-log.jsonl');
}

/**
 * Read all log entries from the per-cwd context log. Returns [] if the log
 * doesn't exist or is unparseable. Malformed lines are skipped, not thrown.
 */
export function readContextLog(cwd: string = process.cwd()): ContextLogEntry[] {
  const p = contextLogPath(cwd);
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf8');
  const out: ContextLogEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj.path === 'string' && typeof obj.role === 'string') {
        out.push(obj);
      }
    } catch {
      // Skip malformed lines silently.
    }
  }
  return out;
}

/**
 * Truncate the context log to zero bytes. Called after autoDeposit has
 * consumed the log into a synthesized snapshot, so the next session starts
 * with a clean slate. Best-effort — no throw on failure.
 */
export function truncateContextLog(cwd: string = process.cwd()): void {
  const p = contextLogPath(cwd);
  try {
    if (fs.existsSync(p)) fs.writeFileSync(p, '', 'utf8');
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

/**
 * Infer a category for a path based on its extension and structural hints.
 * Keep this aligned with the categories in the /tpl-context-report skill so
 * agent-supplied snapshots and hook-derived snapshots use the same vocab.
 */
function categorize(p: string): string {
  const low = p.toLowerCase();
  const base = path.basename(low);
  if (base === 'claude.md' || base === 'agents.md' || base === 'gemini.md' || base === 'memory.md') {
    return 'instructions';
  }
  if (base === 'readme.md' || base === 'architecture.md' || base === 'project_history.md') {
    return 'major-doc';
  }
  if (/\.(ts|tsx|js|jsx|py|cpp|hpp|h|rs|go|java|kt|swift|cs|rb|php|lua|m|mm)$/.test(low)) {
    return 'source-code';
  }
  if (/\.(json|yaml|yml|toml|ini|cmake)$/.test(low) || /package\.json$|tsconfig.*\.json$|cmakelists\.txt$/.test(low)) {
    return 'config';
  }
  if (/\.(test|spec)\.(ts|js|tsx|jsx|py)$/.test(low) || /[\\/]tests?[\\/]/.test(low)) {
    return 'test';
  }
  if (/\.(sql)$/.test(low)) return 'sql';
  if (/\.(md|markdown|txt)$/.test(low)) return 'doc';
  if (/\.(csv|parquet|jsonl|ndjson)$/.test(low)) return 'data';
  if (/\.(svg|png|jpg|jpeg|gif|webp)$/.test(low)) return 'asset';
  return 'other';
}

/**
 * Approximate line count for a file. Best-effort, capped — we never read
 * more than 200KB of a single file to estimate. Returns null if the file
 * doesn't exist or can't be read.
 */
function approxLines(absPath: string): number | null {
  try {
    if (!fs.existsSync(absPath)) return null;
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) return null;
    if (stat.size > 200_000) {
      // Sample: read first 200KB, count newlines, extrapolate by size ratio.
      const fd = fs.openSync(absPath, 'r');
      const buf = Buffer.alloc(200_000);
      try {
        const read = fs.readSync(fd, buf, 0, 200_000, 0);
        let nl = 0;
        for (let i = 0; i < read; i++) if (buf[i] === 0x0a) nl++;
        return Math.round((nl / read) * stat.size);
      } finally {
        fs.closeSync(fd);
      }
    }
    const raw = fs.readFileSync(absPath, 'utf8');
    let nl = 0;
    for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 0x0a) nl++;
    return nl + 1;
  } catch {
    return null;
  }
}

/**
 * Roll up raw log entries (which can have many touches per path) into the
 * `files`/`heavyweights`/`category_totals` structure of a ContextSnapshot.
 *
 * Aggregation rules:
 *   - Multiple touches of the same path collapse into one file entry.
 *   - Role precedence: write > edit > read > reference. The strongest role
 *     observed for the path wins on the final file entry.
 *   - "Why" is auto-derived from role + tool counts ("read twice, edited
 *     once"); agents can override for manual deposits.
 *   - Heavyweights ranking: biggest by approx line count; most_touched by
 *     observation count; stale = touched only in the first quarter of the
 *     log and not since.
 *
 * Returns null when the log is too thin to be useful (<2 distinct paths).
 * autoDeposit skips attachment in that case.
 */
export function synthesizeSnapshotFromLog(
  entries: ContextLogEntry[],
  opts: { cwd?: string } = {},
): ContextSnapshot | null {
  if (entries.length === 0) return null;
  const cwd = opts.cwd || process.cwd();

  type PerPath = {
    path: string;
    role: ContextSnapshotFile['role'];
    touches: number;
    firstSeenIdx: number;
    lastSeenIdx: number;
    tools: Record<string, number>;
  };
  const ROLE_RANK: Record<string, number> = {
    'reference': 0, 'session-load': 0, 'plan': 0,
    'read': 1, 'edit': 2, 'write': 3,
  };

  const byPath = new Map<string, PerPath>();
  entries.forEach((e, idx) => {
    const existing = byPath.get(e.path);
    if (!existing) {
      byPath.set(e.path, {
        path: e.path,
        role: e.role,
        touches: 1,
        firstSeenIdx: idx,
        lastSeenIdx: idx,
        tools: { [e.tool]: 1 },
      });
    } else {
      existing.touches += 1;
      existing.lastSeenIdx = idx;
      existing.tools[e.tool] = (existing.tools[e.tool] || 0) + 1;
      if (ROLE_RANK[e.role] > ROLE_RANK[existing.role]) existing.role = e.role;
    }
  });

  const perPath = [...byPath.values()];
  if (perPath.length < 2) return null;

  const files: ContextSnapshotFile[] = perPath.map((pp) => {
    const lines = approxLines(pp.path);
    const toolList = Object.entries(pp.tools)
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => (c > 1 ? `${t}×${c}` : t))
      .join(', ');
    return {
      path: pp.path,
      role: pp.role,
      category: categorize(pp.path),
      lines,
      why: `hook-observed: ${toolList}`,
    };
  });

  // Category totals (sum of lines per category; nulls treated as 0)
  const category_totals: Record<string, number> = {};
  for (const f of files) {
    category_totals[f.category] = (category_totals[f.category] || 0) + (f.lines ?? 0);
  }

  // Heavyweights
  const sortedByLines = [...files].filter((f) => typeof f.lines === 'number').sort((a, b) => (b.lines! - a.lines!));
  const biggest: ContextSnapshotRanked[] = sortedByLines.slice(0, 3).map((f) => ({
    path: f.path,
    metric: f.lines ?? null,
    note: `${f.role} · ${f.category}`,
  }));

  const sortedByTouches = [...perPath].sort((a, b) => b.touches - a.touches);
  const most_touched: ContextSnapshotRanked[] = sortedByTouches.slice(0, 3).map((pp) => ({
    path: pp.path,
    metric: pp.touches,
    note: `${pp.role} · ${Object.entries(pp.tools).map(([t, c]) => `${t}×${c}`).join(', ')}`,
  }));

  // Stale: first seen in the first quarter of the log, not seen since
  const quarter = Math.max(1, Math.floor(entries.length / 4));
  const stale: ContextSnapshotRanked[] = perPath
    .filter((pp) => pp.firstSeenIdx < quarter && pp.lastSeenIdx < quarter)
    .slice(0, 3)
    .map((pp) => ({ path: pp.path, metric: null, note: `loaded early, untouched since` }));

  // Session shape (coarse — files/lines/dominant categories)
  const totalLines = Object.values(category_totals).reduce((a, b) => a + b, 0);
  const dominant_categories = Object.entries(category_totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .filter(([, lines]) => lines > 0)
    .map(([cat]) => cat);

  // Anchor cwd presence — purely cosmetic when paths are absolute; included
  // for parity with the agent-driven snapshot shape.
  void cwd;

  return {
    session_shape: {
      files: files.length,
      lines: totalLines,
      dominant_categories,
    },
    files,
    heavyweights: { biggest, most_touched, stale },
    category_totals,
  };
}
