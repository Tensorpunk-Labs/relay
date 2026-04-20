import type { SearchResult } from './types.js';

// Singleton — model loads once, reused across calls
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _reranker: any = null;
let _loadFailed = false;

async function getReranker() {
  if (_loadFailed) return null;
  if (!_reranker) {
    try {
      const { pipeline } = await import('@huggingface/transformers');
      _reranker = await pipeline('text-classification', 'Xenova/bge-reranker-base');
    } catch (e) {
      console.error(`Reranker model load failed: ${(e as Error).message}`);
      _loadFailed = true;
      return null;
    }
  }
  return _reranker;
}

/**
 * Re-score search results using a cross-encoder model.
 * The cross-encoder sees (query, document) pairs together,
 * producing more accurate relevance scores than bi-encoder similarity.
 *
 * Returns results sorted by cross-encoder score descending.
 * If the reranker fails to load, returns the input unchanged.
 */
export async function rerank(
  query: string,
  results: SearchResult[],
  topK?: number,
): Promise<SearchResult[]> {
  if (results.length === 0) return results;

  const ranker = await getReranker();
  if (!ranker) return results; // Graceful fallback

  // Score each (query, document) pair
  const scored: { result: SearchResult; score: number }[] = [];
  for (const r of results) {
    try {
      const output = await ranker(`${query} [SEP] ${r.content}`, {
        topk: 1,
      });
      // bge-reranker outputs a relevance score — higher is more relevant
      const score = Array.isArray(output) ? (output[0]?.score ?? 0) : (output?.score ?? 0);
      scored.push({ result: r, score });
    } catch {
      // If individual scoring fails, keep original similarity
      scored.push({ result: r, score: r.similarity });
    }
  }

  // Sort by cross-encoder score descending
  scored.sort((a, b) => b.score - a.score);

  // Return top-K with the cross-encoder score as the new similarity
  const limit = topK ?? results.length;
  return scored.slice(0, limit).map((s) => ({
    ...s.result,
    similarity: s.score,
  }));
}
