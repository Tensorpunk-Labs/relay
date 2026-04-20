import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

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
  created_at: string;
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
  started_at: string;
  ended_at: string | null;
}
