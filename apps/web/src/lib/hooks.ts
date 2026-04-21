'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabase';
import type { PackageRow, ProjectRow, SessionRow } from './supabase';
import { MOCK_PROJECTS, MOCK_PACKAGES, MOCK_SESSIONS, LIVE_FEED_POOL } from './mockData';

const USE_MOCK = (process.env.NEXT_PUBLIC_MOCK_DATA ?? '').trim() === 'true';

// ---------------------------------------------------------------------------
// Shared in-memory mock store. A single ever-growing package list drives the
// simulated realtime feed — new entries splice in at the top so Timeline and
// BrainCore pulse as if live traffic is arriving.
// ---------------------------------------------------------------------------

let mockPackages: PackageRow[] = [...MOCK_PACKAGES];
let mockFeedCursor = 0;
let mockFeedStarted = false;
type MockListener = (pkgs: PackageRow[]) => void;
const mockListeners = new Set<MockListener>();

function startMockFeed() {
  if (mockFeedStarted || typeof window === 'undefined') return;
  mockFeedStarted = true;
  const tick = () => {
    const template = LIVE_FEED_POOL[mockFeedCursor % LIVE_FEED_POOL.length];
    mockFeedCursor += 1;
    const pkg: PackageRow = {
      id: `pkg_live_${Date.now().toString(36)}_${mockFeedCursor}`,
      project_id: template.project_id,
      title: template.title,
      description: template.description ?? null,
      status: template.status ?? 'complete',
      package_type: 'standard',
      review_type: 'none',
      parent_package_id: null,
      created_by_type: template.actor_type ?? 'agent',
      created_by_id: template.actor_id ?? 'cargo_AI_orion',
      session_id: null,
      tags: template.tags ?? [],
      open_questions: template.questions ?? [],
      decisions_made: template.decisions ?? [],
      handoff_note: template.handoff_note ?? null,
      deliverables: [],
      context_md: null,
      significance: template.significance ?? 5,
      topic: template.topic ?? null,
      artifact_type: template.artifact_type ?? null,
      created_at: new Date().toISOString(),
    };
    mockPackages = [pkg, ...mockPackages];
    mockListeners.forEach((l) => l(mockPackages));
  };
  // First synthetic arrival lands quickly so the dashboard never feels stale.
  setTimeout(tick, 8_000);
  setInterval(tick, 22_000);
}

function subscribeMock(listener: MockListener): () => void {
  startMockFeed();
  mockListeners.add(listener);
  return () => {
    mockListeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Hooks — each one branches on USE_MOCK. The real-Supabase paths are unchanged
// from the original implementation.
// ---------------------------------------------------------------------------

export function useProjects(opts: { includeArchived?: boolean } = {}) {
  const { includeArchived = false } = opts;
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (USE_MOCK) {
      const filtered = includeArchived ? MOCK_PROJECTS : MOCK_PROJECTS.filter((p) => !p.archived_at);
      setProjects(filtered);
      setLoading(false);
      return;
    }

    let query = supabase.from('projects').select('*').order('created_at', { ascending: true });
    if (!includeArchived) {
      query = query.is('archived_at', null);
    }
    query.then(({ data }) => {
      setProjects(data || []);
      setLoading(false);
    });
  }, [includeArchived]);

  return { projects, loading };
}

export function usePackages(projectId?: string) {
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (USE_MOCK) {
      const filter = (list: PackageRow[]) =>
        projectId ? list.filter((p) => p.project_id === projectId) : list;
      setPackages(filter(mockPackages));
      setLoading(false);
      const unsubscribe = subscribeMock((all) => {
        setPackages(filter(all));
      });
      return unsubscribe;
    }

    let query = supabase
      .from('context_packages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (projectId) {
      query = query.eq('project_id', projectId);
    }

    query.then(({ data }) => {
      setPackages(data || []);
      setLoading(false);
    });

    const channelName = `packages-${projectId || 'all'}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'context_packages',
          ...(projectId ? { filter: `project_id=eq.${projectId}` } : {}),
        },
        (payload) => {
          setPackages((prev) => [payload.new as PackageRow, ...prev]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  return { packages, loading };
}

export function useSessions(projectId?: string) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  useEffect(() => {
    if (USE_MOCK) {
      setSessions(projectId ? MOCK_SESSIONS.filter((s) => s.project_id === projectId) : MOCK_SESSIONS);
      return;
    }

    let query = supabase
      .from('sessions')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20);

    if (projectId) {
      query = query.eq('project_id', projectId);
    }

    query.then(({ data }) => {
      setSessions(data || []);
    });
  }, [projectId]);

  return { sessions };
}

export function useStats() {
  const [stats, setStats] = useState({
    totalPackages: 0,
    totalSessions: 0,
    totalProjects: 0,
    recentActivity: 0,
    keyPackages: 0,
    activeFacts: 0,
  });

  useEffect(() => {
    if (USE_MOCK) {
      const compute = (list: PackageRow[]) => {
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        setStats({
          totalPackages: list.length,
          totalSessions: MOCK_SESSIONS.length,
          totalProjects: MOCK_PROJECTS.filter((p) => !p.archived_at).length,
          recentActivity: list.filter((p) => new Date(p.created_at).getTime() >= dayAgo).length,
          keyPackages: list.filter((p) => (p.significance ?? 0) >= 9).length,
          // "Active facts" doesn't map neatly onto the spaceship metaphor; fix
          // it to a believable steady-state number so the stat tile still has
          // life without needing its own fixture.
          activeFacts: 23,
        });
      };
      compute(mockPackages);
      const unsubscribe = subscribeMock(compute);
      return unsubscribe;
    }

    Promise.all([
      supabase.from('context_packages').select('id', { count: 'exact', head: true }),
      supabase.from('sessions').select('id', { count: 'exact', head: true }),
      supabase.from('projects').select('id', { count: 'exact', head: true }),
      supabase.from('context_packages').select('id', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      supabase.from('context_packages').select('id', { count: 'exact', head: true })
        .gte('significance', 9),
      supabase.from('relay_facts').select('id', { count: 'exact', head: true })
        .is('ended_at', null),
    ]).then(([pkgs, sess, proj, recent, key, facts]) => {
      setStats({
        totalPackages: pkgs.count || 0,
        totalSessions: sess.count || 0,
        totalProjects: proj.count || 0,
        recentActivity: recent.count || 0,
        keyPackages: key.count || 0,
        activeFacts: facts.count || 0,
      });
    });
  }, []);

  return stats;
}

export function useMetaControl(
  group: string,
  key: string,
  defaultValue: number,
): [number, (v: number) => void, boolean] {
  const [value, setValue] = useState(defaultValue);
  const [loading, setLoading] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (USE_MOCK) {
      // Pure in-memory — no persistence. First render settles immediately.
      setLoading(false);
      return;
    }

    const subject = `meta:${group}`;

    supabase
      .from('relay_facts')
      .select('object')
      .eq('subject', subject)
      .eq('relation', key)
      .is('ended_at', null)
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const parsed = parseInt(data[0].object, 10);
          if (!isNaN(parsed)) setValue(parsed);
        }
        setLoading(false);
      });

    const channelName = `meta-${group}-${key}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'relay_facts',
          filter: `subject=eq.${subject}`,
        },
        () => {
          supabase
            .from('relay_facts')
            .select('object')
            .eq('subject', subject)
            .eq('relation', key)
            .is('ended_at', null)
            .limit(1)
            .then(({ data }) => {
              if (data && data.length > 0) {
                const parsed = parseInt(data[0].object, 10);
                if (!isNaN(parsed)) setValue(parsed);
              }
            });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [group, key]);

  const persistValue = useCallback(
    (newValue: number) => {
      setValue(newValue);

      if (USE_MOCK) return;

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(async () => {
        const subject = `meta:${group}`;

        await supabase
          .from('relay_facts')
          .update({ ended_at: new Date().toISOString() })
          .eq('subject', subject)
          .eq('relation', key)
          .is('ended_at', null);

        const id = `fact_${crypto.randomUUID().replace(/-/g, '').slice(0, 32)}`;
        await supabase.from('relay_facts').insert({
          id,
          project_id: 'proj_dev_relay',
          subject,
          relation: key,
          object: String(newValue),
          asserted_by_type: 'human',
          asserted_by_id: 'dashboard',
          valid_from: new Date().toISOString(),
          ended_at: null,
          created_at: new Date().toISOString(),
        });
      }, 800);
    },
    [group, key],
  );

  return [value, persistValue, loading];
}
