-- 006_hybrid_search.sql
-- Add full-text search infrastructure and hybrid_search() RPC.
-- Combines BM25 (tsvector) with semantic (pgvector) via Reciprocal Rank Fusion.

-- 1. Add tsvector column
ALTER TABLE context_packages
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Auto-populate trigger: builds weighted tsvector from title (A), description (B), context_md (C)
CREATE OR REPLACE FUNCTION update_search_vector()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.context_md, '')), 'C');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_search_vector ON context_packages;
CREATE TRIGGER trg_update_search_vector
  BEFORE INSERT OR UPDATE OF title, description, context_md
  ON context_packages
  FOR EACH ROW
  EXECUTE FUNCTION update_search_vector();

-- 3. GIN index for fast full-text queries
CREATE INDEX IF NOT EXISTS idx_packages_search_vector
  ON context_packages USING gin (search_vector);

-- 4. Backfill existing rows
UPDATE context_packages SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(context_md, '')), 'C')
WHERE search_vector IS NULL;

-- 5. Hybrid search RPC — BM25 + semantic via Reciprocal Rank Fusion
CREATE OR REPLACE FUNCTION hybrid_search(
  query_text text,
  query_embedding vector(384),
  project_filter text,
  match_count int default 10,
  topic_filter text default null,
  type_filter text default null
)
RETURNS TABLE (
  package_id text,
  content_type text,
  content text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  WITH
  -- Pre-filter: narrow candidate packages before scoring
  candidates AS (
    SELECT cp.id, cp.search_vector
    FROM context_packages cp
    WHERE cp.project_id = project_filter
      AND (topic_filter IS NULL OR cp.topic = topic_filter)
      AND (type_filter IS NULL OR cp.artifact_type = type_filter)
  ),
  -- BM25 leg: rank by full-text relevance
  bm25_ranked AS (
    SELECT
      pe.package_id,
      pe.content_type,
      pe.content,
      pe.embedding,
      ts_rank_cd(c.search_vector, plainto_tsquery('english', query_text)) AS bm25_score,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(c.search_vector, plainto_tsquery('english', query_text)) DESC
      ) AS bm25_rank
    FROM package_embeddings pe
    JOIN candidates c ON c.id = pe.package_id
    WHERE c.search_vector @@ plainto_tsquery('english', query_text)
       OR query_text IS NULL
       OR query_text = ''
  ),
  -- Semantic leg: rank by cosine similarity
  semantic_ranked AS (
    SELECT
      pe.package_id,
      pe.content_type,
      pe.content,
      1 - (pe.embedding <=> query_embedding) AS semantic_score,
      ROW_NUMBER() OVER (
        ORDER BY pe.embedding <=> query_embedding
      ) AS semantic_rank
    FROM package_embeddings pe
    JOIN candidates c ON c.id = pe.package_id
  ),
  -- RRF merge: combine both rankings
  merged AS (
    SELECT
      COALESCE(s.package_id, b.package_id) AS package_id,
      COALESCE(s.content_type, b.content_type) AS content_type,
      COALESCE(s.content, b.content) AS content,
      -- RRF formula: 1/(k+rank) for each leg, k=60
      COALESCE(1.0 / (60 + b.bm25_rank), 0) +
      COALESCE(1.0 / (60 + s.semantic_rank), 0) AS rrf_score
    FROM semantic_ranked s
    FULL OUTER JOIN bm25_ranked b
      ON s.package_id = b.package_id
      AND s.content_type = b.content_type
      AND s.content = b.content
  )
  SELECT
    merged.package_id,
    merged.content_type,
    merged.content,
    merged.rrf_score AS similarity
  FROM merged
  ORDER BY merged.rrf_score DESC
  LIMIT match_count;
$$;
