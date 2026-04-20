import { RelayClient } from '@relay/core';
import type { RelayManifest, SearchResult } from '@relay/core';
import { ORCHESTRATOR_SYSTEM_PROMPT } from './prompts.js';

export interface DigestResult {
  /** Assembled context ready for synthesis by the calling agent */
  assembledContext: string;
  /** Pre-built system prompt for the synthesizing agent */
  systemPrompt: string;
  packagesAnalyzed: number;
  openQuestionsFound: number;
  decisionsLogged: number;
}

/**
 * Assemble project context for synthesis.
 *
 * This does NOT call an external AI — it gathers and structures all the data
 * so the calling agent (Claude Code, custom agents, etc.) can synthesize it directly.
 * The agent running this IS the orchestrator.
 */
export async function assembleProjectDigest(
  client: RelayClient,
  projectId: string,
  focus?: string,
  snippetLimit = 25,
): Promise<DigestResult> {
  // 1. Get recent packages
  const packages = await client.getLatestPackages(projectId, 50);

  if (packages.length === 0) {
    return {
      assembledContext: 'No context packages found for this project.',
      systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
      packagesAnalyzed: 0,
      openQuestionsFound: 0,
      decisionsLogged: 0,
    };
  }

  // 2. Try semantic search for relevant snippets
  let snippets: SearchResult[] = [];
  try {
    snippets = await client.search(focus || 'project overview and current state', projectId, snippetLimit);
  } catch {
    // Search may not be available yet
  }

  // 3. Build structured context — significant packages first, auto-deposits summarized
  const significant = packages.filter((p) =>
    (p.decisions_made?.length > 0) || p.handoff_note || (p.open_questions?.length > 0)
  );
  const autoNoise = packages.filter((p) =>
    !(p.decisions_made?.length > 0) && !p.handoff_note && !(p.open_questions?.length > 0)
  );

  const significantText = significant.length > 0
    ? significant.map((p) => [
        `### ${p.title}`,
        `- **ID:** ${p.package_id}`,
        `- **Status:** ${p.status}`,
        `- **Created:** ${p.created_at}`,
        `- **By:** ${p.created_by.type}/${p.created_by.id}`,
        p.decisions_made?.length > 0 ? `- **Decisions:** ${p.decisions_made.join('; ')}` : '',
        p.open_questions?.length > 0 ? `- **Open Questions:** ${p.open_questions.join('; ')}` : '',
        p.handoff_note ? `- **Handoff:** ${p.handoff_note}` : '',
        p.description ? `- **Description:** ${p.description}` : '',
      ].filter(Boolean).join('\n')).join('\n\n')
    : '(No significant deposits found)';

  // Defensive: never crash on missing created_at. The data layer healer
  // in client.getLatestPackages() should have backfilled it from the row,
  // but some legacy package shapes may still slip through.
  const dateOnly = (iso: string | undefined): string =>
    iso ? iso.split('T')[0] : 'unknown date';

  const autoSummary = autoNoise.length > 0
    ? `\n\n### Auto-Deposits (${autoNoise.length} low-signal)\n` +
      autoNoise.slice(0, 10).map((p) => `- ${p.title} (${dateOnly(p.created_at)})`).join('\n') +
      (autoNoise.length > 10 ? `\n- ... and ${autoNoise.length - 10} more` : '')
    : '';

  const packagesText = significantText + autoSummary;

  const snippetsText = snippets.length > 0
    ? snippets.map((s) => `**[${s.content_type}] (similarity: ${s.similarity.toFixed(3)})**\n${s.content}`).join('\n\n---\n\n')
    : '(No semantic search results — embeddings may not be generated yet)';

  const focusSection = focus ? `## Focus Area\nAnalyze with focus on: **${focus}**` : '';

  const oldestCreated = packages[packages.length - 1]?.created_at ?? 'unknown';
  const newestCreated = packages[0]?.created_at ?? 'unknown';

  const assembledContext = [
    `# Project Digest: ${projectId}`,
    `**Packages analyzed:** ${packages.length}`,
    `**Time range:** ${oldestCreated} → ${newestCreated}`,
    '',
    '## Packages (structured metadata)',
    packagesText,
    '',
    '## Relevant Context Snippets (semantic search)',
    snippetsText,
    '',
    focusSection,
  ].filter(Boolean).join('\n');

  const allDecisions = packages.flatMap((p) => p.decisions_made ?? []);
  const allQuestions = packages.flatMap((p) => p.open_questions ?? []);

  return {
    assembledContext,
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    packagesAnalyzed: packages.length,
    openQuestionsFound: allQuestions.length,
    decisionsLogged: allDecisions.length,
  };
}

/**
 * Assemble context across ALL projects — the "overmind" view.
 *
 * By default only active projects are included. Pass
 * `{ includeArchived: true }` to also pull digests for archived projects
 * (useful for historical audits / "what was going on in that project
 * before we shelved it").
 */
export async function assembleGlobalDigest(
  client: RelayClient,
  focus?: string,
  snippetLimit = 25,
  opts: { includeArchived?: boolean } = {},
): Promise<{ projectId: string; digest: DigestResult }[]> {
  const projects = await client.listProjects({
    includeArchived: Boolean(opts.includeArchived),
  });
  const results: { projectId: string; digest: DigestResult }[] = [];

  for (const project of projects) {
    const digest = await assembleProjectDigest(client, project.id, focus, snippetLimit);
    if (digest.packagesAnalyzed > 0) {
      results.push({ projectId: project.id, digest });
    }
  }

  return results;
}
