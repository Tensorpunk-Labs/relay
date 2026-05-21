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
}

interface IncomingHit {
  title?: string;
  project_name?: string;
  description?: string | null;
  handoff_note?: string | null;
  content?: string | null;
  created_at?: string;
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_HITS = 8; // cap context to keep latency bounded
const MAX_HIT_TEXT = 400; // chars per hit chunk

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

  const model = typeof body.model === 'string' && body.model ? body.model : DEFAULT_MODEL;

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

  const systemPrompt = `You are a research assistant inside the Relay dashboard. The user has queried the project's deposit history and the retrieval pipeline returned the most relevant context packages. Your job is to synthesize them into ONE tight paragraph (3-5 sentences) that answers the user's query.

Rules:
- Lead with the through-line — the pattern across deposits, not a list.
- Mention concrete decisions, files, projects when they appear in the source material. Quote phrases verbatim when they're load-bearing.
- If results disagree or evolve over time, surface that ("early deposits chose X, later ones switched to Y").
- If results don't actually answer the query, say so honestly — don't pad.
- No bullet lists, no headings, no preamble. One paragraph.
- Refer to packages by short title, not package ID.

The user reads this above the raw ranked list, so you're orienting them, not replacing the list.`;

  const userPrompt = `Query: ${query}

${hits.length} results:

${formattedHits}`;

  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
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
