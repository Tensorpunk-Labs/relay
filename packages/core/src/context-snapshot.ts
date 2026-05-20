import type { ContextSnapshot, ContextSnapshotFile, ContextSnapshotRanked } from './types.js';

/**
 * Path patterns that should never leak into a stored context_snapshot.
 * Even though snapshots are paths-only (no contents), the path string itself
 * can hint at secrets — e.g. `~/.aws/credentials`, `infra/secrets/prod.key`.
 * Anything matched here is replaced with the literal "[redacted]" before
 * persistence.
 */
const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /(^|[\\/])\.env(\.|$)/i,
  /(^|[\\/])\.env$/i,
  /(^|[\\/])credentials?(\.|[\\/]|$)/i,
  /(^|[\\/])secrets?([\\/]|$)/i,
  /\.(key|pem|p12|pfx)$/i,
  /(^|[\\/])id_rsa($|\.)/i,
  /(^|[\\/])\.ssh([\\/]|$)/i,
  /(^|[\\/])\.aws([\\/]|$)/i,
  /(^|[\\/])\.gnupg([\\/]|$)/i,
];

const REDACTED = '[redacted]';

export function isSensitivePath(p: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((re) => re.test(p));
}

/**
 * Returns a copy of the input snapshot with every sensitive path replaced
 * by the literal "[redacted]". Non-path metadata (lines, role, why, etc.)
 * is preserved — the *count* of redacted files is still useful signal for
 * the receiver.
 *
 * Idempotent: redacting an already-redacted snapshot is a no-op.
 */
export function redactSensitivePaths(snap: ContextSnapshot): ContextSnapshot {
  const scrubFile = (f: ContextSnapshotFile): ContextSnapshotFile =>
    isSensitivePath(f.path) ? { ...f, path: REDACTED, why: 'redacted (sensitive path pattern)' } : f;

  const scrubRanked = (r: ContextSnapshotRanked): ContextSnapshotRanked =>
    isSensitivePath(r.path) ? { ...r, path: REDACTED, note: 'redacted (sensitive path pattern)' } : r;

  return {
    session_shape: snap.session_shape,
    files: snap.files.map(scrubFile),
    heavyweights: {
      biggest: snap.heavyweights.biggest.map(scrubRanked),
      most_touched: snap.heavyweights.most_touched.map(scrubRanked),
      stale: snap.heavyweights.stale.map(scrubRanked),
    },
    category_totals: { ...snap.category_totals },
  };
}

/**
 * Validates the shape of a context_snapshot received from an external
 * caller (CLI flag, MCP tool, JSON file). Throws on missing required
 * fields. Does not type-check exhaustively — TypeScript handles that
 * for first-party callers; this is the runtime safety net for JSON
 * coming over the wire.
 */
export function validateContextSnapshot(input: unknown): ContextSnapshot {
  if (!input || typeof input !== 'object') {
    throw new Error('context_snapshot: expected object, got ' + typeof input);
  }
  const s = input as Record<string, unknown>;
  if (!s.session_shape || typeof s.session_shape !== 'object') {
    throw new Error('context_snapshot: missing or invalid session_shape');
  }
  if (!Array.isArray(s.files)) {
    throw new Error('context_snapshot: files must be an array');
  }
  if (!s.heavyweights || typeof s.heavyweights !== 'object') {
    throw new Error('context_snapshot: missing or invalid heavyweights');
  }
  const hw = s.heavyweights as Record<string, unknown>;
  for (const k of ['biggest', 'most_touched', 'stale']) {
    if (!Array.isArray(hw[k])) {
      throw new Error(`context_snapshot: heavyweights.${k} must be an array`);
    }
  }
  if (!s.category_totals || typeof s.category_totals !== 'object') {
    throw new Error('context_snapshot: missing or invalid category_totals');
  }
  return input as ContextSnapshot;
}
