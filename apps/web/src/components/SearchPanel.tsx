'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Semantic + keyword search panel for the dashboard.
 *
 * Two modes:
 *   - SEMANTIC: embedding + hybrid/semantic RPC + cross-encoder rerank.
 *     Best for fuzzy conceptual queries. First query is slow (~10-30s)
 *     because the Node process loads the ONNX embedding model.
 *   - KEYWORD: PostgREST ilike across title/description/handoff/context_md.
 *     Best for exact identifiers, file paths, package IDs. Sub-second.
 *
 * Result cards expand inline on click to reveal package_id, full
 * decisions, open questions, handoff, deliverables, callsign, copy-id.
 *
 * Synthesize has three depth presets — quick (Haiku 1k), standard
 * (Sonnet 2k), deep (Sonnet 4k). Default standard.
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

interface FullPackage {
  id: string;
  title: string;
  description: string | null;
  decisions_made: string[];
  open_questions: string[];
  handoff_note: string | null;
  deliverables: { path: string; type?: string }[];
  status: string;
  package_type: string;
  topic: string | null;
  artifact_type: string | null;
  created_at: string;
  created_by_type: string;
  created_by_id: string;
  context_snapshot?: {
    session_shape?: { files: number; lines: number; dominant_categories: string[] };
  } | null;
}

interface Project {
  id: string;
  name: string;
}

type Mode = 'semantic' | 'keyword';
type Depth = 'quick' | 'standard' | 'deep';

const DAY_STOPS: Array<{ value: number | null; label: string }> = [
  { value: 1, label: '1d' },
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: null, label: 'ALL' },
];

const DEPTHS: Array<{ value: Depth; label: string; sub: string }> = [
  { value: 'quick', label: 'QUICK', sub: 'haiku · ~3s' },
  { value: 'standard', label: 'STANDARD', sub: 'sonnet · ~8s' },
  { value: 'deep', label: 'DEEP', sub: 'sonnet × 4k · ~15s' },
];

const API_BASE = '/dashboard';

// Status messages cycle while the search is running so the loading state
// communicates more than a dead spinner. Tuples are [seconds-elapsed, text].
const SEMANTIC_STAGES: Array<[number, string]> = [
  [0, 'Initializing semantic pipeline…'],
  [2, 'Generating query embedding…'],
  [5, 'Searching projects via pgvector…'],
  [10, 'Reranking with bge-reranker-base…'],
  [18, 'Still working — first query loads the embedding model into the Node process (~20-30s cold start)…'],
  [40, 'Almost there — the model cache is warm now for next query…'],
];
const KEYWORD_STAGES: Array<[number, string]> = [
  [0, 'Searching across title, description, handoff, and context_md…'],
];

const SYNTH_STAGES: Array<[number, string]> = [
  [0, 'Sending top results to Claude for synthesis…'],
  [4, 'Extracting through-line and concrete examples…'],
  [10, 'Looking for evolution and contradictions across deposits…'],
  [20, 'Still synthesizing — deep mode runs to 4k tokens…'],
];

export default function SearchPanel() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('semantic');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [daysWindow, setDaysWindow] = useState<number | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fullPackageCache, setFullPackageCache] = useState<Record<string, FullPackage>>({});
  const [packageLoadingId, setPackageLoadingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Synthesize state
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthStatus, setSynthStatus] = useState<string>('');
  const [synthDepth, setSynthDepth] = useState<Depth>('standard');
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryMeta, setSummaryMeta] = useState<{ model: string; elapsed_ms: number } | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const searchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const synthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load projects for filter row
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

  // Cycle the loading status message while a search is in flight.
  const startStatusCycle = (stages: Array<[number, string]>, setter: (s: string) => void) => {
    const start = Date.now();
    setter(stages[0][1]);
    const id = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      let current = stages[0][1];
      for (const [t, msg] of stages) {
        if (elapsed >= t) current = msg;
      }
      setter(current);
    }, 500);
    return id;
  };

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setSummary(null);
    setSummaryMeta(null);
    setSummaryError(null);
    setExpandedId(null);

    if (searchTimerRef.current) clearInterval(searchTimerRef.current);
    searchTimerRef.current = startStatusCycle(
      mode === 'semantic' ? SEMANTIC_STAGES : KEYWORD_STAGES,
      setLoadingStatus,
    );

    try {
      const resp = await fetch(`${API_BASE}/api/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, projectId, daysWindow, mode, limit: 15 }),
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
      if (searchTimerRef.current) {
        clearInterval(searchTimerRef.current);
        searchTimerRef.current = null;
      }
      setLoadingStatus('');
      setLoading(false);
    }
  }, [query, projectId, daysWindow, mode]);

  const runSynthesize = useCallback(async () => {
    if (hits.length === 0) return;
    setSynthesizing(true);
    setSummaryError(null);

    if (synthTimerRef.current) clearInterval(synthTimerRef.current);
    synthTimerRef.current = startStatusCycle(SYNTH_STAGES, setSynthStatus);

    try {
      const resp = await fetch(`${API_BASE}/api/synthesize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query,
          depth: synthDepth,
          hits: hits.slice(0, 10).map((h) => ({
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
      setSummaryMeta({ model: json.model, elapsed_ms: json.elapsed_ms });
    } catch (e) {
      setSummaryError((e as Error).message);
    } finally {
      if (synthTimerRef.current) {
        clearInterval(synthTimerRef.current);
        synthTimerRef.current = null;
      }
      setSynthStatus('');
      setSynthesizing(false);
    }
  }, [hits, query, synthDepth]);

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
      hits.reduce((m, h) => Math.max(m, typeof h.similarity === 'number' ? h.similarity : 0), 0) ||
      1,
    [hits],
  );

  const toggleExpanded = useCallback(
    async (hit: Hit) => {
      if (expandedId === hit.package_id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(hit.package_id);
      // Lazy-load full package on first open
      if (!fullPackageCache[hit.package_id]) {
        setPackageLoadingId(hit.package_id);
        const { data } = await supabase
          .from('context_packages')
          .select(
            'id, title, description, decisions_made, open_questions, handoff_note, deliverables, status, package_type, topic, artifact_type, created_at, created_by_type, created_by_id, context_snapshot',
          )
          .eq('id', hit.package_id)
          .single();
        if (data) {
          setFullPackageCache((prev) => ({ ...prev, [hit.package_id]: data as FullPackage }));
        }
        setPackageLoadingId(null);
      }
    },
    [expandedId, fullPackageCache],
  );

  const copyId = useCallback((id: string) => {
    navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1200);
    });
  }, []);

  return (
    <div className="rs-panel rs-panel-raised" style={{ padding: '14px 16px' }}>
      {/* Query input + run */}
      <div className="flex gap-2 items-stretch">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="search context — try 'context snapshot', 'Retro', 'PostToolUse hook'…"
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
          {loading ? <LoadingDots /> : 'SEARCH'}
        </button>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-2 mt-3">
        <span
          className="rs-text-mono shrink-0"
          style={{ fontSize: 9, color: 'rgba(127, 255, 212, 0.7)', letterSpacing: 1.5, textTransform: 'uppercase' }}
        >
          Mode
        </span>
        {(['semantic', 'keyword'] as const).map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className="rs-text-mono"
              style={{
                fontSize: 10,
                padding: '3px 9px',
                background: active ? 'rgba(127, 255, 212, 0.15)' : 'transparent',
                border: `1px solid ${active ? 'rgba(127, 255, 212, 0.55)' : 'rgba(127, 255, 212, 0.18)'}`,
                color: active ? 'rgba(127, 255, 212, 0.95)' : 'rgba(127, 255, 212, 0.55)',
                cursor: 'pointer',
                borderRadius: 4,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
              }}
              title={
                m === 'semantic'
                  ? 'Embedding + rerank — fuzzy conceptual queries. First query is slow (~20s cold start).'
                  : 'Substring match — exact identifiers, file paths, IDs. Sub-second.'
              }
            >
              {m}
            </button>
          );
        })}
      </div>

      {/* Day window */}
      <div className="flex items-center gap-2 mt-2">
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

      {/* Project chips */}
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

      {/* Loading state */}
      {loading && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(127, 255, 212, 0.12)' }}>
          <div className="flex items-center gap-2">
            <Spinner />
            <span
              className="rs-text-mono"
              style={{ fontSize: 11, color: 'rgba(127, 255, 212, 0.85)', letterSpacing: 0.5 }}
            >
              {loadingStatus || 'Searching…'}
            </span>
          </div>
          <ScanBar />
        </div>
      )}

      {/* Result meta + synthesize controls */}
      {!loading && (hits.length > 0 || error) && (
        <div
          className="flex items-center justify-between mt-3 pt-3 flex-wrap gap-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
        >
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
              : `${hits.length} hit${hits.length === 1 ? '' : 's'}${elapsedMs ? ` · ${elapsedMs}ms` : ''} · ${mode}`}
          </span>
          {hits.length > 0 && (
            <div className="flex items-center gap-1.5">
              {DEPTHS.map((d) => {
                const active = synthDepth === d.value;
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setSynthDepth(d.value)}
                    className="rs-text-mono"
                    style={{
                      fontSize: 9,
                      padding: '3px 8px',
                      background: active ? 'rgba(212, 245, 0, 0.12)' : 'transparent',
                      border: `1px solid ${active ? 'rgba(212, 245, 0, 0.55)' : 'rgba(212, 245, 0, 0.20)'}`,
                      color: active ? 'rgba(212, 245, 0, 0.95)' : 'rgba(212, 245, 0, 0.55)',
                      cursor: 'pointer',
                      borderRadius: 3,
                      letterSpacing: 1.2,
                    }}
                    title={d.sub}
                  >
                    {d.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={runSynthesize}
                disabled={synthesizing}
                className="rs-text-mono"
                style={{
                  fontSize: 10,
                  padding: '4px 12px',
                  background: synthesizing ? 'rgba(212, 245, 0, 0.05)' : 'rgba(212, 245, 0, 0.15)',
                  border: '1px solid rgba(212, 245, 0, 0.55)',
                  color: 'rgba(212, 245, 0, 0.95)',
                  cursor: synthesizing ? 'not-allowed' : 'pointer',
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                  borderRadius: 4,
                  marginLeft: 4,
                }}
              >
                {synthesizing ? <LoadingDots /> : summary ? 'RE-SYNTHESIZE' : 'SYNTHESIZE'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Synthesize loading */}
      {synthesizing && (
        <div
          className="mt-3 rounded px-3 py-2"
          style={{ background: 'rgba(212, 245, 0, 0.03)', border: '1px solid rgba(212, 245, 0, 0.15)' }}
        >
          <div className="flex items-center gap-2">
            <Spinner color="rgba(212, 245, 0, 0.85)" />
            <span
              className="rs-text-mono"
              style={{ fontSize: 11, color: 'rgba(212, 245, 0, 0.85)', letterSpacing: 0.5 }}
            >
              {synthStatus || 'Synthesizing…'}
            </span>
          </div>
        </div>
      )}

      {/* Synthesis */}
      {summary && !synthesizing && (
        <div
          className="mt-3 rounded px-3 py-2"
          style={{ background: 'rgba(212, 245, 0, 0.05)', border: '1px solid rgba(212, 245, 0, 0.20)' }}
        >
          <div className="flex items-center justify-between mb-2">
            <div
              className="rs-text-mono"
              style={{
                fontSize: 9,
                color: 'rgba(212, 245, 0, 0.7)',
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              SYNTHESIS
            </div>
            {summaryMeta && (
              <div
                className="rs-text-mono"
                style={{ fontSize: 8, color: 'rgba(212, 245, 0, 0.45)', letterSpacing: 1 }}
              >
                {summaryMeta.model} · {summaryMeta.elapsed_ms}ms
              </div>
            )}
          </div>
          <div
            className="rs-text-mono text-[11px]"
            style={{ color: 'rgba(212, 245, 0, 0.88)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}
          >
            {summary}
          </div>
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
          {hits.map((h, i) => {
            const isOpen = expandedId === h.package_id;
            const full = fullPackageCache[h.package_id];
            return (
              <li
                key={h.package_id}
                className="rounded"
                style={{
                  background: isOpen ? 'rgba(127, 255, 212, 0.06)' : 'rgba(127, 255, 212, 0.03)',
                  border: `1px solid ${isOpen ? 'rgba(127, 255, 212, 0.30)' : 'rgba(127, 255, 212, 0.12)'}`,
                  transition: 'background 0.15s, border-color 0.15s',
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleExpanded(h)}
                  className="text-left w-full px-3 py-2"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
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
                    <span className="rs-text-mono text-[11px] grow text-white/85 truncate" title={h.title}>
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
                    <span
                      className="rs-text-mono shrink-0"
                      style={{
                        fontSize: 10,
                        color: 'rgba(127, 255, 212, 0.55)',
                        transition: 'transform 0.15s',
                        display: 'inline-block',
                        transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                      }}
                    >
                      ▶
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
                  {h.handoff_note && !isOpen && (
                    <p
                      className="rs-text-mono text-[10px] mt-1"
                      style={{ color: 'rgba(0, 221, 255, 0.75)' }}
                    >
                      ↳ {truncate(h.handoff_note, 200)}
                    </p>
                  )}
                  {typeof h.similarity === 'number' && !isOpen && (
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
                </button>

                {/* Expanded detail */}
                {isOpen && (
                  <div
                    className="px-3 pb-3"
                    style={{ borderTop: '1px solid rgba(127, 255, 212, 0.15)', paddingTop: 10 }}
                  >
                    {/* ID + copy */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span
                        className="rs-text-mono"
                        style={{ fontSize: 9, color: 'rgba(127, 255, 212, 0.55)', letterSpacing: 1, textTransform: 'uppercase' }}
                      >
                        ID
                      </span>
                      <code
                        className="rs-text-mono text-[10px]"
                        style={{ color: 'rgba(127, 255, 212, 0.85)' }}
                      >
                        {h.package_id}
                      </code>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyId(h.package_id);
                        }}
                        className="rs-text-mono"
                        style={{
                          fontSize: 9,
                          padding: '2px 8px',
                          background: 'transparent',
                          border: '1px solid rgba(127, 255, 212, 0.25)',
                          color: 'rgba(127, 255, 212, 0.7)',
                          cursor: 'pointer',
                          borderRadius: 3,
                          letterSpacing: 1,
                          textTransform: 'uppercase',
                        }}
                      >
                        {copiedId === h.package_id ? 'COPIED' : 'COPY'}
                      </button>
                      {h.callsign && (
                        <span
                          className="rs-text-mono"
                          style={{
                            fontSize: 9,
                            color: 'rgba(0, 221, 255, 0.75)',
                            background: 'rgba(0, 221, 255, 0.06)',
                            padding: '1px 6px',
                            borderRadius: 3,
                          }}
                        >
                          {h.callsign}
                        </span>
                      )}
                    </div>

                    {packageLoadingId === h.package_id && (
                      <div className="flex items-center gap-2">
                        <Spinner />
                        <span className="rs-text-mono text-[10px]" style={{ color: 'rgba(127, 255, 212, 0.55)' }}>
                          loading package detail…
                        </span>
                      </div>
                    )}

                    {full && (
                      <>
                        {full.description && (
                          <DetailBlock label="DESCRIPTION">
                            <p className="rs-text-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.65)', lineHeight: 1.55 }}>
                              {full.description}
                            </p>
                          </DetailBlock>
                        )}
                        {full.handoff_note && (
                          <DetailBlock label="HANDOFF" accent="cyan">
                            <p className="rs-text-mono text-[10px]" style={{ color: 'rgba(0, 221, 255, 0.85)', lineHeight: 1.55 }}>
                              ↳ {full.handoff_note}
                            </p>
                          </DetailBlock>
                        )}
                        {full.decisions_made?.length > 0 && (
                          <DetailBlock label={`DECISIONS (${full.decisions_made.length})`}>
                            <ul className="space-y-1">
                              {full.decisions_made.map((d, idx) => (
                                <li
                                  key={idx}
                                  className="rs-text-mono text-[10px] flex gap-1.5"
                                  style={{ color: 'rgba(255,255,255,0.65)' }}
                                >
                                  <span style={{ color: 'rgba(212, 245, 0, 0.85)' }}>+</span>
                                  <span>{d}</span>
                                </li>
                              ))}
                            </ul>
                          </DetailBlock>
                        )}
                        {full.open_questions?.length > 0 && (
                          <DetailBlock label={`OPEN QUESTIONS (${full.open_questions.length})`} accent="amber">
                            <ul className="space-y-1">
                              {full.open_questions.map((q, idx) => (
                                <li
                                  key={idx}
                                  className="rs-text-mono text-[10px] flex gap-1.5"
                                  style={{ color: 'rgba(255,255,255,0.65)' }}
                                >
                                  <span style={{ color: 'rgba(255, 179, 71, 0.85)' }}>?</span>
                                  <span>{q}</span>
                                </li>
                              ))}
                            </ul>
                          </DetailBlock>
                        )}
                        {full.deliverables?.length > 0 && (
                          <DetailBlock label={`DELIVERABLES (${full.deliverables.length})`}>
                            <ul className="space-y-0.5">
                              {full.deliverables.map((d, idx) => (
                                <li
                                  key={idx}
                                  className="rs-text-mono text-[10px]"
                                  style={{ color: 'rgba(255,255,255,0.45)' }}
                                >
                                  {d.path}
                                </li>
                              ))}
                            </ul>
                          </DetailBlock>
                        )}
                        {full.context_snapshot?.session_shape && (
                          <DetailBlock label="CONTEXT AT DEPOSIT">
                            <span className="rs-text-mono text-[10px]" style={{ color: 'rgba(127, 255, 212, 0.85)' }}>
                              ⌗ {full.context_snapshot.session_shape.files} files · ~
                              {full.context_snapshot.session_shape.lines.toLocaleString()} lines · {' '}
                              {full.context_snapshot.session_shape.dominant_categories?.slice(0, 3).join(', ')}
                            </span>
                          </DetailBlock>
                        )}
                        <div className="flex gap-3 mt-2 flex-wrap">
                          <Meta label="STATUS" value={full.status} />
                          <Meta label="TYPE" value={full.package_type} />
                          {full.topic && <Meta label="TOPIC" value={full.topic} />}
                          {full.artifact_type && <Meta label="ARTIFACT" value={full.artifact_type} />}
                          <Meta label="BY" value={`${full.created_by_type}/${full.created_by_id}`} />
                          <Meta label="AT" value={new Date(full.created_at).toLocaleString()} />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Empty state */}
      {!loading && hits.length === 0 && !error && query.trim() && elapsedMs !== null && (
        <div
          className="mt-3 rs-text-mono text-[10px]"
          style={{ color: 'rgba(255, 255, 255, 0.40)', fontStyle: 'italic' }}
        >
          no hits — try {mode === 'semantic' ? 'switching to KEYWORD mode for exact terms, ' : 'switching to SEMANTIC mode for fuzzy matches, '}
          broadening the day window, or removing the project filter
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function LoadingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', justifyContent: 'center' }}>
      <span className="rs-loading-dot" style={{ animationDelay: '0ms' }} />
      <span className="rs-loading-dot" style={{ animationDelay: '150ms' }} />
      <span className="rs-loading-dot" style={{ animationDelay: '300ms' }} />
      <style>{`
        .rs-loading-dot {
          width: 4px; height: 4px;
          background: currentColor;
          border-radius: 50%;
          opacity: 0.4;
          animation: rsBlink 0.9s infinite ease-in-out;
        }
        @keyframes rsBlink {
          0%, 80%, 100% { opacity: 0.3; }
          40% { opacity: 1; }
        }
      `}</style>
    </span>
  );
}

function Spinner({ color = 'rgba(127, 255, 212, 0.85)' }: { color?: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        border: '2px solid rgba(255,255,255,0.08)',
        borderTopColor: color,
        borderRadius: '50%',
        animation: 'rsSpin 0.7s linear infinite',
      }}
    >
      <style>{`@keyframes rsSpin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}

function ScanBar() {
  return (
    <div
      style={{
        height: 2,
        marginTop: 8,
        background: 'rgba(127, 255, 212, 0.06)',
        borderRadius: 2,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '30%',
          height: '100%',
          background: 'linear-gradient(90deg, transparent, rgba(127, 255, 212, 0.65), transparent)',
          animation: 'rsScan 1.4s ease-in-out infinite',
        }}
      />
      <style>{`
        @keyframes rsScan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}

function DetailBlock({
  label,
  accent = 'phosphor',
  children,
}: {
  label: string;
  accent?: 'phosphor' | 'cyan' | 'amber';
  children: React.ReactNode;
}) {
  const color =
    accent === 'cyan'
      ? 'rgba(0, 221, 255, 0.65)'
      : accent === 'amber'
        ? 'rgba(255, 179, 71, 0.65)'
        : 'rgba(127, 255, 212, 0.65)';
  return (
    <div className="mt-2">
      <div
        className="rs-text-mono"
        style={{ fontSize: 8, color, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <span
        className="rs-text-mono"
        style={{ fontSize: 8, color: 'rgba(255, 255, 255, 0.30)', letterSpacing: 1, textTransform: 'uppercase' }}
      >
        {label}
      </span>
      <span className="rs-text-mono" style={{ fontSize: 9, color: 'rgba(255, 255, 255, 0.55)' }}>
        {value}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
