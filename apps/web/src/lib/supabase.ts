import { createClient } from '@supabase/supabase-js';

// In mock mode (NEXT_PUBLIC_MOCK_DATA=true), no real Supabase project is
// required — hooks short-circuit to in-memory fixtures before any client
// method runs. We still need createClient() to succeed at module load, so
// fall back to a harmless placeholder URL when env vars are absent.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface PackageRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  package_type: string;
  review_type: string;
  parent_package_id: string | null;
  created_by_type: string;
  created_by_id: string;
  session_id: string | null;
  tags: string[];
  open_questions: unknown[];
  decisions_made: unknown[];
  handoff_note: string | null;
  deliverables: unknown[];
  context_md: string | null;
  significance: number | null;
  topic: string | null;
  artifact_type: string | null;
  context_snapshot?: ContextSnapshotRow | null;
  created_at: string;
}

export interface ContextSnapshotRow {
  session_shape: {
    files: number;
    lines: number;
    dominant_categories: string[];
  };
  files: Array<{
    path: string;
    role: string;
    category: string;
    lines: number | null;
    why: string;
    is_group?: boolean;
    group_count?: number;
  }>;
  heavyweights: {
    biggest: Array<{ path: string; metric: number | null; note: string }>;
    most_touched: Array<{ path: string; metric: number | null; note: string }>;
    stale: Array<{ path: string; metric: number | null; note: string }>;
  };
  category_totals: Record<string, number>;
}

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  /** Soft-archive timestamp. null = active. */
  archived_at: string | null;
}

export interface SessionRow {
  id: string;
  project_id: string;
  actor_type: string;
  actor_id: string;
  /** Docker-style adjective-noun identifier for audit (e.g. "coral-heron"). */
  callsign: string | null;
  started_at: string;
  ended_at: string | null;
}
