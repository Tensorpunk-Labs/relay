import type { RelayManifest } from './types.js';

/** Directory path patterns -> topic mappings. Ordered by specificity. */
const DIR_PATTERNS: [RegExp, string][] = [
  [/packages\/cli\//i, 'cli'],
  [/packages\/mcp\//i, 'mcp'],
  [/packages\/core\//i, 'core'],
  [/packages\/orchestrator\//i, 'orchestrator'],
  [/packages\/dashboard\//i, 'dashboard'],
  [/packages\/api\//i, 'api'],
  [/supabase\//i, 'infrastructure'],
  [/scripts\//i, 'infrastructure'],
  [/docs\//i, 'docs'],
];

/** Title keyword patterns -> topic mappings. Checked if file paths yield nothing. */
const TITLE_PATTERNS: [RegExp, string][] = [
  [/\borient/i, 'orient'],
  [/\bdashboard/i, 'dashboard'],
  [/\borchestrat/i, 'orchestrator'],
  [/\bcli\b/i, 'cli'],
  [/\bmcp\b/i, 'mcp'],
  [/\bfact/i, 'facts'],
  [/\bretrieval|\bsearch|\bembed/i, 'retrieval'],
  [/\bmigrat|\bschema|\bsupabase/i, 'infrastructure'],
  [/\bdoctor|\baudit|\bhealth/i, 'infrastructure'],
];

/**
 * Infer topic from package content and optional changed file paths.
 * Returns null if no confident match.
 */
export function inferTopic(
  manifest: RelayManifest,
  changedFiles?: string[],
): string | null {
  // 1. File path analysis (most reliable signal)
  if (changedFiles?.length) {
    const counts = new Map<string, number>();
    for (const file of changedFiles) {
      for (const [re, topic] of DIR_PATTERNS) {
        if (re.test(file)) {
          counts.set(topic, (counts.get(topic) ?? 0) + 1);
          break; // first match wins per file
        }
      }
    }
    if (counts.size > 0) {
      let best = '';
      let bestCount = 0;
      for (const [topic, count] of counts) {
        if (count > bestCount) {
          best = topic;
          bestCount = count;
        }
      }
      return best;
    }
  }

  // 2. Title keyword matching
  const title = manifest.title ?? '';
  for (const [re, topic] of TITLE_PATTERNS) {
    if (re.test(title)) return topic;
  }

  // 3. Description keyword matching (fallback)
  const desc = manifest.description ?? '';
  if (desc.length > 50) {
    for (const [re, topic] of TITLE_PATTERNS) {
      if (re.test(desc)) return topic;
    }
  }

  return null;
}

/**
 * Infer artifact type from manifest fields.
 * Checks in priority order — first match wins.
 */
export function inferArtifactType(manifest: RelayManifest): string | null {
  const title = manifest.title ?? '';
  const desc = manifest.description ?? '';

  // 1. Auto-deposit (highest priority — cheapest signal)
  if (
    title.startsWith('[auto]') ||
    (desc.startsWith('Branch:') && desc.includes('fingerprint:'))
  ) {
    return 'auto-deposit';
  }

  // 2. Content-based classification
  const hasDecisions = (manifest.decisions_made?.length ?? 0) > 0;
  const hasHandoff = !!manifest.handoff_note?.trim();
  const hasQuestions = (manifest.open_questions?.length ?? 0) > 0;
  const richDesc = desc.length > 500 && !desc.startsWith('Branch:');

  // Milestone: title signals shipped/merged/released
  if (/\b(ship|merge[ds]?|release[ds]?|launch|complete[ds]?)\b/i.test(title) && hasDecisions) {
    return 'milestone';
  }

  if (hasDecisions) return 'decision';
  if (richDesc) return 'analysis';
  if (hasHandoff && !hasDecisions) return 'handoff';
  if (hasQuestions && !hasHandoff && !hasDecisions) return 'question';

  return null;
}
