-- 009 — Project soft archive. Additive only.
alter table projects
  add column if not exists archived_at timestamptz default null;
comment on column projects.archived_at is
  'Soft-archive timestamp. NULL = active. Set to now() to archive. Clear to restore. Never hard-deleted.';
create index if not exists idx_projects_active
  on projects(id) where archived_at is null;
create index if not exists idx_projects_archived_at
  on projects(archived_at desc) where archived_at is not null;
