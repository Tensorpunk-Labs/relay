/**
 * POST /api/search — hybrid retrieval (BM25 + pgvector) + cross-encoder
 * reranking over the calling user's Relay packages.
 *
 * Body shape:
 *   {
 *     query: string;                  // required
 *     projectId?: string;             // optional — omit for cross-project
 *     daysWindow?: number;            // optional — filter by created_at
 *     limit?: number;                 // default 15
 *   }
 *
 * Returns:
 *   {
 *     hits: Array<{ package_id, project_id, project_name, title, description,
 *                   handoff_note, content, similarity, created_at, topic,
 *                   artifact_type, significance, callsign? }>
 *     query: string;
 *     elapsed_ms: number;
 *   }
 *
 * Uses the service-role Supabase key on the server so the search bypasses
 * RLS and can scan across all projects. The key NEVER leaves this route.
 */

import { createClient } from '@supabase/supabase-js';

// @relay/core is the canonical source for generateQueryEmbedding + rerank,
// but the dashboard Vercel project only uploads apps/web (no monorepo
// context), so the workspace dep can't resolve at build time. We
// dynamic-import it inside the semantic branch — if the load fails the
// route returns 503 and the UI surfaces "semantic unavailable on this
// deployment". Keyword mode is unaffected and stays fully live.
//
// Self-hosted instances running from the monorepo get full semantic
// search because @relay/core resolves via the workspace.

interface SearchResult {
  package_id: string;
  content_type: string;
  content: string;
  similarity: number;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Same fallback shape as lib/supabase.ts — env vars may be absent during
// the Next.js build's static route-data collection step (NEXT_PUBLIC_
// vars are inlined at build time, missing ones leave the literal
// undefined). Using a placeholder URL lets the route module evaluate;
// real env presence is checked at request time before any RPC call.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'placeholder-key';

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

interface SearchBody {
  query?: unknown;
  projectId?: unknown;
  daysWindow?: unknown;
  limit?: unknown;
  /**
   * Search mode:
   *   - "semantic" (default): embedding + reranker pipeline. Best for fuzzy
   *     conceptual queries ("how did we handle auth tokens?").
   *   - "keyword": pure substring match across title, description, handoff,
   *     and context_md via PostgREST ilike. Best for exact identifiers,
   *     file paths, IDs, and specific phrasings. No model load — fast cold-
   *     start.
   */
  mode?: unknown;
}

interface RankedHit extends SearchResult {
  package_id: string;
  project_id: string;
  project_name: string;
  title: string;
  description: string | null;
  handoff_note: string | null;
  created_at: string;
  topic: string | null;
  artifact_type: string | null;
  significance: number | null;
  callsign?: string | null;
}

export async function POST(request: Request) {
  const start = Date.now();
  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) return Response.json({ error: 'missing_query' }, { status: 400 });

  const limit = typeof body.limit === 'number' && body.limit > 0 && body.limit <= 50 ? body.limit : 15;
  const projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null;
  const daysWindow =
    typeof body.daysWindow === 'number' && body.daysWindow > 0 && body.daysWindow <= 3650
      ? body.daysWindow
      : null;
  const mode: 'semantic' | 'keyword' = body.mode === 'keyword' ? 'keyword' : 'semantic';

  // Keyword mode branch — no embedding model load, no reranker. Direct
  // ilike search across title, description, handoff_note, context_md.
  // Faster cold-start; better for exact identifiers / file paths.
  if (mode === 'keyword') {
    return keywordSearch({ query, projectId, daysWindow, limit, start });
  }

  // Semantic search is gated on the deployed dashboard. The pipeline
  // (Xenova/all-MiniLM-L6-v2 + bge-reranker-base) lives in @relay/core
  // which is a workspace dep that doesn't resolve when apps/web is
  // deployed standalone on Vercel. Self-hosted users running from the
  // monorepo can re-enable by importing { generateQueryEmbedding, rerank }
  // from @relay/core and uncommenting the embedding + rerank lines below.
  // Demo mode in the UI gates this client-side anyway so the route is
  // effectively never reached for semantic queries on the public deploy.
  return Response.json(
    {
      error: 'semantic_unavailable',
      message:
        'Semantic search is disabled on this deployment. Use mode="keyword" — or, if self-hosting, wire @relay/core back into apps/web and uncomment the embedding + rerank pipeline in src/app/api/search/route.ts.',
    },
    { status: 503 },
  );

  /* SEMANTIC PIPELINE — uncomment after wiring @relay/core back in:
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateQueryEmbedding(query);
  } catch (e) {
    return Response.json(
      { error: 'embedding_failed', message: (e as Error).message },
      { status: 500 },
    );
  }

  // Resolve target project list. Single project if provided, else all
  // non-archived projects. We loop because the existing hybrid_search RPC
  // requires a project filter; cross-project is a client-side merge.
  let targetProjects: { id: string; name: string }[];
  if (projectId) {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .limit(1);
    if (error || !data || data.length === 0) {
      return Response.json({ error: 'project_not_found' }, { status: 404 });
    }
    targetProjects = data;
  } else {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name')
      .is('archived_at', null);
    if (error) {
      return Response.json(
        { error: 'projects_query_failed', message: error.message },
        { status: 500 },
      );
    }
    targetProjects = data ?? [];
  }

  if (targetProjects.length === 0) {
    return Response.json({ hits: [], query, elapsed_ms: Date.now() - start });
  }

  // Per-project search. Try hybrid_search first (BM25 + semantic via RRF);
  // fall back to search_context (semantic-only) if the hybrid RPC is
  // missing in the target Supabase project. Mirrors RelayClient.search().
  // Over-retrieve 3x per project for global reranker headroom; errors are
  // tolerated per-project so one bad RPC doesn't blank the whole set.
  const perProjectLimit = Math.max(3, Math.ceil((limit * 3) / Math.max(1, targetProjects.length)));
  const perProjectResults = await Promise.all(
    targetProjects.map(async (p) => {
      // Try hybrid first
      const hybrid = await supabase.rpc('hybrid_search', {
        query_text: query,
        query_embedding: JSON.stringify(queryEmbedding),
        project_filter: p.id,
        match_count: perProjectLimit,
        topic_filter: null,
        type_filter: null,
      });
      if (!hybrid.error) {
        return (hybrid.data as SearchResult[]) ?? [];
      }
      const msg = hybrid.error.message ?? '';
      const missingHybrid = /hybrid_search/.test(msg) || /PGRST202/.test(hybrid.error.code ?? '');
      if (!missingHybrid) {
        console.error(`[/api/search] hybrid_search failed for ${p.id}: ${msg}`);
        return [] as SearchResult[];
      }
      // Fall back to semantic-only
      const sem = await supabase.rpc('search_context', {
        query_embedding: JSON.stringify(queryEmbedding),
        project_filter: p.id,
        match_count: perProjectLimit,
      });
      if (sem.error) {
        console.error(`[/api/search] search_context failed for ${p.id}: ${sem.error.message}`);
        return [] as SearchResult[];
      }
      return (sem.data as SearchResult[]) ?? [];
    }),
  );

  const allHits = perProjectResults.flat();
  if (allHits.length === 0) {
    return Response.json({ hits: [], query, elapsed_ms: Date.now() - start });
  }

  // Cross-encoder rerank over the merged set, capped at 60 candidates so
  // the rerank stays fast even when many projects are searched.
  const candidates = allHits.slice(0, 60);
  const reranked = await core!.rerank(query, candidates, limit);

  // Dedupe by package_id, preserving rerank order.
  const seen = new Set<string>();
  const dedupedIds: string[] = [];
  for (const h of reranked) {
    const pid = (h as SearchResult & { package_id?: string }).package_id;
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    dedupedIds.push(pid);
  }
  if (dedupedIds.length === 0) {
    return Response.json({ hits: [], query, elapsed_ms: Date.now() - start });
  }

  // Hydrate full package rows for each hit. One IN query so it's a single
  // round-trip regardless of cross-project spread.
  type PackageRowSlim = {
    id: string;
    project_id: string;
    title: string;
    description: string | null;
    handoff_note: string | null;
    created_at: string;
    topic: string | null;
    artifact_type: string | null;
    significance: number | null;
    session_id: string | null;
  };
  const { data: pkgRows } = await supabase
    .from('context_packages')
    .select('id, project_id, title, description, handoff_note, created_at, topic, artifact_type, significance, session_id')
    .in('id', dedupedIds);

  const pkgById = new Map<string, PackageRowSlim>();
  for (const r of (pkgRows ?? []) as PackageRowSlim[]) pkgById.set(r.id, r);

  // Optional callsign hydration — best-effort.
  const sessionIds = [...new Set([...pkgById.values()].map((r) => r.session_id).filter(Boolean))] as string[];
  const callsignBySession = new Map<string, string>();
  if (sessionIds.length > 0) {
    const { data: sessRows } = await supabase
      .from('sessions')
      .select('id, callsign')
      .in('id', sessionIds);
    for (const r of (sessRows ?? []) as { id: string; callsign: string | null }[]) {
      if (r.callsign) callsignBySession.set(r.id, r.callsign);
    }
  }

  const projectNameById = new Map<string, string>();
  for (const p of targetProjects) projectNameById.set(p.id, p.name);

  // Apply daysWindow filter at the end (cheaper than per-RPC date filtering).
  const cutoff = daysWindow ? Date.now() - daysWindow * 86_400_000 : null;

  const hits: RankedHit[] = [];
  for (const id of dedupedIds) {
    const row = pkgById.get(id);
    if (!row) continue;
    if (cutoff && new Date(row.created_at).getTime() < cutoff) continue;
    const original = reranked.find((h) => (h as SearchResult & { package_id?: string }).package_id === id);
    hits.push({
      ...(original as SearchResult),
      package_id: row.id,
      project_id: row.project_id,
      project_name: projectNameById.get(row.project_id) ?? '(unknown project)',
      title: row.title,
      description: row.description,
      handoff_note: row.handoff_note,
      created_at: row.created_at,
      topic: row.topic,
      artifact_type: row.artifact_type,
      significance: row.significance,
      callsign: row.session_id ? callsignBySession.get(row.session_id) ?? null : null,
    });
  }

  return Response.json({ hits, query, elapsed_ms: Date.now() - start });
  END SEMANTIC PIPELINE COMMENT */
}

// ---------------------------------------------------------------------------
// Keyword mode — pure substring search, no model load
// ---------------------------------------------------------------------------

/**
 * Keyword search: PostgREST ilike across title, description, handoff_note,
 * and context_md. No embedding, no reranker — best for exact identifiers,
 * file paths, package IDs, and specific phrasings. Cold-start is instant.
 *
 * Ranking is a synthetic per-column weight (title=4, description=3,
 * handoff=2, context_md=1) summed across matches, then by created_at DESC
 * for ties.
 */
async function keywordSearch(args: {
  query: string;
  projectId: string | null;
  daysWindow: number | null;
  limit: number;
  start: number;
}): Promise<Response> {
  const { query, projectId, daysWindow, limit, start } = args;

  // PostgREST treats commas in `.or(...)` as clause separators. Escape any
  // commas in the user query by replacing with a wildcard so substring
  // match still works without breaking the URL.
  const safe = query.replace(/[,()]/g, '_');
  const pattern = `%${safe}%`;

  // Build the base query — service-role key bypasses RLS.
  let qb = supabase
    .from('context_packages')
    .select(
      'id, project_id, title, description, handoff_note, context_md, created_at, topic, artifact_type, significance, session_id',
    );
  if (projectId) qb = qb.eq('project_id', projectId);
  if (daysWindow) {
    const cutoff = new Date(Date.now() - daysWindow * 86_400_000).toISOString();
    qb = qb.gte('created_at', cutoff);
  }
  // Match on any of the four text columns.
  qb = qb.or(
    `title.ilike.${pattern},description.ilike.${pattern},handoff_note.ilike.${pattern},context_md.ilike.${pattern}`,
  );
  qb = qb.order('created_at', { ascending: false }).limit(limit * 3);

  type Row = {
    id: string;
    project_id: string;
    title: string;
    description: string | null;
    handoff_note: string | null;
    context_md: string | null;
    created_at: string;
    topic: string | null;
    artifact_type: string | null;
    significance: number | null;
    session_id: string | null;
  };

  const { data, error } = (await qb) as { data: Row[] | null; error: { message: string } | null };
  if (error) {
    return Response.json(
      { error: 'keyword_search_failed', message: error.message },
      { status: 500 },
    );
  }
  const rows: Row[] = data ?? [];
  if (rows.length === 0) {
    return Response.json({ hits: [], query, elapsed_ms: Date.now() - start, mode: 'keyword' });
  }

  // Score by column weights + recency tiebreak.
  const qLower = query.toLowerCase();
  type ScoredRow = Row & { score: number; snippet: string };
  const scored: ScoredRow[] = rows.map((r) => {
    let score = 0;
    const titleHit = r.title?.toLowerCase().includes(qLower) ? 4 : 0;
    const descHit = r.description?.toLowerCase().includes(qLower) ? 3 : 0;
    const handoffHit = r.handoff_note?.toLowerCase().includes(qLower) ? 2 : 0;
    const ctxHit = r.context_md?.toLowerCase().includes(qLower) ? 1 : 0;
    score = titleHit + descHit + handoffHit + ctxHit;

    // Build a snippet from the highest-priority matched column.
    let snippet = '';
    if (titleHit) snippet = r.title;
    else if (descHit && r.description) snippet = excerptAroundMatch(r.description, qLower);
    else if (handoffHit && r.handoff_note) snippet = excerptAroundMatch(r.handoff_note, qLower);
    else if (ctxHit && r.context_md) snippet = excerptAroundMatch(r.context_md, qLower);
    else snippet = r.description ?? r.title;

    return { ...r, score, snippet };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const top = scored.slice(0, limit);

  // Hydrate project names + callsigns
  const projectIds = [...new Set(top.map((r) => r.project_id))];
  const projectNameById = new Map<string, string>();
  if (projectIds.length > 0) {
    const { data: pdata } = await supabase
      .from('projects')
      .select('id, name')
      .in('id', projectIds);
    for (const p of (pdata ?? []) as { id: string; name: string }[]) {
      projectNameById.set(p.id, p.name);
    }
  }
  const sessionIds = [...new Set(top.map((r) => r.session_id).filter(Boolean))] as string[];
  const callsignBySession = new Map<string, string>();
  if (sessionIds.length > 0) {
    const { data: sdata } = await supabase
      .from('sessions')
      .select('id, callsign')
      .in('id', sessionIds);
    for (const s of (sdata ?? []) as { id: string; callsign: string | null }[]) {
      if (s.callsign) callsignBySession.set(s.id, s.callsign);
    }
  }

  // Normalize score to a 0..1 similarity for visual parity with semantic mode.
  const maxScore = Math.max(...top.map((r) => r.score), 1);

  const hits = top.map((r) => ({
    package_id: r.id,
    project_id: r.project_id,
    project_name: projectNameById.get(r.project_id) ?? '(unknown project)',
    title: r.title,
    description: r.description,
    handoff_note: r.handoff_note,
    content: r.snippet,
    similarity: r.score / maxScore,
    created_at: r.created_at,
    topic: r.topic,
    artifact_type: r.artifact_type,
    significance: r.significance,
    callsign: r.session_id ? callsignBySession.get(r.session_id) ?? null : null,
    content_type: 'context_md' as const,
  }));

  return Response.json({ hits, query, elapsed_ms: Date.now() - start, mode: 'keyword' });
}

/**
 * Extract a ~200-char window around the first occurrence of `qLower` in
 * `text`. Used to show the user where the match landed in context_md.
 */
function excerptAroundMatch(text: string, qLower: string): string {
  if (!text) return '';
  const idx = text.toLowerCase().indexOf(qLower);
  if (idx < 0) return text.slice(0, 220);
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + qLower.length + 140);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return prefix + text.slice(start, end).replace(/\s+/g, ' ').trim() + suffix;
}
