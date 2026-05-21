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
import { generateQueryEmbedding, rerank } from '@relay/core';
import type { SearchResult } from '@relay/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

interface SearchBody {
  query?: unknown;
  projectId?: unknown;
  daysWindow?: unknown;
  limit?: unknown;
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

  // Per-project hybrid_search. Over-retrieve 3x per project to give the
  // global reranker headroom. Errors are tolerated per-project so one
  // bad RPC doesn't blank the whole result set.
  const perProjectLimit = Math.max(3, Math.ceil((limit * 3) / Math.max(1, targetProjects.length)));
  const perProjectResults = await Promise.all(
    targetProjects.map(async (p) => {
      const { data, error } = await supabase.rpc('hybrid_search', {
        query_text: query,
        query_embedding: JSON.stringify(queryEmbedding),
        project_filter: p.id,
        match_count: perProjectLimit,
        topic_filter: null,
        type_filter: null,
      });
      if (error) {
        // Logged server-side, swallowed for the client.
        console.error(`[/api/search] hybrid_search failed for ${p.id}: ${error.message}`);
        return [] as SearchResult[];
      }
      return (data as SearchResult[]) ?? [];
    }),
  );

  const allHits = perProjectResults.flat();
  if (allHits.length === 0) {
    return Response.json({ hits: [], query, elapsed_ms: Date.now() - start });
  }

  // Cross-encoder rerank over the merged set, capped at 60 candidates so
  // the rerank stays fast even when many projects are searched.
  const candidates = allHits.slice(0, 60);
  const reranked = await rerank(query, candidates, limit);

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
}
