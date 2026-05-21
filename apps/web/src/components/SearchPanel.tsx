'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Semantic search panel for the dashboard.
 *
 * - Search bar with debounced submit on Enter (debounce avoids re-firing on
 *   every keystroke for users who paste long queries).
 * - Project filter chip row — defaults to "All projects" (cross-project
 *   search via the route's per-project loop + global rerank).
 * - Day-window slider — log-scaled stops at 1d / 7d / 30d / 90d / all,
 *   matching the existing MetaControls vocabulary.
 * - Ranked results panel — each card shows project badge, title, time-ago,
 *   topic/artifact pills if present, the matching snippet, and a relevance
 *   bar derived from the rerank similarity score.
 * - Optional "Synthesize" button — fires /api/synthesize on the current
 *   results and renders the LLM paragraph above the list. Off by default
 *   to keep latency snappy; user opts in per query.
 *
 * Phosphor-cyan vocabulary throughout, matching ProjectCards detail view.
 */

interface Hit {
  package_id: string;
  project_id: string;
  project_name: string;
  title: string;
  description: string | null;
  handoff_note: string | null;
  content: string | null;
  similarity?: number;
  created_at: string;
  topic: string | null;
  artifact_type: string | null;
  significance: number | null;
  callsign?: string | null;
}

interface Project {
  id: string;
  name: string;
}

const DAY_STOPS: Array<{ value: number | null; label: string }> = [
  { value: 1, label: '1d' },
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: null, label: 'ALL' },
];

export default function SearchPanel() {
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [daysWindow, setDaysWindow] = useState<number | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  // Synthesize state
  const [synthesizing, setSynthesizing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Project list for the filter chip row. Best-effort; if it fails, the
  // chip row just shows "All projects" and search still works.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, name')
        .is('archived_at', null)
        .order('name', { ascending: true });
      if (!cancelled && data) setProjects(data as Project[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setSummary(null);
    setSummaryError(null);
    try {
      const resp = await fetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, projectId, daysWindow, limit: 15 }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setError(json.message || json.error || 'Search failed');
        setHits([]);
        return;
      }
      setHits(json.hits ?? []);
      setElapsedMs(json.elapsed_ms ?? null);
    } catch (e) {
      setError((e as Error).message);
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, [query, projectId, daysWindow]);

  const runSynthesize = useCallback(async () => {
    if (hits.length === 0) return;
    setSynthesizing(true);
    setSummaryError(null);
    try {
      const resp = await fetch('/api/synthesize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query,
          hits: hits.slice(0, 8).map((h) => ({
            title: h.title,
            project_name: h.project_name,
            description: h.description,
            handoff_note: h.handoff_note,
            content: h.content,
            created_at: h.created_at,
          })),
        }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setSummaryError(json.message || json.error || 'Synthesize failed');
        return;
      }
      setSummary(json.summary ?? null);
    } catch (e) {
      setSummaryError((e as Error).message);
    } finally {
      setSynthesizing(false);
    }
  }, [hits, query]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !loading) {
        e.preventDefault();
        runSearch();
      }
    },
    [runSearch, loading],
  );

  const maxSimilarity = useMemo(
    () =>
      hits.reduce(
        (m, h) => Math.max(m, typeof h.similarity === 'number' ? h.similarity : 0),
        0,
      ) || 1,
    [hits],
  );

  return (
    <div className="rs-panel rs-panel-raised" style={{ padding: '14px 16px' }}>
      {/* Query input + run button */}
      <div className="flex gap-2 items-stretch">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="search context — try 'auth refactor', 'Retro spec', 'LongMemEval'…"
          spellCheck={false}
          autoComplete="off"
          className="rs-text-mono text-[12px] grow"
          style={{
            background: 'rgba(8, 10, 14, 0.85)',
            border: '1px solid rgba(127, 255, 212, 0.20)',
            color: 'rgba(127, 255, 212, 0.95)',
            padding: '8px 12px',
            borderRadius: 6,
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={loading || !query.trim()}
          className="rs-text-mono text-[11px]"
          style={{
            padding: '6px 16px',
            background: loading ? 'rgba(127, 255, 212, 0.05)' : 'rgba(127, 255, 212, 0.12)',
            border: '1px solid rgba(127, 255, 212, 0.45)',
            color: 'rgba(127, 255, 212, 0.95)',
            cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            borderRadius: 6,
            minWidth: 96,
          }}
        >
          {loading ? '...' : 'SEARCH'}
        </button>
      </div>

      {/* Day window slider */}
      <div className="flex items-center gap-2 mt-3">
        <span
          className="rs-text-mono shrink-0"
          style={{ fontSize: 9, color: 'rgba(255, 179, 71, 0.7)', letterSpacing: 1.5, textTransform: 'uppercase' }}
        >
          Window
        </span>
        {DAY_STOPS.map((stop) => {
          const active = daysWindow === stop.value;
          return (
            <button
              key={stop.label}
              type="button"
              onClick={() => setDaysWindow(stop.value)}
              className="rs-text-mono"
              style={{
                fontSize: 10,
                padding: '3px 9px',
                background: active ? 'rgba(255, 179, 71, 0.15)' : 'transparent',
                border: `1px solid ${active ? 'rgba(255, 179, 71, 0.55)' : 'rgba(255, 179, 71, 0.18)'}`,
                color: active ? 'rgba(255, 179, 71, 0.95)' : 'rgba(255, 179, 71, 0.55)',
                cursor: 'pointer',
                borderRadius: 4,
                letterSpacing: 1.2,
              }}
            >
              {stop.label}
            </button>
          );
        })}
      </div>

      {/* Project filter chips */}
      {projects.length > 0 && (
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span
            className="rs-text-mono shrink-0"
            style={{ fontSize: 9, color: 'rgba(0, 221, 255, 0.65)', letterSpacing: 1.5, textTransform: 'uppercase' }}
          >
            Project
          </span>
          <button
            type="button"
            onClick={() => setProjectId(null)}
            className="rs-text-mono"
            style={{
              fontSize: 10,
              padding: '3px 9px',
              background: projectId === null ? 'rgba(0, 221, 255, 0.15)' : 'transparent',
              border: `1px solid ${projectId === null ? 'rgba(0, 221, 255, 0.55)' : 'rgba(0, 221, 255, 0.18)'}`,
              color: projectId === null ? 'rgba(0, 221, 255, 0.95)' : 'rgba(0, 221, 255, 0.55)',
              cursor: 'pointer',
              borderRadius: 4,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
            }}
          >
            ALL
          </button>
          {projects.map((p) => {
            const active = projectId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setProjectId(p.id)}
                className="rs-text-mono"
                style={{
                  fontSize: 10,
                  padding: '3px 9px',
                  background: active ? 'rgba(0, 221, 255, 0.15)' : 'transparent',
                  border: `1px solid ${active ? 'rgba(0, 221, 255, 0.55)' : 'rgba(0, 221, 255, 0.18)'}`,
                  color: active ? 'rgba(0, 221, 255, 0.95)' : 'rgba(0, 221, 255, 0.45)',
                  cursor: 'pointer',
                  borderRadius: 4,
                  letterSpacing: 0.8,
                }}
                title={p.name}
              >
                {p.name.toUpperCase()}
              </button>
            );
          })}
        </div>
      )}

      {/* Result meta row */}
      {(hits.length > 0 || error) && (
        <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <span
            className="rs-text-mono"
            style={{
              fontSize: 10,
              color: error ? 'rgba(255, 107, 107, 0.85)' : 'rgba(127, 255, 212, 0.65)',
              letterSpacing: 1.2,
              textTransform: 'uppercase',
            }}
          >
            {error
              ? `error: ${error}`
              : `${hits.length} hit${hits.length === 1 ? '' : 's'}${elapsedMs ? ` · ${elapsedMs}ms` : ''}`}
          </span>
          {hits.length > 0 && (
            <button
              type="button"
              onClick={runSynthesize}
              disabled={synthesizing}
              className="rs-text-mono"
              style={{
                fontSize: 10,
                padding: '4px 12px',
                background: synthesizing ? 'rgba(212, 245, 0, 0.05)' : 'rgba(212, 245, 0, 0.10)',
                border: '1px solid rgba(212, 245, 0, 0.45)',
                color: 'rgba(212, 245, 0, 0.95)',
                cursor: synthesizing ? 'not-allowed' : 'pointer',
                letterSpacing: 1.5,
                textTransform: 'uppercase',
                borderRadius: 4,
              }}
            >
              {synthesizing ? '...' : summary ? 'RE-SYNTHESIZE' : 'SYNTHESIZE'}
            </button>
          )}
        </div>
      )}

      {/* LLM synthesis paragraph */}
      {summary && (
        <div
          className="mt-3 rounded px-3 py-2"
          style={{
            background: 'rgba(212, 245, 0, 0.05)',
            border: '1px solid rgba(212, 245, 0, 0.20)',
          }}
        >
          <div
            className="rs-text-mono"
            style={{ fontSize: 9, color: 'rgba(212, 245, 0, 0.7)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}
          >
            SYNTHESIS
          </div>
          <p className="rs-text-mono text-[11px]" style={{ color: 'rgba(212, 245, 0, 0.88)', lineHeight: 1.6 }}>
            {summary}
          </p>
        </div>
      )}
      {summaryError && (
        <div className="mt-3 rs-text-mono text-[10px]" style={{ color: 'rgba(255, 107, 107, 0.85)' }}>
          synthesize error: {summaryError}
        </div>
      )}

      {/* Results */}
      {hits.length > 0 && (
        <ul className="mt-3 space-y-2">
          {hits.map((h, i) => (
            <li
              key={h.package_id}
              className="rounded px-3 py-2"
              style={{
                background: 'rgba(127, 255, 212, 0.03)',
                border: '1px solid rgba(127, 255, 212, 0.12)',
              }}
            >
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span
                  className="rs-text-mono shrink-0"
                  style={{ fontSize: 9, color: 'rgba(127, 255, 212, 0.55)', minWidth: 24 }}
                >
                  #{i + 1}
                </span>
                <span
                  className="rs-text-mono"
                  style={{
                    fontSize: 9,
                    color: 'rgba(0, 221, 255, 0.75)',
                    background: 'rgba(0, 221, 255, 0.08)',
                    padding: '1px 6px',
                    borderRadius: 3,
                    letterSpacing: 0.5,
                  }}
                >
                  {h.project_name}
                </span>
                <span className="rs-text-mono text-[11px] grow text-white/80 truncate" title={h.title}>
                  {h.title}
                </span>
                {h.topic && (
                  <span
                    className="rs-text-mono shrink-0"
                    style={{
                      fontSize: 8,
                      color: 'rgba(255, 179, 71, 0.65)',
                      letterSpacing: 1,
                      textTransform: 'uppercase',
                    }}
                  >
                    {h.topic}
                  </span>
                )}
                <span
                  className="rs-text-mono shrink-0"
                  style={{ fontSize: 9, color: 'rgba(255, 255, 255, 0.35)' }}
                >
                  {timeAgo(h.created_at)}
                </span>
              </div>
              {(h.content || h.description) && (
                <p
                  className="rs-text-mono text-[10px]"
                  style={{ color: 'rgba(255, 255, 255, 0.55)', lineHeight: 1.55 }}
                >
                  {truncate(h.content || h.description || '', 280)}
                </p>
              )}
              {h.handoff_note && (
                <p
                  className="rs-text-mono text-[10px] mt-1"
                  style={{ color: 'rgba(0, 221, 255, 0.75)' }}
                >
                  ↳ {truncate(h.handoff_note, 200)}
                </p>
              )}
              {typeof h.similarity === 'number' && (
                <div className="flex items-center gap-2 mt-2">
                  <span
                    className="rs-text-mono shrink-0"
                    style={{ fontSize: 8, color: 'rgba(255, 255, 255, 0.30)', letterSpacing: 1, width: 48 }}
                  >
                    RELEVANCE
                  </span>
                  <div
                    className="grow rounded-sm"
                    style={{
                      height: 4,
                      background: 'rgba(127, 255, 212, 0.06)',
                      border: '1px solid rgba(127, 255, 212, 0.12)',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.max(4, Math.round((h.similarity / maxSimilarity) * 100))}%`,
                        height: '100%',
                        background: 'rgba(127, 255, 212, 0.55)',
                      }}
                    />
                  </div>
                  <span
                    className="rs-text-mono shrink-0"
                    style={{ fontSize: 8, color: 'rgba(127, 255, 212, 0.65)', width: 32, textAlign: 'right' }}
                  >
                    {h.similarity.toFixed(2)}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Empty state */}
      {!loading && hits.length === 0 && !error && query.trim() && (
        <div
          className="mt-3 rs-text-mono text-[10px]"
          style={{ color: 'rgba(255, 255, 255, 0.40)', fontStyle: 'italic' }}
        >
          no hits — try broadening the day window or removing the project filter
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'now';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.round(d / 30);
  if (mo < 18) return `${mo}mo`;
  return `${Math.round(d / 365)}y`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trim() + '…';
}
