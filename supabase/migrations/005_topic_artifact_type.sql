-- 005_topic_artifact_type.sql
-- Add structured metadata columns for pre-filtering and gradient orient.
-- Part of the gradient orient + structured metadata feature (2026-04-09 spec).

-- New columns
ALTER TABLE context_packages
  ADD COLUMN IF NOT EXISTS topic text,
  ADD COLUMN IF NOT EXISTS artifact_type text;

-- Partial indexes for pre-filtering (only index non-null values)
CREATE INDEX IF NOT EXISTS idx_packages_topic
  ON context_packages (topic) WHERE topic IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_packages_artifact_type
  ON context_packages (artifact_type) WHERE artifact_type IS NOT NULL;

-- Composite index for the new time-based orient query
-- (replaces the old created_at-only scan with significance-aware ordering)
CREATE INDEX IF NOT EXISTS idx_packages_orient
  ON context_packages (project_id, created_at DESC, significance DESC NULLS LAST);
