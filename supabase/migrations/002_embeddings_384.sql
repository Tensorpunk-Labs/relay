-- ============================================================
-- Migration: Switch from OpenAI 1536-dim to local 384-dim embeddings
-- Model: Xenova/all-MiniLM-L6-v2 via Transformers.js (ONNX, local)
-- ============================================================

-- Drop the old index (dimension-specific)
DROP INDEX IF EXISTS idx_embeddings_vector;

-- Clear any existing embeddings (they're 1536-dim, incompatible)
DELETE FROM package_embeddings;

-- Alter the column dimension
ALTER TABLE package_embeddings
  ALTER COLUMN embedding TYPE vector(384);

-- Recreate the index for 384 dimensions
CREATE INDEX idx_embeddings_vector ON package_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Update the search function to use 384 dimensions
CREATE OR REPLACE FUNCTION search_context(
  query_embedding vector(384),
  project_filter text,
  match_count int default 10
)
RETURNS TABLE (
  package_id text,
  content_type text,
  content text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    pe.package_id,
    pe.content_type,
    pe.content,
    1 - (pe.embedding <=> query_embedding) AS similarity
  FROM package_embeddings pe
  JOIN context_packages cp ON cp.id = pe.package_id
  WHERE cp.project_id = project_filter
  ORDER BY pe.embedding <=> query_embedding
  LIMIT match_count;
$$;
