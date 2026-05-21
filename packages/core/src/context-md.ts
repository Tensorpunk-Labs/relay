import type { RelayManifest } from './types.js';

/**
 * Generate a CONTEXT.md briefing document from a manifest.
 * This is the human+agent readable entry point for any context package.
 */
export function generateContextMd(manifest: RelayManifest, gitDiff?: string): string {
  const lines: string[] = [];

  lines.push(`# ${manifest.title}`);
  lines.push('');
  lines.push(`**Package:** ${manifest.package_id}`);
  lines.push(`**Status:** ${manifest.status}`);
  lines.push(`**Created:** ${manifest.created_at}`);
  lines.push(`**Created by:** ${manifest.created_by.type}/${manifest.created_by.id}`);
  if (manifest.parent_package_id) {
    lines.push(`**Parent:** ${manifest.parent_package_id}`);
  }
  lines.push('');

  if (manifest.description) {
    lines.push('## Summary');
    lines.push('');
    lines.push(manifest.description);
    lines.push('');
  }

  if (manifest.handoff_note) {
    lines.push('## Handoff');
    lines.push('');
    lines.push(manifest.handoff_note);
    lines.push('');
  }

  if (manifest.decisions_made.length > 0) {
    lines.push('## Decisions Made');
    lines.push('');
    for (const d of manifest.decisions_made) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  if (manifest.open_questions.length > 0) {
    lines.push('## Open Questions');
    lines.push('');
    for (const q of manifest.open_questions) {
      lines.push(`- ${q}`);
    }
    lines.push('');
  }

  if (manifest.deliverables.length > 0) {
    lines.push('## Deliverables');
    lines.push('');
    for (const d of manifest.deliverables) {
      lines.push(`- \`${d.path}\` (${d.type}${d.language ? ', ' + d.language : ''})`);
    }
    lines.push('');
  }

  // Context snapshot — heavyweights and dominant categories only, NOT the
  // full files[] list. Goal: make file-path queries hit packages that had
  // those files in scope, without blowing past the 256-token embedding
  // window on long sessions. The long tail of context files stays in the
  // jsonb column (dashboard renders it) but isn't included here.
  if (manifest.context_snapshot) {
    const snap = manifest.context_snapshot;
    const shapeBits: string[] = [];
    if (snap.session_shape?.files) shapeBits.push(`${snap.session_shape.files} files`);
    if (snap.session_shape?.lines) shapeBits.push(`~${snap.session_shape.lines.toLocaleString()} lines`);
    if (snap.session_shape?.dominant_categories?.length) {
      shapeBits.push(snap.session_shape.dominant_categories.slice(0, 3).join(', '));
    }
    if (shapeBits.length > 0) {
      lines.push('## Context at Deposit');
      lines.push('');
      lines.push(shapeBits.join(' · '));
      lines.push('');
      const biggest = snap.heavyweights?.biggest?.slice(0, 3) ?? [];
      const touched = snap.heavyweights?.most_touched?.slice(0, 3) ?? [];
      if (biggest.length > 0) {
        lines.push('**Biggest in scope:**');
        for (const h of biggest) {
          const tail = h.metric != null ? ` (${h.metric} lines)` : '';
          lines.push(`- \`${h.path}\`${tail}`);
        }
        lines.push('');
      }
      if (touched.length > 0) {
        lines.push('**Most touched:**');
        for (const h of touched) {
          const tail = h.metric != null ? ` (×${h.metric})` : '';
          lines.push(`- \`${h.path}\`${tail}`);
        }
        lines.push('');
      }
    }
  }

  if (gitDiff) {
    lines.push('## Changes');
    lines.push('');
    lines.push('```diff');
    lines.push(gitDiff);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}
