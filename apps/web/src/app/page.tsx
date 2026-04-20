'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useMetaControl } from '@/lib/hooks';
import StatsBar from '@/components/StatsBar';
import ProjectCards from '@/components/ProjectCards';
import Timeline from '@/components/Timeline';
import MetaControls from '@/components/MetaControls';

const CoreShader = dynamic(() => import('@/components/CoreShader'), { ssr: false });
const BrainCore = dynamic(() => import('@/components/BrainCore'), { ssr: false });
const OrbitalLogo = dynamic(() => import('@/components/OrbitalLogo'), { ssr: false });

export default function Home() {
  const [expandProjectId, setExpandProjectId] = useState<string | null>(null);
  const [windowDays, setWindowDays, windowLoading] = useMetaControl('orient', 'window_days', 14);
  const [includeArchived, setIncludeArchived] = useState<boolean>(false);

  const handleClickProject = useCallback((id: string) => {
    setExpandProjectId(null);
    // Reset then set to trigger the effect even if same project clicked twice
    setTimeout(() => setExpandProjectId(id), 10);
  }, []);

  return (
    <>
      <CoreShader />
      <main className="rs-viewport">
        {/* Topbar */}
        <header className="rs-topbar">
          <div className="rs-topbar-brand">
            <OrbitalLogo size={36} />
            <span className="rs-brand-text">// RELAY CORE</span>
          </div>
          <div className="rs-topbar-center">
            <span className="rs-zone-label">CONTEXT FLOW PROTOCOL</span>
          </div>
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
              <span className="rs-zone-icon">◇</span>
              CONTEXT CORTEX
            </span>
            <span className="rs-text-mono text-[8px] tracking-[1.6px] uppercase rs-text-dim">
              3D PROJECT GRAPH · CLICK TO DRILL
            </span>
          </div>
          <div className="rs-label-separator" />
          <div className="relative w-full" style={{ height: 540 }}>
            <BrainCore onClickProject={handleClickProject} windowDays={windowDays} onWindowChange={setWindowDays} includeArchived={includeArchived} />
          </div>
        </section>

        {/* Meta Controls */}
        <MetaControls windowDays={windowDays} onWindowChange={setWindowDays} />

        {/* Stats */}
        <section>
          <span className="rs-zone-label">
            <span className="rs-zone-icon">▤</span>
            FLOW METRICS
          </span>
          <div className="rs-label-separator" />
          <StatsBar />
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
          <ProjectCards expandProjectId={expandProjectId} includeArchived={includeArchived} />
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
