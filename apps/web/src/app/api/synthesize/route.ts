/**
 * POST /api/synthesize — Anthropic-backed summary of a search-hit set.
 *
 * Given the top-K hits from /api/search, produce a single tight paragraph
 * answering: "across these deposits, what's the through-line?". The user
 * sees this above the raw ranked list when they click "Synthesize" in the
 * dashboard search panel.
 *
 * Body shape:
 *   {
 *     query: string;                  // the original search query
 *     hits: Array<{                   // top K from /api/search
 *       title: string;
 *       project_name: string;
 *       description?: string | null;
 *       handoff_note?: string | null;
 *       content?: string | null;
 *       created_at: string;
 *     }>;
 *     model?: string;                 // optional override (default haiku)
 *   }
 *
 * Returns:
 *   { summary: string; model: string; elapsed_ms: number; }
 *
 * Server-side only. The ANTHROPIC_API_KEY env var NEVER leaves this route.
 */

import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

interface SynthesizeBody {
  query?: unknown;
  hits?: unknown;
  model?: unknown;
  depth?: unknown; // 'quick' | 'standard' | 'deep'
}

interface IncomingHit {
  title?: string;
  project_name?: string;
  description?: string | null;
  handoff_note?: string | null;
  content?: string | null;
  created_at?: string;
}

/**
 * Depth presets — caller picks one or passes an explicit model override.
 *
 *   quick    — Haiku, 1024 tokens, ~2-3s, terse paragraph
 *   standard — Sonnet, 2048 tokens, ~5-8s, paragraph with concrete examples
 *   deep     — Sonnet, 4096 tokens, ~10-15s, multi-paragraph with full
 *              decision/timeline extraction
 *
 * Default is `standard` — quality matters for a search assistant. Users
 * who care about latency can pass depth=quick. Users who want maximum
 * synthesis can pass depth=deep or override model directly.
 */
const DEPTH_PRESETS: Record<string, { model: string; max_tokens: number }> = {
  quick: { model: 'claude-haiku-4-5-20251001', max_tokens: 1024 },
  standard: { model: 'claude-sonnet-4-6', max_tokens: 2048 },
  deep: { model: 'claude-sonnet-4-6', max_tokens: 4096 },
};
const DEFAULT_DEPTH = 'standard';
const MAX_HITS = 10; // cap context to keep latency bounded
const MAX_HIT_TEXT = 800; // chars per hit chunk — bumped from 400 for richer source material

export async function POST(request: Request) {
  const start = Date.now();

  if (!ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'anthropic_key_missing', message: 'Set ANTHROPIC_API_KEY in the server env.' },
      { status: 500 },
    );
  }

  let body: SynthesizeBody;
  try {
    body = (await request.json()) as SynthesizeBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) return Response.json({ error: 'missing_query' }, { status: 400 });

  const incomingHits: IncomingHit[] = Array.isArray(body.hits) ? (body.hits as IncomingHit[]) : [];
  if (incomingHits.length === 0) {
    return Response.json({ error: 'no_hits' }, { status: 400 });
  }

  const depthKey =
    typeof body.depth === 'string' && DEPTH_PRESETS[body.depth] ? body.depth : DEFAULT_DEPTH;
  const preset = DEPTH_PRESETS[depthKey];
  // Explicit body.model overrides the depth preset's model.
  const model = typeof body.model === 'string' && body.model ? body.model : preset.model;
  const maxTokens = preset.max_tokens;

  const hits = incomingHits.slice(0, MAX_HITS);
  const formattedHits = hits
    .map((h, i) => {
      const bits: string[] = [];
      bits.push(`### Result ${i + 1} — ${h.title ?? '(untitled)'}`);
      const meta: string[] = [];
      if (h.project_name) meta.push(`project: ${h.project_name}`);
      if (h.created_at) meta.push(`at: ${h.created_at}`);
      if (meta.length) bits.push(meta.join(' · '));
      if (h.description) bits.push(`Description: ${truncate(h.description, MAX_HIT_TEXT)}`);
      if (h.handoff_note) bits.push(`Handoff: ${truncate(h.handoff_note, MAX_HIT_TEXT)}`);
      if (h.content && h.content !== h.description) {
        bits.push(`Snippet: ${truncate(h.content, MAX_HIT_TEXT)}`);
      }
      return bits.join('\n');
    })
    .join('\n\n---\n\n');

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const systemPrompt = `You are a senior research analyst inside the Relay dashboard. The user has queried their deposit history (a structured journal of decisions, open questions, handoffs, and the files in context for each work session across all their projects) and the retrieval pipeline returned the most relevant context packages. Your job is to produce a HIGH-VALUE synthesis that gives the user something they couldn't get by skimming the raw list themselves.

What "high-value" means here:

1. **Extract the through-line.** Don't enumerate results. Find the pattern that connects them: a shared technical thread, an evolving decision, a recurring tension between deposits. Lead with that.

2. **Be concrete.** Name files, decisions, projects, package titles, dates, callsigns, file paths. Quote load-bearing phrases verbatim ("we chose X over Y because..."). Avoid generic summary language ("the user worked on various features").

3. **Surface evolution and contradiction.** If early deposits chose one approach and later ones reversed it, say so explicitly with both ends quoted. If two deposits disagree, name the disagreement. If a deposit raised an open question that a later one answered, draw that thread.

4. **Identify what's NOT in the results.** If the user's query has obvious gaps in the returned packages — missing decisions, open questions never resolved, files referenced but never deposited about — say so. This is often more useful than the synthesis itself.

5. **End with a concrete next move when one is obvious.** If reading these deposits suggests an unresolved question or a useful follow-up the user should consider, state it as one sentence.

Format:
- Two to four paragraphs separated by blank lines. Not bullet lists. Not headings.
- Refer to packages by their short title in *italics* (e.g., "*Fork B shipped*"), not by package ID.
- When quoting verbatim, use "quotation marks" around the source phrase.
- Do not write a preamble ("Based on the search results..."). Start with substance.

If the returned packages don't actually answer the query, say so honestly in one or two sentences — don't pad with unrelated material. A short honest "these don't really answer X, but they do show Y" is more useful than a long synthesis that strains to be relevant.`;

  const userPrompt = `Query: ${query}

${hits.length} results:

${formattedHits}`;

  try {
    const resp = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text =
      resp.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .filter((s) => s.length > 0)
        .join('\n')
        .trim() || '(empty response)';

    return Response.json({ summary: text, model, elapsed_ms: Date.now() - start });
  } catch (e) {
    return Response.json(
      { error: 'anthropic_call_failed', message: (e as Error).message },
      { status: 500 },
    );
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}
