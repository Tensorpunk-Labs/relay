import type { RelayManifest } from './types.js';
import type { RelayStorage, EmbeddingRow } from './storage/types.js';

// Singleton — model loads once, reused across calls
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _extractor: any = null;

async function getExtractor() {
  if (!_extractor) {
    const { pipeline } = await import('@huggingface/transformers');
    _extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return _extractor;
}

/**
 * Generate a 384-dim embedding vector from text using local Transformers.js.
 * No API calls, no cost — runs ONNX locally.
 */
async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const result = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data as Float32Array);
}

/**
 * Generate embeddings for a context package and store them via the
 * storage adapter. v0.2: takes a `RelayStorage` rather than a raw
 * `SupabaseClient` so a SQLite (or any other) backend can persist
 * embeddings in its own native shape.
 *
 * Embeds multiple content types per package:
 * - context_md: the full CONTEXT.md text
 * - decision: each decision made (individually)
 * - question: each open question (individually)
 * - handoff: the handoff note
 */
export async function generateAndStoreEmbeddings(
  storage: RelayStorage,
  manifest: RelayManifest,
  contextMd: string,
): Promise<number> {
  type Chunk = { content_type: EmbeddingRow['content_type']; content: string };
  const chunks: Chunk[] = [];

  if (contextMd) {
    // Truncate to ~8000 chars for embedding model context window.
    const truncated = contextMd.length > 8000 ? contextMd.slice(0, 8000) : contextMd;
    chunks.push({ content_type: 'context_md', content: truncated });
  }

  for (const decision of manifest.decisions_made) {
    if (decision.trim()) {
      chunks.push({ content_type: 'decision', content: decision });
    }
  }

  for (const question of manifest.open_questions) {
    if (question.trim()) {
      chunks.push({ content_type: 'question', content: question });
    }
  }

  if (manifest.handoff_note?.trim()) {
    chunks.push({ content_type: 'handoff', content: manifest.handoff_note });
  }

  // Embed title + description as the handoff if no handoff exists.
  if (!manifest.handoff_note?.trim()) {
    const titleDesc = `${manifest.title}. ${manifest.description || ''}`.trim();
    if (titleDesc.length > 5) {
      chunks.push({ content_type: 'context_md', content: titleDesc });
    }
  }

  if (chunks.length === 0) return 0;

  const embeddings = await Promise.all(chunks.map((c) => embed(c.content)));
  const rows: EmbeddingRow[] = embeddings.map((embedding, i) => ({
    package_id: manifest.package_id,
    content_type: chunks[i].content_type,
    content: chunks[i].content,
    embedding,
  }));

  try {
    await storage.insertEmbeddings(rows);
    return rows.length;
  } catch (e) {
    console.error((e as Error).message);
    return 0;
  }
}

/**
 * Generate a single embedding vector for a search query.
 * Uses the same local model — no API calls.
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  return embed(query);
}
