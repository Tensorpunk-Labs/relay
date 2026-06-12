'use client';

import { useState, useEffect, useMemo } from 'react';
import { useProjects, usePackages, usePackageCounts, useSessions } from '@/lib/hooks';
import type { PackageRow } from '@/lib/supabase';

const statusPill: Record<string, string> = {
  complete: 'rs-pill rs-pill-emerald',
  in_progress: 'rs-pill rs-pill-amber',
  pending_review: 'rs-pill rs-pill-purple',
  draft: 'rs-pill rs-pill-dim',
  blocked: 'rs-pill rs-pill-red',
  approved: 'rs-pill rs-pill-emerald',
  rejected: 'rs-pill rs-pill-red',
};

const statusLed: Record<string, string> = {
  complete: 'rs-led rs-led-emerald rs-led-sm',
  in_progress: 'rs-led rs-led-amber rs-led-sm',
  pending_review: 'rs-led rs-led-purple rs-led-sm',
  draft: 'rs-led rs-led-sm',
  blocked: 'rs-led rs-led-red rs-led-sm',
};

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function PackageDetail({ pkg, callsign, onClose }: { pkg: PackageRow; callsign: string | null; onClose: () => void }) {
  const decisions = (pkg.decisions_made as string[]) || [];
  const questions = (pkg.open_questions as string[]) || [];
  const deliverables = (pkg.deliverables as { path: string; type: string }[]) || [];
  const sig = pkg.significance ?? 0;

  return (
    <div className="rs-liquid-glass-row mb-2" style={{ borderColor: 'rgba(0, 221, 255, 0.30)' }}>
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {sig >= 6 && (
            <span className={sig >= 9 ? 'rs-pill rs-pill-lime-strong' : 'rs-pill rs-pill-cyan'}>
              {sig >= 9 ? 'KEY' : 'SIG'}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h4 className="rs-text-mono text-[11px] font-semibold text-white/90 truncate">{pkg.title}</h4>
            <span className="rs-text-mono text-[8px] rs-text-faint">{pkg.id}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="rs-text-mono text-[8px] rs-text-faint" title="Significance score">
            {sig}/10
          </span>
          <button
            onClick={onClose}
            className="rs-text-mono text-[10px] rs-text-dim hover:text-white px-2 py-0.5"
          >
            ×
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <span className={statusPill[pkg.status] || 'rs-pill rs-pill-dim'}>{pkg.status}</span>
        <span className="rs-text-mono text-[8px] rs-text-dim uppercase tracking-wider">
          {pkg.created_by_type}/{pkg.created_by_id}
        </span>
        {callsign && (
          <span
            className="rs-pill"
            title={`Session callsign: ${callsign}`}
            style={{
              color: 'var(--rs-accent-cyan)',
              borderColor: 'rgba(0, 221, 255, 0.30)',
              background: 'rgba(0, 221, 255, 0.08)',
            }}
          >
            {callsign}
          </span>
        )}
        <span className="rs-text-mono text-[8px] rs-text-faint">
          {new Date(pkg.created_at).toLocaleString()}
        </span>
      </div>

      {pkg.description && (
        <div className="mb-3">
          <div className="rs-zone-label" style={{ fontSize: 8, marginBottom: 4 }}>
            DESCRIPTION
          </div>
          <p className="rs-text-mono text-[10px] text-white/65 whitespace-pre-wrap leading-relaxed">
            {pkg.description}
          </p>
        </div>
      )}

      {pkg.handoff_note && (
        <div
          className="mb-3 rounded px-3 py-2"
          style={{
            background: 'rgba(0, 221, 255, 0.08)',
            border: '1px solid rgba(0, 221, 255, 0.25)',
          }}
        >
          <div className="rs-zone-label rs-text-cyan" style={{ fontSize: 8, marginBottom: 4 }}>
            HANDOFF
          </div>
          <p className="rs-text-mono text-[10px]" style={{ color: 'rgba(0, 221, 255, 0.85)' }}>
            {pkg.handoff_note}
          </p>
        </div>
      )}

      {decisions.length > 0 && (
        <div className="mb-3">
          <div className="rs-zone-label" style={{ fontSize: 8, marginBottom: 4 }}>
            DECISIONS ({decisions.length})
          </div>
          <ul className="space-y-1">
            {decisions.map((d, i) => (
              <li key={i} className="rs-text-mono text-[10px] text-white/65 flex gap-1.5">
                <span className="rs-text-lime shrink-0">+</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {questions.length > 0 && (
        <div className="mb-3">
          <div className="rs-zone-label" style={{ fontSize: 8, marginBottom: 4 }}>
            OPEN QUESTIONS ({questions.length})
          </div>
          <ul className="space-y-1">
            {questions.map((q, i) => (
              <li key={i} className="rs-text-mono text-[10px] text-white/65 flex gap-1.5">
                <span className="shrink-0" style={{ color: 'var(--rs-accent-amber)' }}>?</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pkg.context_snapshot && (
        <div className="mb-3">
          <div className="rs-zone-label" style={{ fontSize: 8, marginBottom: 4, color: '#7fffd4' }}>
            CONTEXT AT DEPOSIT
          </div>
          <div
            className="rounded px-3 py-2"
            style={{
              background: 'rgba(127, 255, 212, 0.05)',
              border: '1px solid rgba(127, 255, 212, 0.20)',
            }}
          >
            <div className="rs-text-mono text-[10px]" style={{ color: 'rgba(127, 255, 212, 0.85)', marginBottom: 6 }}>
              ⌗ {pkg.context_snapshot.session_shape?.files ?? 0} files in context
              {pkg.context_snapshot.session_shape?.lines
                ? ` · ~${pkg.context_snapshot.session_shape.lines.toLocaleString()} lines`
                : ''}
              {pkg.context_snapshot.session_shape?.dominant_categories?.length
                ? ` · ${pkg.context_snapshot.session_shape.dominant_categories.slice(0, 3).join(', ')}`
                : ''}
            </div>
            {pkg.context_snapshot.heavyweights?.biggest && pkg.context_snapshot.heavyweights.biggest.length > 0 && (
              <div className="mb-2">
                <div className="rs-zone-label" style={{ fontSize: 7, marginBottom: 2, color: 'rgba(255, 179, 71, 0.85)' }}>
                  BIGGEST
                </div>
                <ul className="space-y-0.5">
                  {pkg.context_snapshot.heavyweights.biggest.slice(0, 3).map((h, i) => (
                    <li key={i} className="rs-text-mono text-[10px] text-white/55 flex gap-1.5">
                      <span className="shrink-0" style={{ color: 'rgba(255, 179, 71, 0.7)' }}>
                        {h.metric ? `${h.metric}L` : '·'}
                      </span>
                      <span className="truncate" title={h.path}>{h.path}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pkg.context_snapshot.heavyweights?.most_touched && pkg.context_snapshot.heavyweights.most_touched.length > 0 && (
              <div className="mb-2">
                <div className="rs-zone-label" style={{ fontSize: 7, marginBottom: 2, color: 'rgba(127, 255, 212, 0.7)' }}>
                  MOST TOUCHED
                </div>
                <ul className="space-y-0.5">
                  {pkg.context_snapshot.heavyweights.most_touched.slice(0, 3).map((h, i) => (
                    <li key={i} className="rs-text-mono text-[10px] text-white/55 flex gap-1.5">
                      <span className="shrink-0" style={{ color: 'rgba(127, 255, 212, 0.6)' }}>
                        {h.metric ? `×${h.metric}` : '·'}
                      </span>
                      <span className="truncate" title={h.path}>{h.path}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pkg.context_snapshot.category_totals && Object.keys(pkg.context_snapshot.category_totals).length > 0 && (
              <div>
                <div className="rs-zone-label" style={{ fontSize: 7, marginBottom: 4, color: 'rgba(127, 255, 212, 0.7)' }}>
                  BY CATEGORY
                </div>
                {(() => {
                  const totals = pkg.context_snapshot!.category_totals;
                  const max = Math.max(...Object.values(totals));
                  return (
                    <div className="space-y-1">
                      {Object.entries(totals)
                        .sort((a, b) => b[1] - a[1])
                        .map(([cat, lines]) => (
                          <div key={cat} className="flex items-center gap-2">
                            <span
                              className="rs-text-mono text-[9px] rs-text-dim shrink-0"
                              style={{ width: 92, textTransform: 'uppercase', letterSpacing: 0.5 }}
                            >
                              {cat}
                            </span>
                            <div
                              className="grow rounded-sm"
                              style={{
                                height: 6,
                                background: 'rgba(127, 255, 212, 0.08)',
                                border: '1px solid rgba(127, 255, 212, 0.15)',
                              }}
                            >
                              <div
                                style={{
                                  width: `${Math.round((lines / max) * 100)}%`,
                                  height: '100%',
                                  background: 'rgba(127, 255, 212, 0.55)',
                                }}
                              />
                            </div>
                            <span
                              className="rs-text-mono text-[9px] shrink-0"
                              style={{ width: 48, textAlign: 'right', color: 'rgba(255, 179, 71, 0.75)' }}
                            >
                              {lines.toLocaleString()}
                            </span>
                          </div>
                        ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {deliverables.length > 0 && (
        <div className="mb-3">
          <div className="rs-zone-label" style={{ fontSize: 8, marginBottom: 4 }}>
            DELIVERABLES ({deliverables.length})
          </div>
          <ul className="space-y-0.5">
            {deliverables.map((d, i) => (
              <li key={i} className="rs-text-mono text-[10px] rs-text-dim">
                {d.path}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pkg.tags && pkg.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {pkg.tags.map((tag) => (
            <span key={tag} className="rs-pill rs-pill-dim">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Expanded drill-down — fetches the project's FULL package history on mount,
 * independent of the dashboard-wide recency window. This is what fixes the
 * "0 pkgs on old projects" lie: the global pool only carries windowed
 * packages, but opening a card always shows everything.
 */
function ExpandedProjectCard({
  project,
  callsignBySession,
  onCollapse,
}: {
  project: { id: string; name: string; description: string | null; archived_at?: string | null };
  callsignBySession: Map<string, string>;
  onCollapse: () => void;
}) {
  const isArchived = Boolean(project.archived_at);
  const [selectedPkg, setSelectedPkg] = useState<PackageRow | null>(null);
  const { packages, loading } = usePackages({ projectId: project.id, all: true });

  const statusCounts: Record<string, number> = {};
  for (const p of packages) {
    statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
  }

  return (
    <div
      id={`project-${project.id}`}
      className="rs-image-stack col-span-full"
      data-bg="obsidian"
      style={{ minHeight: 280, opacity: isArchived ? 0.5 : 1 }}
      onClick={(e) => e.stopPropagation()}
    >
        <div className="rs-liquid-glass" style={{ flex: 1 }}>
          <div className="flex items-center justify-between mb-2 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="rs-zone-label rs-text-cyan">
                <span className="rs-zone-icon">◈</span>
                {project.name}
              </span>
              <span className="rs-text-mono text-[8px] rs-text-faint">{project.id}</span>
              {isArchived && (
                <span className="rs-pill rs-pill-dim" title={`Archived at ${project.archived_at}`}>
                  ARCHIVED
                </span>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCollapse();
              }}
              className="rs-btn-raised"
            >
              COLLAPSE
            </button>
          </div>
          <div className="rs-label-separator" />

          {loading && (
            <div className="rs-text-mono text-[10px] rs-text-dim py-3">LOADING FULL HISTORY...</div>
          )}

          {project.description && (
            <p className="rs-text-mono text-[10px] text-white/55 mb-3">{project.description}</p>
          )}

          <div className="flex gap-2 mb-3 flex-wrap items-center">
            <span className="rs-pill rs-pill-cyan">{packages.length} PACKAGES</span>
            {Object.entries(statusCounts).map(([status, count]) => (
              <span key={status} className="rs-pill">
                {count} {status}
              </span>
            ))}
          </div>

          {selectedPkg && (
            <PackageDetail
              pkg={selectedPkg}
              callsign={(selectedPkg.session_id && callsignBySession.get(selectedPkg.session_id)) || null}
              onClose={() => setSelectedPkg(null)}
            />
          )}

          <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1 rs-scroll">
            {packages.map((pkg) => {
              const sig = pkg.significance ?? 0;
              const isLow = sig < 2;
              const isSelected = selectedPkg?.id === pkg.id;
              return (
                <div
                  key={pkg.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedPkg(isSelected ? null : pkg);
                  }}
                  className="flex items-center gap-3 p-2 rounded cursor-pointer transition-colors"
                  style={{
                    background: isSelected ? 'rgba(0, 221, 255, 0.10)' : 'transparent',
                    border: isSelected
                      ? '1px solid rgba(0, 221, 255, 0.30)'
                      : '1px solid transparent',
                    opacity: isLow ? 0.55 : 1,
                  }}
                >
                  <span className={statusLed[pkg.status] || 'rs-led rs-led-sm'} />
                  {sig >= 6 && (
                    <span
                      className={sig >= 9 ? 'rs-pill rs-pill-lime-strong' : 'rs-pill rs-pill-cyan'}
                      style={{ fontSize: 7, padding: '2px 5px' }}
                    >
                      {sig >= 9 ? 'KEY' : 'SIG'}
                    </span>
                  )}
                  <span className="rs-text-mono text-[10px] truncate flex-1 text-white/80">
                    {pkg.title}
                  </span>
                  {pkg.session_id && callsignBySession.has(pkg.session_id) && (
                    <span
                      className="rs-text-mono text-[9px] shrink-0"
                      title={`Session: ${callsignBySession.get(pkg.session_id)}`}
                      style={{ color: 'rgba(0, 221, 255, 0.70)' }}
                    >
                      {callsignBySession.get(pkg.session_id)}
                    </span>
                  )}
                  {pkg.handoff_note && (
                    <span className="rs-text-cyan rs-text-mono text-[9px]" title="Has handoff note">
                      H
                    </span>
                  )}
                  {((pkg.decisions_made as string[]) || []).length > 0 && (
                    <span
                      className="rs-text-mono text-[9px]"
                      style={{ color: 'var(--rs-accent-emerald)' }}
                      title="Has decisions"
                    >
                      D
                    </span>
                  )}
                  {((pkg.open_questions as string[]) || []).length > 0 && (
                    <span
                      className="rs-text-mono text-[9px]"
                      style={{ color: 'var(--rs-accent-amber)' }}
                      title="Has open questions"
                    >
                      Q
                    </span>
                  )}
                  {pkg.context_snapshot && (
                    <span
                      className="rs-text-mono text-[9px]"
                      style={{ color: '#7fffd4' }}
                      title={`Has context snapshot: ${pkg.context_snapshot.session_shape?.files ?? 0} files, ~${pkg.context_snapshot.session_shape?.lines?.toLocaleString() ?? '?'} lines`}
                    >
                      C
                    </span>
                  )}
                  {pkg.transcript_blob && (
                    <span
                      className="rs-text-mono text-[9px]"
                      style={{ color: 'var(--rs-accent-emerald)' }}
                      title={`Continuity restorable — relay resume ${pkg.id}`}
                    >
                      ↻
                    </span>
                  )}
                  <span className="rs-text-mono text-[9px] rs-text-faint tabular-nums">
                    {timeAgo(pkg.created_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
    </div>
  );
}

function ProjectCard({
  project,
  packages,
  totalCount,
  callsignBySession,
  forceExpand,
}: {
  project: { id: string; name: string; description: string | null; archived_at?: string | null };
  /** Packages within the dashboard's current window — preview only. */
  packages: PackageRow[];
  /** True all-time package count, independent of any window. */
  totalCount: number;
  callsignBySession: Map<string, string>;
  forceExpand?: boolean;
}) {
  const isArchived = Boolean(project.archived_at);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (forceExpand) setExpanded(true);
  }, [forceExpand]);

  if (expanded) {
    return (
      <ExpandedProjectCard
        project={project}
        callsignBySession={callsignBySession}
        onCollapse={() => setExpanded(false)}
      />
    );
  }

  const statusCounts: Record<string, number> = {};
  for (const p of packages) {
    statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
  }

  // Collapsed: rs-panel-raised
  return (
    <div
      id={`project-${project.id}`}
      className="rs-panel-raised rs-panel-raised-interactive"
      style={{ opacity: isArchived ? 0.5 : 1 }}
      onClick={() => setExpanded(true)}
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3
          className="rs-text-mono text-[12px] font-semibold truncate"
          style={{ color: isArchived ? 'var(--rs-text-dim)' : 'var(--rs-accent-lime)' }}
        >
          {project.name}
        </h3>
        <div className="flex items-center gap-1.5 shrink-0">
          {isArchived && (
            <span
              className="rs-pill rs-pill-dim"
              style={{ fontSize: 7, padding: '2px 5px' }}
              title={`Archived at ${project.archived_at}`}
            >
              ARCHIVED
            </span>
          )}
          <span className="rs-text-mono text-[8px] rs-text-faint">{project.id}</span>
        </div>
      </div>

      {project.description && (
        <p className="rs-text-mono text-[10px] text-white/50 mb-3 line-clamp-2">
          {project.description}
        </p>
      )}

      <div className="flex gap-1.5 mb-3 flex-wrap items-center">
        <span className="rs-pill rs-pill-cyan">{totalCount} PKG</span>
        {packages.length > 0 && packages.length < totalCount && (
          <span className="rs-pill rs-pill-dim" title="Packages within the current orient window">
            {packages.length} IN WINDOW
          </span>
        )}
        {Object.entries(statusCounts)
          .slice(0, 3)
          .map(([status, count]) => (
            <span key={status} className="rs-pill">
              {count} {status}
            </span>
          ))}
      </div>

      {packages.length > 0 ? (
        <div className="space-y-1 mt-auto pt-3" style={{ borderTop: '1px solid var(--rs-separator)' }}>
          {packages.slice(0, 3).map((pkg) => (
            <div key={pkg.id} className="flex items-center gap-2">
              <span className={statusLed[pkg.status] || 'rs-led rs-led-sm'} />
              <span className="rs-text-mono text-[10px] text-white/70 truncate flex-1">
                {pkg.title}
              </span>
              <span className="rs-text-mono text-[9px] rs-text-faint tabular-nums">
                {timeAgo(pkg.created_at)}
              </span>
            </div>
          ))}
          {totalCount > 3 && (
            <div className="rs-text-mono text-[9px] rs-text-faint pl-4">
              +{totalCount - 3} more
            </div>
          )}
        </div>
      ) : totalCount > 0 ? (
        <div className="mt-auto pt-3" style={{ borderTop: '1px solid var(--rs-separator)' }}>
          <span className="rs-text-mono text-[9px] rs-text-faint">
            NO ACTIVITY IN WINDOW · CLICK FOR FULL HISTORY
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default function ProjectCards({
  expandProjectId,
  includeArchived = false,
  windowDays = 14,
  showAll = false,
}: {
  expandProjectId?: string | null;
  includeArchived?: boolean;
  windowDays?: number;
  showAll?: boolean;
} = {}) {
  const { projects, loading: projectsLoading } = useProjects({ includeArchived });
  // Preview pool follows the same window as the cortex viz; true totals come
  // from usePackageCounts so a card never claims "0 PKG" for an old project.
  const { packages, loading: packagesLoading } = usePackages(showAll ? { all: true } : { windowDays });
  const packageCounts = usePackageCounts();
  const { sessions } = useSessions();
  const [triggeredId, setTriggeredId] = useState<string | null>(null);

  // session_id → callsign lookup. useSessions() returns the 20 most recent
  // by default; any package whose session is in that window surfaces its
  // callsign here.
  const callsignBySession = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sessions) {
      if (s.callsign) m.set(s.id, s.callsign);
    }
    return m;
  }, [sessions]);

  useEffect(() => {
    if (expandProjectId) {
      setTriggeredId(expandProjectId);
      setTimeout(() => {
        const el = document.getElementById(`project-${expandProjectId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [expandProjectId]);

  if (projectsLoading || packagesLoading) {
    return (
      <div className="rs-panel-recessed text-center">
        <span className="rs-zone-label rs-text-dim">LOADING PROJECTS...</span>
      </div>
    );
  }

  const packagesByProject = new Map<string, PackageRow[]>();
  for (const pkg of packages) {
    const existing = packagesByProject.get(pkg.project_id) || [];
    existing.push(pkg);
    packagesByProject.set(pkg.project_id, existing);
  }

  // Active projects first, archived sorted after by most-recently archived.
  const active = projects.filter((p) => !p.archived_at);
  const archived = projects
    .filter((p) => !!p.archived_at)
    .sort((a, b) => (b.archived_at ?? '').localeCompare(a.archived_at ?? ''));
  const ordered = [...active, ...archived];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {ordered.map((project) => {
        const windowed = packagesByProject.get(project.id) || [];
        return (
          <ProjectCard
            key={project.id}
            project={project}
            packages={windowed}
            totalCount={packageCounts.get(project.id) ?? windowed.length}
            callsignBySession={callsignBySession}
            forceExpand={triggeredId === project.id}
          />
        );
      })}
    </div>
  );
}
