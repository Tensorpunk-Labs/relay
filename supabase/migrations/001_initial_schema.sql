-- ============================================================
-- RELAY CONTEXT CORE — Phase 1 Schema
-- Supabase Postgres + pgvector
-- ============================================================

-- Enable required extensions
create extension if not exists vector;
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROJECTS
-- ============================================================
create table projects (
  id text primary key default 'proj_' || replace(gen_random_uuid()::text, '-', ''),
  name text not null,
  description text,
  owner_id text not null default 'jordan',  -- single-user Phase 1
  settings jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- CONTEXT PACKAGES (metadata — zip stored in Supabase Storage)
-- ============================================================
create table context_packages (
  id text primary key,  -- 'pkg_' prefix, generated client-side
  project_id text not null references projects(id),
  title text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'pending_review', 'approved', 'rejected', 'complete', 'blocked')),
  package_type text not null default 'standard'
    check (package_type in ('standard', 'lattice_agent_output', 'lattice_synthesis', 'orchestrator_report', 'human_review', 'onboarding_briefing')),
  review_type text not null default 'none'
    check (review_type in ('human', 'agent', 'none')),
  parent_package_id text references context_packages(id),
  created_by_type text not null
    check (created_by_type in ('agent', 'human')),
  created_by_id text not null,
  session_id text,
  tags text[] default '{}',
  open_questions jsonb default '[]',
  decisions_made jsonb default '[]',
  handoff_note text,
  estimated_next_actor text
    check (estimated_next_actor in ('agent', 'human') or estimated_next_actor is null),
  deliverables jsonb default '[]',
  storage_path text,              -- path in Supabase Storage bucket
  context_md text,                -- full CONTEXT.md text (for search + display)
  manifest jsonb not null,        -- full manifest.json
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- PACKAGE DEPENDENCIES (many-to-many)
-- ============================================================
create table package_dependencies (
  package_id text references context_packages(id) on delete cascade,
  depends_on_id text references context_packages(id) on delete cascade,
  primary key (package_id, depends_on_id)
);

-- ============================================================
-- CONTEXT DIFFS
-- ============================================================
create table context_diffs (
  id text primary key,  -- 'cdiff_' prefix
  from_package_id text references context_packages(id),
  to_package_id text not null references context_packages(id),
  actor_type text not null,
  actor_id text not null,
  changes jsonb not null,
  created_at timestamptz default now()
);

-- ============================================================
-- SESSIONS
-- ============================================================
create table sessions (
  id text primary key,  -- 'sess_' prefix
  project_id text not null references projects(id),
  actor_type text not null check (actor_type in ('agent', 'human')),
  actor_id text not null,
  agent_description text,       -- e.g. "Claude Code @ my-project"
  packages_pulled text[] default '{}',
  packages_deposited text[] default '{}',
  started_at timestamptz default now(),
  ended_at timestamptz
);

-- ============================================================
-- EMBEDDINGS (pgvector for semantic search)
-- ============================================================
create table package_embeddings (
  id text primary key default 'emb_' || replace(gen_random_uuid()::text, '-', ''),
  package_id text not null references context_packages(id) on delete cascade,
  content_type text not null
    check (content_type in ('context_md', 'decision', 'question', 'handoff')),
  content text not null,
  embedding vector(1536),  -- OpenAI text-embedding-3-small dimension
  created_at timestamptz default now()
);

-- ============================================================
-- ORCHESTRATOR REPORTS
-- ============================================================
create table orchestrator_reports (
  id text primary key default 'orch_' || replace(gen_random_uuid()::text, '-', ''),
  project_id text not null references projects(id),
  report_type text not null
    check (report_type in ('digest', 'health', 'onboarding', 'anomaly')),
  content text not null,
  metadata jsonb default '{}',
  triggered_by text,  -- session_id or 'scheduled' or 'manual'
  created_at timestamptz default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_packages_project_status on context_packages(project_id, status);
create index idx_packages_parent on context_packages(parent_package_id);
create index idx_packages_created on context_packages(project_id, created_at desc);
create index idx_sessions_project on sessions(project_id, started_at desc);
create index idx_diffs_to_package on context_diffs(to_package_id);
create index idx_embeddings_package on package_embeddings(package_id);

-- pgvector index — use ivfflat for Phase 1 (good enough, easy to set up)
-- Switch to HNSW if search quality becomes an issue at scale
create index idx_embeddings_vector on package_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ============================================================
-- SEMANTIC SEARCH FUNCTION
-- ============================================================
create or replace function search_context(
  query_embedding vector(1536),
  project_filter text,
  match_count int default 10
)
returns table (
  package_id text,
  content_type text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    pe.package_id,
    pe.content_type,
    pe.content,
    1 - (pe.embedding <=> query_embedding) as similarity
  from package_embeddings pe
  join context_packages cp on cp.id = pe.package_id
  where cp.project_id = project_filter
  order by pe.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- HELPER: Get latest packages for a project
-- ============================================================
create or replace function get_latest_packages(
  p_project_id text,
  p_limit int default 20
)
returns setof context_packages
language sql stable
as $$
  select *
  from context_packages
  where project_id = p_project_id
  order by created_at desc
  limit p_limit;
$$;

-- ============================================================
-- HELPER: Get package lineage (walk parent chain)
-- ============================================================
create or replace function get_package_lineage(
  p_package_id text,
  p_depth int default 10
)
returns table (
  id text,
  title text,
  status text,
  parent_package_id text,
  created_by_type text,
  created_by_id text,
  created_at timestamptz,
  depth int
)
language sql stable
as $$
  with recursive lineage as (
    select cp.id, cp.title, cp.status, cp.parent_package_id,
           cp.created_by_type, cp.created_by_id, cp.created_at,
           0 as depth
    from context_packages cp
    where cp.id = p_package_id

    union all

    select cp.id, cp.title, cp.status, cp.parent_package_id,
           cp.created_by_type, cp.created_by_id, cp.created_at,
           l.depth + 1
    from context_packages cp
    join lineage l on cp.id = l.parent_package_id
    where l.depth < p_depth
  )
  select * from lineage order by depth;
$$;

-- ============================================================
-- STORAGE BUCKET (run via Supabase dashboard or API)
-- ============================================================
-- Create bucket: 'context-packages'
-- Public: false
-- File size limit: 50MB
-- Allowed MIME types: application/zip, application/octet-stream
