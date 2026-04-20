'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabase';
import type { PackageRow, ProjectRow, SessionRow } from './supabase';

export function useProjects(opts: { includeArchived?: boolean } = {}) {
  const { includeArchived = false } = opts;
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

    // Real-time subscription — use unique channel name to avoid strict mode conflicts
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
