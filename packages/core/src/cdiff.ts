import type { ContextDiff, ActorType } from './types.js';

/**
 * Generate a context diff between two packages.
 * TODO: Implement full diff logic comparing parent and current package.
 */
export function generateCdiff(opts: {
  fromPackageId: string | null;
  toPackageId: string;
  actor: { type: ActorType; id: string };
  contextSummaryDelta: string;
}): ContextDiff {
  return {
    relay_version: '0.1',
    diff_id: `cdiff_${crypto.randomUUID().replace(/-/g, '')}`,
    from_package: opts.fromPackageId,
    to_package: opts.toPackageId,
    timestamp: new Date().toISOString(),
    actor: opts.actor,
    changes: {
      context_summary_delta: opts.contextSummaryDelta,
    },
  };
}
