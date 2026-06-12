'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useMetaControl } from '@/lib/hooks';
import StatsBar from '@/components/StatsBar';
import ProjectCards from '@/components/ProjectCards';
import Timeline from '@/components/Timeline';
import MetaControls from '@/components/MetaControls';
import SearchPanel from '@/components/SearchPanel';

const CoreShader = dynamic(() => import('@/components/CoreShader'), { ssr: false });
const BrainCore = dynamic(() => import('@/components/BrainCore'), { ssr: false });
const RelayFlow = dynamic(() => import('@/components/RelayFlow'), { ssr: false });
const OrbitalLogo = dynamic(() => import('@/components/OrbitalLogo'), { ssr: false });

type VizMode = 'cortex' | 'flow';

export default function Home() {
  const [expandProjectId, setExpandProjectId] = useState<string | null>(null);
  const [windowDays, setWindowDays, windowLoading] = useMetaControl('orient', 'window_days', 14);
  const [includeArchived, setIncludeArchived] = useState<boolean>(false);
  // ALL-time override for the viz + cards. Local UI state on purpose — the
  // persisted meta:orient window_days fact keeps backend meaning (CLI orient)
  // and shouldn't be clobbered by a "show me everything" glance.
  const [showAll, setShowAll] = useState<boolean>(false);
  const [vizMode, setVizMode] = useState<VizMode>('cortex');

  const handleClickProject = useCallback((id: string) => {
    setExpandProjectId(null);
    // Reset then set to trigger the effect even if same project clicked twice
    setTimeout(() => setExpandProjectId(id), 10);
  }, []);

  return (
    <>
      <CoreShader />
      <main className="rs-viewport">
        {/* Topbar — brand links back to the landing; nav provides a way
            out to the rest of the Relay site since this dashboard sits
            behind relaymemory.com/dashboard via Vercel rewrite. */}
        <header className="rs-topbar">
          <a href="https://relaymemory.com/" className="rs-topbar-brand" style={{ textDecoration: 'none', color: 'inherit' }}>
            <OrbitalLogo size={36} />
            <span className="rs-brand-text">// RELAY CORE</span>
          </a>
          <nav className="rs-topbar-nav" aria-label="Relay sections">
            <a href="https://relaymemory.com/">Home</a>
            <a href="https://relaymemory.com/setup/">Setup</a>
            <a href="https://relaymemory.com/cli/">CLI</a>
            <a href="https://relaymemory.com/protocol/">Protocol</a>
            <a href="https://relaymemory.com/benchmarks/">Benchmarks</a>
            <a href="https://relaymemory.com/#waitlist">Waitlist</a>
          </nav>
          <div className="rs-topbar-status">
            <span className="rs-led rs-led-on" />
            <span>LIVE</span>
          </div>
        </header>

        {/* Hero — single liquid-glass section blurring the global waves bg.
            BrainCore renders directly on the glass, no nested inner panel. */}
        <section className="rs-liquid-glass" style={{ padding: '14px 18px' }}>
          <div className="flex items-center justify-between">
            <span className="rs-zone-label">
              <span className="rs-zone-icon">{vizMode === 'cortex' ? '◇' : '⊚'}</span>
              {vizMode === 'cortex' ? 'CONTEXT CORTEX' : 'RELAY FLOW'}
            </span>
            <div className="flex items-center gap-3">
              <span className="rs-text-mono text-[8px] tracking-[1.6px] uppercase rs-text-dim">
                {vizMode === 'cortex'
                  ? '3D PROJECT GRAPH · CLICK TO DRILL'
                  : 'STATIONS RELAY CONTEXT TO CORE · TAIL = DEPOSIT HISTORY'}
              </span>
              <div className="flex gap-1">
                {(['cortex', 'flow'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setVizMode(mode)}
                    className={`rs-pill ${vizMode === mode ? 'rs-pill-cyan' : ''}`}
                    style={{
                      cursor: 'pointer',
                      border: '1px solid',
                      borderColor: vizMode === mode ? 'rgba(0,221,255,0.35)' : 'var(--rs-separator)',
                    }}
                    aria-pressed={vizMode === mode}
                  >
                    {mode === 'cortex' ? 'CORTEX' : 'FLOW'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="rs-label-separator" />
          <div className="relative w-full" style={{ height: 540 }}>
            {vizMode === 'cortex' ? (
              <BrainCore onClickProject={handleClickProject} windowDays={windowDays} onWindowChange={setWindowDays} includeArchived={includeArchived} showAll={showAll} />
            ) : (
              <RelayFlow onClickProject={handleClickProject} windowDays={windowDays} includeArchived={includeArchived} showAll={showAll} />
            )}
          </div>
        </section>

        {/* Meta Controls */}
        <MetaControls windowDays={windowDays} onWindowChange={setWindowDays} showAll={showAll} onShowAllChange={setShowAll} />

        {/* Stats */}
        <section>
          <span className="rs-zone-label">
            <span className="rs-zone-icon">▤</span>
            FLOW METRICS
          </span>
          <div className="rs-label-separator" />
          <StatsBar />
        </section>

        {/* Semantic search */}
        <section>
          <span className="rs-zone-label">
            <span className="rs-zone-icon">⌕</span>
            SEMANTIC SEARCH
          </span>
          <div className="rs-label-separator" />
          <SearchPanel />
        </section>

        {/* Projects */}
        <section>
          <div className="flex items-center justify-between mb-1">
            <span className="rs-zone-label">
              <span className="rs-zone-icon">◈</span>
              {includeArchived ? 'ALL PROJECTS' : 'ACTIVE PROJECTS'}
            </span>
            <button
              type="button"
              onClick={() => setIncludeArchived((v) => !v)}
              className={`rs-pill ${includeArchived ? 'rs-pill-cyan' : ''}`}
              style={{
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid',
                borderColor: includeArchived ? 'rgba(0,221,255,0.35)' : 'var(--rs-separator)',
              }}
              aria-pressed={includeArchived}
              title="Toggle visibility of archived projects"
            >
              <span
                className={includeArchived ? 'rs-led rs-led-sm rs-led-on' : 'rs-led rs-led-sm'}
                style={{
                  background: includeArchived ? 'var(--rs-accent-cyan)' : undefined,
                  boxShadow: includeArchived
                    ? '0 0 8px rgba(0,221,255,0.7)'
                    : undefined,
                }}
              />
              INCLUDE ARCHIVED
            </button>
          </div>
          <div className="rs-label-separator" />
          <ProjectCards expandProjectId={expandProjectId} includeArchived={includeArchived} windowDays={windowDays} showAll={showAll} />
        </section>

        {/* Timeline */}
        <section>
          <span className="rs-zone-label">
            <span className="rs-zone-icon">∿</span>
            LIVE TIMELINE
          </span>
          <div className="rs-label-separator" />
          <Timeline />
        </section>

        {/* Footer */}
        <footer className="rs-footer">
          <span className="rs-footer-text">RELAY CORE v0.1 · CONTEXT FLOW PROTOCOL</span>
          <span className="rs-footer-text">// TENSORPUNK LABS</span>
        </footer>
      </main>
    </>
  );
}
