-- ============================================================
-- Migration 004: Mutable facts triples layer
--
-- Adds the relay_facts table — Relay's "whiteboard" alongside the
-- existing context_packages "journal." Packages stay immutable and
-- append-only (the historical reasoning trail). Facts are
-- supersedable and queryable as-of any point in time (the current
-- truth about what we know).
--
-- Triple shape: (subject, relation, object). All free-form strings.
-- No controlled vocabulary, no URI scheme — agents pick whatever
-- phrasing works. Normalization can come later if it's needed.
--
-- Temporal model: every fact has valid_from (when it became true)
-- and ended_at (when it stopped being true; null = still active).
-- assertFact() in the client auto-supersedes any existing active
-- fact with the same (subject, relation) but different object, by
-- setting its ended_at to now() before inserting the new row. This
-- gives "rewriting on the whiteboard" semantics without manual
-- invalidate calls.
--
-- See pkg_f7b1a8d6 for the full design rationale and acceptance
-- criteria.
-- ============================================================

create table relay_facts (
  id text primary key default 'fact_' || replace(gen_random_uuid()::text, '-', ''),
  project_id text not null references projects(id) on delete cascade,
  subject text not null,
  relation text not null,
  object text not null,
  source_package_id text references context_packages(id) on delete set null,
  asserted_by_type text not null check (asserted_by_type in ('agent', 'human')),
  asserted_by_id text not null,
  valid_from timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

-- Index for project-scoped queries (the common case — every read
-- filters by project_id).
create index idx_facts_project on relay_facts(project_id);

-- Partial index for "active facts only" — covers the dominant
-- query pattern from the orient bundle and the supersede check
-- inside assertFact().
create index idx_facts_active on relay_facts(project_id, ended_at)
  where ended_at is null;

-- Compound index for subject-scoped queries — supports
-- "what do we know about X" lookups.
create index idx_facts_subject on relay_facts(project_id, subject);

-- Compound index for the supersede lookup inside assertFact():
-- "find the active fact for this exact (project, subject, relation)
-- so we can invalidate it before inserting the new value."
create index idx_facts_supersede on relay_facts(project_id, subject, relation)
  where ended_at is null;

comment on table relay_facts is
  'Mutable triples layer — the "whiteboard" alongside context_packages. See pkg_f7b1a8d6.';
comment on column relay_facts.subject is 'Free-form. e.g. "session_start_hook", "kai", "relay-dashboard".';
comment on column relay_facts.relation is 'Free-form. e.g. "installed", "works_on", "font".';
comment on column relay_facts.object is 'Free-form. e.g. "true", "orion", "JetBrains Mono".';
comment on column relay_facts.valid_from is 'When this assertion became true.';
comment on column relay_facts.ended_at is 'When this assertion stopped being true. NULL = still active.';

-- Disable RLS to match the existing context_packages access pattern
-- (single-tenant Phase 1; tighten when multi-actor / team-coordination
-- support lands in Phase 2). Without this, anon-key inserts/updates
-- against relay_facts are silently rejected as RLS violations.
alter table relay_facts disable row level security;
