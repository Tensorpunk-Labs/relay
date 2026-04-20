/**
 * LongMemEval Retrieval Benchmark for Relay
 *
 * Evaluates Relay's retrieval pipeline (hybrid search + cross-encoder reranker)
 * against the LongMemEval benchmark dataset.
 *
 * Protocol:
 * 1. For each question, concatenate each session's turns into a single document
 * 2. Generate embeddings for all session documents
 * 3. Run Relay's search pipeline (hybrid BM25 + semantic + reranker) against the question
 * 4. Check if the ground-truth answer_session_ids appear in the top-K results
 * 5. Compute recall@5, recall@10, recall_all@5, recall_all@10
 *
 * Usage:
 *   npx tsx benchmarks/longmemeval/run-benchmark.ts [--dataset oracle|s] [--limit N] [--top-k 5]
 *
 * The benchmark is fully sandboxed — uses LongMemEval's own test corpus,
 * not Relay's production data. Embeddings are generated in-memory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Use packages/core's node_modules for @huggingface/transformers resolution
const coreRequire = createRequire(
  path.resolve(__dirname, '../../packages/core/package.json'),
);
const transformersURL = pathToFileURL(coreRequire.resolve('@huggingface/transformers')).href;

// ── Types ──────────────────────────────────────────────────────────

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  has_answer?: boolean;
}

interface Question {
  question_id: string;
  question_type: string;
  question: string;
  answer: string;
  question_date: string;
  haystack_dates: string[];
  haystack_session_ids: string[];
  haystack_sessions: Turn[][];
  answer_session_ids: string[];
}

interface SessionChunk {
  session_id: string;
  chunk_type: string;
  text: string;
  embedding?: number[];
}

interface SessionDoc {
  session_id: string;
  text: string;
  chunks: SessionChunk[];
}

interface RetrievalResult {
  question_id: string;
  question_type: string;
  answer_session_ids: string[];
  retrieved_session_ids: string[];
  recall_any_at_k: boolean;
  recall_all_at_k: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Concatenate a session's turns into a single document string. */
function sessionToText(turns: Turn[]): string {
  return turns
    .map((t) => `${t.role}: ${t.content}`)
    .join('\n');
}

/**
 * Break a session into chunks for embedding — mirrors production pipeline.
 * Each user turn and assistant turn becomes a separate chunk so no content
 * is lost to truncation. The full session text is kept for BM25 (no truncation needed).
 */
function sessionToChunks(sessionId: string, turns: Turn[]): SessionChunk[] {
  const chunks: SessionChunk[] = [];

  // Each turn as a separate chunk (mirrors how production embeds decisions/questions/handoffs individually)
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.content.trim().length < 10) continue; // skip trivial turns
    chunks.push({
      session_id: sessionId,
      chunk_type: t.role,
      text: t.content,
    });
  }

  // Also add a combined summary chunk (first + last user turns) for context
  const userTurns = turns.filter((t) => t.role === 'user' && t.content.trim().length >= 10);
  if (userTurns.length >= 2) {
    chunks.push({
      session_id: sessionId,
      chunk_type: 'summary',
      text: userTurns.map((t) => t.content).join('\n'),
    });
  }

  return chunks;
}

/** Cosine similarity between two vectors. */
function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

/** BM25 with proper IDF scoring. Call buildBM25 first to get the scorer. */
function buildBM25(docs: { id: string; text: string }[]) {
  const k1 = 1.2;
  const b = 0.75;
  const N = docs.length;

  // Precompute doc frequencies and doc lengths
  const docTermSets = docs.map((d) => new Set(d.text.toLowerCase().split(/\s+/).filter(Boolean)));
  const termDocFreq = new Map<string, number>();
  for (const termSet of docTermSets) {
    for (const term of termSet) {
      termDocFreq.set(term, (termDocFreq.get(term) ?? 0) + 1);
    }
  }

  const docLengths = docs.map((d) => d.text.toLowerCase().split(/\s+/).filter(Boolean).length);
  const avgDocLen = docLengths.reduce((a, b) => a + b, 0) / N;

  return function score(query: string, docIndex: number): number {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const docTerms = docs[docIndex].text.toLowerCase().split(/\s+/).filter(Boolean);
    const docLen = docLengths[docIndex];

    let total = 0;
    for (const term of queryTerms) {
      const tf = docTerms.filter((t) => t === term).length;
      if (tf === 0) continue;
      const df = termDocFreq.get(term) ?? 0;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen)));
      total += idf * tfNorm;
    }
    return total;
  };
}

// ── Embedding ───────────────────────────────────────────────────────

let _embedder: any = null;

async function getEmbedder() {
  if (!_embedder) {
    console.log('  Loading embedding model (Xenova/all-MiniLM-L6-v2)...');
    const { pipeline } = await import(transformersURL);
    _embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('  Model loaded.');
  }
  return _embedder;
}

async function embed(text: string): Promise<number[]> {
  const extractor = await getEmbedder();
  // MiniLM-L6-v2 handles ~512 tokens. Truncate to 4000 chars to capture
  // more session content (the model will internally truncate, but having
  // more text lets BM25 and reranker work with the full session).
  const truncated = text.length > 4000 ? text.slice(0, 4000) : text;
  const result = await extractor(truncated, { pooling: 'mean', normalize: true });
  return Array.from(result.data as Float32Array);
}

// ── Reranker ────────────────────────────────────────────────────────

let _reranker: any = null;
let _rerankerFailed = false;

async function getReranker() {
  if (_rerankerFailed) return null;
  if (!_reranker) {
    try {
      console.log('  Loading reranker model (Xenova/bge-reranker-base)...');
      const { pipeline } = await import(transformersURL);
      _reranker = await pipeline('text-classification', 'Xenova/bge-reranker-base');
      console.log('  Reranker loaded.');
    } catch (e) {
      console.error(`  Reranker load failed: ${(e as Error).message}`);
      _rerankerFailed = true;
      return null;
    }
  }
  return _reranker;
}

async function rerankResults(
  query: string,
  candidates: { session_id: string; score: number; text: string }[],
  topK: number,
): Promise<{ session_id: string; score: number }[]> {
  const ranker = await getReranker();
  if (!ranker) return candidates.slice(0, topK);

  const scored: { session_id: string; score: number }[] = [];
  for (const c of candidates) {
    try {
      // Truncate document for reranker context window
      const docSnippet = c.text.length > 1000 ? c.text.slice(0, 1000) : c.text;
      const output = await ranker(`${query} [SEP] ${docSnippet}`, { topk: 1 });
      const score = Array.isArray(output) ? (output[0]?.score ?? 0) : (output?.score ?? 0);
      scored.push({ session_id: c.session_id, score });
    } catch {
      scored.push({ session_id: c.session_id, score: c.score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ── Hybrid Search (in-memory, mirrors Relay's pipeline) ─────────────

async function hybridSearch(
  query: string,
  queryEmbedding: number[],
  sessions: SessionDoc[],
  topK: number,
): Promise<{ session_id: string; score: number; text: string }[]> {
  // BM25 leg — uses full session text (no truncation needed for keyword matching)
  const bm25Scorer = buildBM25(sessions.map((s) => ({ id: s.session_id, text: s.text })));
  const bm25Scores = sessions.map((s, i) => ({
    session_id: s.session_id,
    score: bm25Scorer(query, i),
    text: s.text,
  }));
  bm25Scores.sort((a, b) => b.score - a.score);

  // Semantic leg — score per CHUNK, take BEST chunk per session
  // This mirrors production: each package has multiple embeddings, best match wins
  const sessionBestSemantic = new Map<string, number>();
  for (const sess of sessions) {
    let bestScore = -1;
    for (const chunk of sess.chunks) {
      if (!chunk.embedding) continue;
      const sim = cosineSim(queryEmbedding, chunk.embedding);
      if (sim > bestScore) bestScore = sim;
    }
    sessionBestSemantic.set(sess.session_id, bestScore);
  }

  const semanticScores = sessions.map((s) => ({
    session_id: s.session_id,
    score: sessionBestSemantic.get(s.session_id) ?? 0,
    text: s.text,
  }));
  semanticScores.sort((a, b) => b.score - a.score);

  // RRF merge (k=60, matching our production setting)
  const k = 60;
  const bm25RankMap = new Map<string, number>();
  bm25Scores.forEach((s, i) => bm25RankMap.set(s.session_id, i + 1));

  const semanticRankMap = new Map<string, number>();
  semanticScores.forEach((s, i) => semanticRankMap.set(s.session_id, i + 1));

  const allIds = new Set([...bm25RankMap.keys(), ...semanticRankMap.keys()]);
  const rrfScores: { session_id: string; score: number; text: string }[] = [];

  for (const id of allIds) {
    const bm25Rank = bm25RankMap.get(id) ?? sessions.length + 1;
    const semRank = semanticRankMap.get(id) ?? sessions.length + 1;
    const rrfScore = 1 / (k + bm25Rank) + 1 / (k + semRank);
    const session = sessions.find((s) => s.session_id === id)!;
    rrfScores.push({ session_id: id, score: rrfScore, text: session.text });
  }

  rrfScores.sort((a, b) => b.score - a.score);

  // Over-retrieve 3x for reranking (matching production pipeline)
  const overRetrieveCount = topK * 3;
  const candidates = rrfScores.slice(0, overRetrieveCount);

  // Rerank with cross-encoder
  return rerankResults(query, candidates, topK);
}

// ── Main Benchmark Loop ─────────────────────────────────────────────

async function runBenchmark(opts: {
  dataset: string;
  limit: number;
  topK: number;
}) {
  const dataPath = path.join(__dirname, 'data', `longmemeval_${opts.dataset}_cleaned.json`);
  if (opts.dataset === 'oracle') {
    // Oracle file doesn't have _cleaned suffix
    const oraclePath = path.join(__dirname, 'data', 'longmemeval_oracle.json');
    if (fs.existsSync(oraclePath)) {
      console.log(`Loading dataset: ${oraclePath}`);
      var questions: Question[] = JSON.parse(fs.readFileSync(oraclePath, 'utf-8'));
    } else {
      console.error(`Dataset not found: ${oraclePath}`);
      process.exit(1);
    }
  } else {
    console.log(`Loading dataset: ${dataPath}`);
    if (!fs.existsSync(dataPath)) {
      console.error(`Dataset not found: ${dataPath}`);
      process.exit(1);
    }
    var questions: Question[] = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  }

  // Apply limit
  if (opts.limit > 0 && opts.limit < questions.length) {
    questions = questions.slice(0, opts.limit);
  }

  console.log(`\nLongMemEval Retrieval Benchmark`);
  console.log(`Dataset: ${opts.dataset} | Questions: ${questions.length} | Top-K: ${opts.topK}`);
  console.log(`Pipeline: Hybrid (BM25 + Semantic RRF) → Cross-Encoder Rerank`);
  console.log(`${'─'.repeat(60)}\n`);

  const results: RetrievalResult[] = [];
  const startTime = Date.now();

  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi];
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    process.stdout.write(`\r[${qi + 1}/${questions.length}] (${elapsed}s) ${q.question_type.padEnd(30)} `);

    // 1. Build session documents with chunks (mirrors production pipeline)
    const sessions: SessionDoc[] = q.haystack_sessions.map((turns, i) => ({
      session_id: q.haystack_session_ids[i],
      text: sessionToText(turns),
      chunks: sessionToChunks(q.haystack_session_ids[i], turns),
    }));

    // 2. Embed all chunks (not whole sessions — each turn gets its own embedding)
    for (const sess of sessions) {
      for (const chunk of sess.chunks) {
        chunk.embedding = await embed(chunk.text);
      }
    }

    // 3. Embed the query
    const queryEmbedding = await embed(q.question);

    // 4. Run hybrid search + rerank
    const topResults = await hybridSearch(q.question, queryEmbedding, sessions, opts.topK);
    const retrievedIds = topResults.map((r) => r.session_id);

    // 5. Check recall
    const answerSet = new Set(q.answer_session_ids);
    const recallAny = retrievedIds.some((id) => answerSet.has(id));
    const recallAll = q.answer_session_ids.every((id) => retrievedIds.includes(id));

    results.push({
      question_id: q.question_id,
      question_type: q.question_type,
      answer_session_ids: q.answer_session_ids,
      retrieved_session_ids: retrievedIds,
      recall_any_at_k: recallAny,
      recall_all_at_k: recallAll,
    });
  }

  // ── Compute Metrics ───────────────────────────────────────────────

  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`RESULTS — LongMemEval ${opts.dataset.toUpperCase()} @ Top-${opts.topK}`);
  console.log(`${'═'.repeat(60)}\n`);

  const total = results.length;
  const recallAnyCount = results.filter((r) => r.recall_any_at_k).length;
  const recallAllCount = results.filter((r) => r.recall_all_at_k).length;

  console.log(`Overall:`);
  console.log(`  recall_any@${opts.topK}: ${(recallAnyCount / total * 100).toFixed(1)}% (${recallAnyCount}/${total})`);
  console.log(`  recall_all@${opts.topK}: ${(recallAllCount / total * 100).toFixed(1)}% (${recallAllCount}/${total})`);

  // Per question type
  const types = [...new Set(results.map((r) => r.question_type))].sort();
  console.log(`\nBy question type:`);
  for (const type of types) {
    const typeResults = results.filter((r) => r.question_type === type);
    const anyCount = typeResults.filter((r) => r.recall_any_at_k).length;
    const allCount = typeResults.filter((r) => r.recall_all_at_k).length;
    console.log(`  ${type.padEnd(30)} recall_any: ${(anyCount / typeResults.length * 100).toFixed(1)}%  recall_all: ${(allCount / typeResults.length * 100).toFixed(1)}%  (n=${typeResults.length})`);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nTotal time: ${totalTime}s (${(parseFloat(totalTime) / total).toFixed(2)}s per question)`);

  // Save results
  const outputPath = path.join(__dirname, `results-${opts.dataset}-k${opts.topK}-${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify({ opts, metrics: { recallAnyCount, recallAllCount, total }, results }, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  // Comparison
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Comparison:`);
  console.log(`  Relay:               ${(recallAnyCount / total * 100).toFixed(1)}% recall_any@${opts.topK}`);
  console.log(`${'─'.repeat(60)}`);
}

// ── CLI ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const datasetArg = args.find((a) => a.startsWith('--dataset'))?.split('=')[1]
  || args[args.indexOf('--dataset') + 1]
  || 'oracle';
const limitArg = parseInt(
  args.find((a) => a.startsWith('--limit'))?.split('=')[1]
  || args[args.indexOf('--limit') + 1]
  || '0',
  10,
);
const topKArg = parseInt(
  args.find((a) => a.startsWith('--top-k'))?.split('=')[1]
  || args[args.indexOf('--top-k') + 1]
  || '5',
  10,
);

runBenchmark({
  dataset: datasetArg,
  limit: isNaN(limitArg) ? 0 : limitArg,
  topK: isNaN(topKArg) ? 5 : topKArg,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
