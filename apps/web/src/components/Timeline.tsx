'use client';

import { useState, useMemo } from 'react';
import { usePackages } from '@/lib/hooks';

const statusLed: Record<string, string> = {
  complete: 'rs-led rs-led-emerald',
  in_progress: 'rs-led rs-led-amber',
  pending_review: 'rs-led rs-led-purple',
  draft: 'rs-led',
  blocked: 'rs-led rs-led-red',
  approved: 'rs-led rs-led-emerald',
  rejected: 'rs-led rs-led-red',
};

const statusPill: Record<string, string> = {
  complete: 'rs-pill rs-pill-emerald',
  in_progress: 'rs-pill rs-pill-amber',
  pending_review: 'rs-pill rs-pill-purple',
  draft: 'rs-pill rs-pill-dim',
  blocked: 'rs-pill rs-pill-red',
};

const actorIcons: Record<string, string> = {
  human: '\u{1F9D1}',
  agent: '\u{1F916}',
};

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function Timeline() {
  const { packages, loading } = usePackages();
  const [showAuto, setShowAuto] = useState(false);

  // Use artifact_type field for auto-deposit detection, with fallback to title
  // prefix for packages that haven't been backfilled yet.
  const isAuto = (p: { title: string; artifact_type: string | null }) =>
    p.artifact_type === 'auto-deposit' || p.title.startsWith('[auto]');
  const visiblePackages = useMemo(
    () => (showAuto ? packages : packages.filter((p) => !isAuto(p))),
    [packages, showAuto],
  );
  const autoCount = useMemo(() => packages.filter(isAuto).length, [packages]);

  if (loading) {
    return (
      <div className="rs-panel-recessed text-center">
        <span className="rs-zone-label rs-text-dim">LOADING TIMELINE...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="rs-zone-label">
          <span className="rs-led rs-led-on rs-led-sm" />
          STREAM · {visiblePackages.length} PACKAGES
          {autoCount > 0 && !showAuto && (
            <span className="rs-text-faint ml-2">(+{autoCount} auto hidden)</span>
          )}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowAuto((v) => !v)}
            className="rs-btn-raised"
            title="Toggle auto-snapshot visibility"
          >
            {showAuto ? 'HIDE AUTO' : 'SHOW AUTO'}
          </button>
          <span className="rs-text-mono text-[8px] rs-text-faint uppercase tracking-wider">
            NEWEST FIRST
          </span>
        </div>
      </div>
      <div className="rs-label-separator" />

      <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 rs-scroll">
        {visiblePackages.map((pkg) => {
          const sig = pkg.significance ?? 0;
          const isLowSignal = sig < 2;
          return (
            <div
              key={pkg.id}
              className={`rs-liquid-glass-row ${isLowSignal ? 'rs-liquid-glass-row-dim' : ''}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center mt-1">
                  <span className={statusLed[pkg.status] || 'rs-led'} />
                  <div
                    className="w-px flex-1 mt-1"
                    style={{ background: 'var(--rs-separator)', minHeight: 16 }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {sig >= 6 && (
                      <span
                        className={
                          sig >= 9 ? 'rs-pill rs-pill-lime-strong' : 'rs-pill rs-pill-cyan'
                        }
                      >
                        {sig >= 9 ? 'KEY' : 'SIG'}
                      </span>
                    )}
                    <span className="rs-text-mono text-[13px] font-medium text-white/85 truncate">
                      {pkg.title}
                    </span>
                    <span className="rs-text-mono text-[9px] rs-text-faint shrink-0 ml-auto">
                      {timeAgo(pkg.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rs-text-mono text-[9px] rs-text-dim flex-wrap">
                    <span>
                      {actorIcons[pkg.created_by_type] || ''} {pkg.created_by_id}
                    </span>
                    <span className="rs-text-faint">·</span>
                    <span className="rs-text-mono uppercase tracking-wider">
                      {pkg.project_id.replace('proj_dev_', '')}
                    </span>
                    {pkg.topic && (
                      <>
                        <span className="rs-text-faint">·</span>
                        <span className="rs-pill rs-pill-cyan">{pkg.topic}</span>
                      </>
                    )}
                    {pkg.artifact_type && pkg.artifact_type !== 'auto-deposit' && (
                      <>
                        <span className="rs-text-faint">·</span>
                        <span className="rs-pill">{pkg.artifact_type}</span>
                      </>
                    )}
                    <span className="rs-text-faint">·</span>
                    <span className={statusPill[pkg.status] || 'rs-pill rs-pill-dim'}>
                      {pkg.status}
                    </span>
                  </div>
                  {pkg.handoff_note && (
                    <div
                      className="mt-2 rs-text-mono text-[10px] rounded px-2 py-1.5"
                      style={{
                        background: 'rgba(0, 221, 255, 0.08)',
                        border: '1px solid rgba(0, 221, 255, 0.20)',
                        color: 'rgba(0, 221, 255, 0.85)',
                      }}
                    >
                      ↳ {pkg.handoff_note}
                    </div>
                  )}
                  {pkg.open_questions && (pkg.open_questions as string[]).length > 0 && (
                    <div className="mt-1.5">
                      <span className="rs-pill rs-pill-amber">
                        {(pkg.open_questions as string[]).length} OPEN QUESTION
                        {(pkg.open_questions as string[]).length > 1 ? 'S' : ''}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
