/**
 * SqliteStorage schema — translated from Supabase/Postgres migrations
 * 001 / 004 / 005 / 009. See V02_PLAN §4 for the translation rationale:
 *
 *   timestamptz default now()  ->  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 *   text[] / jsonb             ->  TEXT (JSON, app-layer parse)
 *   vector(384)                ->  BLOB (packed Float32 LE, 1536 bytes)
 *   GIN tsvector               ->  FTS5 virtual table (packages_fts),
 *                                  wired for future hybridSearch once
 *                                  the capability lands. Capability
 *                                  stays false in v0.2.
 *   ivfflat vector index       ->  dropped (no sqlite-vec). Vectors are
 *                                  still stored so round-trip backup
 *                                  works; similarity search is not
 *                                  supported by this adapter.
 *
 * App-layer invariants:
 *   - `id` defaults ('proj_<uuid>', 'fact_<uuid>', 'emb_<uuid>') are
 *     supplied by the adapter's insert* methods via crypto.randomUUID
 *     rather than a DB DEFAULT — SQLite defaults can't portably call a
 *     host function.
 *   - Timestamps written by the app pass ISO-8601 millisecond strings
 *     matching the Postgres-serialized form used in NDJSON backups.
 *   - JSON columns default to `'[]'` or `'{}'` to match the Postgres
 *     `DEFAULT '[]'::jsonb` behavior; the adapter parses them on read.
 *
 * Exported as a string so tsc bundles the schema with the dist without
 * a post-build copy step.
 */
export const SCHEMA_SQL = `
-- --- PROJECTS --------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  owner_id      TEXT NOT NULL DEFAULT 'jordan',
  settings      TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_active
  ON projects(id) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_archived_at
  ON projects(archived_at DESC) WHERE archived_at IS NOT NULL;

-- --- CONTEXT PACKAGES ------------------------------------------------

CREATE TABLE IF NOT EXISTS context_packages (
  id                    TEXT PRIMARY KEY NOT NULL,
  project_id            TEXT NOT NULL REFERENCES projects(id),
  title                 TEXT NOT NULL,
  description           TEXT,
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','in_progress','pending_review','approved','rejected','complete','blocked')),
  package_type          TEXT NOT NULL DEFAULT 'standard'
                          CHECK (package_type IN ('standard','lattice_agent_output','lattice_synthesis','orchestrator_report','human_review','onboarding_briefing')),
  review_type           TEXT NOT NULL DEFAULT 'none'
                          CHECK (review_type IN ('human','agent','none')),
  parent_package_id     TEXT REFERENCES context_packages(id),
  created_by_type       TEXT NOT NULL CHECK (created_by_type IN ('agent','human')),
  created_by_id         TEXT NOT NULL,
  session_id            TEXT,
  tags                  TEXT NOT NULL DEFAULT '[]',
  open_questions        TEXT NOT NULL DEFAULT '[]',
  decisions_made        TEXT NOT NULL DEFAULT '[]',
  handoff_note          TEXT,
  estimated_next_actor  TEXT CHECK (estimated_next_actor IN ('agent','human') OR estimated_next_actor IS NULL),
  deliverables          TEXT NOT NULL DEFAULT '[]',
  storage_path          TEXT,
  context_md            TEXT,
  significance          INTEGER NOT NULL DEFAULT 0,
  manifest              TEXT NOT NULL,
  topic                 TEXT,
  artifact_type         TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_packages_project_status ON context_packages(project_id, status);
CREATE INDEX IF NOT EXISTS idx_packages_parent         ON context_packages(parent_package_id);
CREATE INDEX IF NOT EXISTS idx_packages_created        ON context_packages(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_packages_topic          ON context_packages(topic)         WHERE topic IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_packages_artifact_type  ON context_packages(artifact_type) WHERE artifact_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_packages_orient
  ON context_packages(project_id, created_at DESC, significance DESC);

-- FTS5 virtual table for future keyword-only hybridSearch. Triggers
-- keep it in sync with context_packages so when the capability lands
-- the index is warm. Capability stays false in v0.2.
CREATE VIRTUAL TABLE IF NOT EXISTS packages_fts USING fts5(
  id UNINDEXED,
  project_id UNINDEXED,
  title,
  description,
  context_md,
  handoff_note,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS packages_fts_ai AFTER INSERT ON context_packages BEGIN
  INSERT INTO packages_fts(id, project_id, title, description, context_md, handoff_note)
  VALUES (new.id, new.project_id, new.title, new.description, new.context_md, new.handoff_note);
END;

CREATE TRIGGER IF NOT EXISTS packages_fts_ad AFTER DELETE ON context_packages BEGIN
  DELETE FROM packages_fts WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS packages_fts_au AFTER UPDATE ON context_packages BEGIN
  DELETE FROM packages_fts WHERE id = old.id;
  INSERT INTO packages_fts(id, project_id, title, description, context_md, handoff_note)
  VALUES (new.id, new.project_id, new.title, new.description, new.context_md, new.handoff_note);
END;

-- --- SESSIONS --------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
  id                   TEXT PRIMARY KEY NOT NULL,
  project_id           TEXT NOT NULL REFERENCES projects(id),
  actor_type           TEXT NOT NULL CHECK (actor_type IN ('agent','human')),
  actor_id             TEXT NOT NULL,
  agent_description    TEXT,
  packages_pulled      TEXT NOT NULL DEFAULT '[]',
  packages_deposited   TEXT NOT NULL DEFAULT '[]',
  started_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at             TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_project
  ON sessions(project_id, started_at DESC);

-- --- RELAY FACTS -----------------------------------------------------

CREATE TABLE IF NOT EXISTS relay_facts (
  id                TEXT PRIMARY KEY NOT NULL,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subject           TEXT NOT NULL,
  relation          TEXT NOT NULL,
  object            TEXT NOT NULL,
  source_package_id TEXT REFERENCES context_packages(id) ON DELETE SET NULL,
  asserted_by_type  TEXT NOT NULL CHECK (asserted_by_type IN ('agent','human')),
  asserted_by_id    TEXT NOT NULL,
  valid_from        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at          TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_facts_project   ON relay_facts(project_id);
CREATE INDEX IF NOT EXISTS idx_facts_subject   ON relay_facts(project_id, subject);
CREATE INDEX IF NOT EXISTS idx_facts_active    ON relay_facts(project_id, ended_at) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_facts_supersede ON relay_facts(project_id, subject, relation) WHERE ended_at IS NULL;

-- --- PACKAGE EMBEDDINGS ----------------------------------------------

CREATE TABLE IF NOT EXISTS package_embeddings (
  id            TEXT PRIMARY KEY NOT NULL,
  package_id    TEXT NOT NULL REFERENCES context_packages(id) ON DELETE CASCADE,
  content_type  TEXT NOT NULL CHECK (content_type IN ('context_md','decision','question','handoff')),
  content       TEXT NOT NULL,
  embedding     BLOB NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_embeddings_package
  ON package_embeddings(package_id);

-- --- SCHEMA VERSION -------------------------------------------------
-- Single-row table. Used by migrations.ts on open to decide whether
-- any future migration steps are needed. v0.2 ships at version 1.

CREATE TABLE IF NOT EXISTS relay_meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO relay_meta (key, value) VALUES ('schema_version', '1');
`;
