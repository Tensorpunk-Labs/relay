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
