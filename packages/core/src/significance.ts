import type { RelayManifest } from './types.js';

/**
 * Compute a significance score (0-10) for a context package.
 *
 * Higher scores = richer context, more valuable for orchestrate/search.
 * Auto-deposits with no context score 0-1.
 * Rich manual deposits with decisions, handoff, questions score 6-10.
 */
export function computeSignificance(manifest: RelayManifest, isAuto: boolean): number {
  let score = 0;

  // Manual deposit vs auto
  if (!isAuto) score += 2;

  // Handoff note (the most valuable signal)
  if (manifest.handoff_note?.trim()) {
    score += 3;
  }

  // Decisions (up to 3 points)
  const decisionCount = manifest.decisions_made?.length || 0;
  score += Math.min(decisionCount, 3);

  // Open questions (up to 2 points)
  const questionCount = manifest.open_questions?.length || 0;
  score += Math.min(questionCount, 2);

  // Meaningful description (not just git boilerplate)
  if (manifest.description?.trim()) {
    const desc = manifest.description;
    const isBoilerplate = desc.startsWith('Branch:') && desc.includes('fingerprint:');
    if (!isBoilerplate) {
      score += 1;
    }
  }

  // Deliverables
  if (manifest.deliverables?.length > 0) {
    score += 1;
  }

  return Math.min(score, 10);
}
