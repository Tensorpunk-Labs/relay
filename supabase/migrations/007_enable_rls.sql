-- 007_enable_rls.sql
-- Enable Row Level Security (RLS) on all tables.
--
-- Two-key access pattern:
--   - secret/service_role key (CLI + MCP agents) → bypasses RLS automatically
--   - publishable/anon key (frontend dashboard) → restricted to read-only by policies
--
-- This is a BLOCKING requirement for the open-source release. Ships RLS ON
-- by default so new users are secure from day one.

-- ── Enable RLS on all tables ──────────────────────────────────────

ALTER TABLE context_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_diffs ENABLE ROW LEVEL SECURITY;

-- ── Anon (publishable) key: read-only access for dashboard ─────────
-- The secret/service_role key bypasses RLS automatically and has full access.
-- The anon key is restricted to SELECT only — no writes.

-- context_packages: dashboard reads timeline, project cards, stats
DROP POLICY IF EXISTS "anon_read_packages" ON context_packages;
CREATE POLICY "anon_read_packages" ON context_packages
  FOR SELECT TO anon USING (true);

-- package_embeddings: dashboard may display embedding metadata
DROP POLICY IF EXISTS "anon_read_embeddings" ON package_embeddings;
CREATE POLICY "anon_read_embeddings" ON package_embeddings
  FOR SELECT TO anon USING (true);

-- projects: dashboard lists projects
DROP POLICY IF EXISTS "anon_read_projects" ON projects;
CREATE POLICY "anon_read_projects" ON projects
  FOR SELECT TO anon USING (true);

-- sessions: dashboard shows session panel
DROP POLICY IF EXISTS "anon_read_sessions" ON sessions;
CREATE POLICY "anon_read_sessions" ON sessions
  FOR SELECT TO anon USING (true);

-- relay_facts: dashboard shows active facts panel
DROP POLICY IF EXISTS "anon_read_facts" ON relay_facts;
CREATE POLICY "anon_read_facts" ON relay_facts
  FOR SELECT TO anon USING (true);

-- context_diffs: dashboard may show diff history
DROP POLICY IF EXISTS "anon_read_diffs" ON context_diffs;
CREATE POLICY "anon_read_diffs" ON context_diffs
  FOR SELECT TO anon USING (true);

-- ── Notes for operators ───────────────────────────────────────────
--
-- If you need finer-grained access (e.g., per-user isolation for multi-tenant),
-- replace the `USING (true)` clauses with predicates like:
--   USING (auth.uid() = owner_id)
-- or tenant-scoped:
--   USING (project_id IN (SELECT id FROM user_projects WHERE user_id = auth.uid()))
--
-- For a single-user self-hosted instance, `USING (true)` is safe because the
-- anon key is only used by your own dashboard, which you authenticate separately.
--
-- WRITES are intentionally NOT granted to anon. All mutations must go through
-- the secret key (CLI/MCP) which bypasses RLS.
