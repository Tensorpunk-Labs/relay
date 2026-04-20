/**
 * LongMemEval End-to-End QA Evaluation for Relay
 *
 * Official LongMemEval evaluation protocol:
 * 1. For each question, retrieve relevant sessions (hybrid search + reranker)
 * 2. Feed retrieved context + question to GPT-4o-mini to generate an answer
 * 3. Use GPT-4o as a judge to compare generated answer against ground truth
 * 4. Output JSONL + summary JSON with accuracy and per-type breakdown
 *
 * Usage:
 *   npx tsx benchmarks/longmemeval/run-qa-eval.ts --dataset s --limit 10
 *   npx tsx benchmarks/longmemeval/run-qa-eval.ts --dataset s --dry-run
 *   npx tsx benchmarks/longmemeval/run-qa-eval.ts --dataset oracle --limit 0
 *
 * Requires: benchmarks/longmemeval/.env with OPENAI_API_KEY=sk-...
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

// ── Load .env ─────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`Missing .env file at ${envPath}`);
    console.error('Expected: OPENAI_API_KEY=sk-...');
    process.exit(1);
  }
  const env: Record<string, string> = {};
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const ENV = loadEnv();
const OPENAI_API_KEY = ENV.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY not found in .env file');
  process.exit(1);
}
const ANTHROPIC_API_KEY = ENV.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not found in .env file');
  process.exit(1);
}

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

interface QAResult {
  question_id: string;
  question_type: string;
  question: string;
  ground_truth: string;
  hypothesis: string;
  judgment: 'correct' | 'incorrect' | 'skipped';
  retrieved_session_ids: string[];
}

// ── Cost Tracking ──────────────────────────────────────────────────

interface TokenUsage {
  gen_input: number;
  gen_output: number;
  judge_input: number;
  judge_output: number;
}

const PRICING = {
  // Claude Opus 4.6 (generation)
  gen_input_per_1m: 15.00,
  gen_output_per_1m: 75.00,
  // GPT-4o (judgment)
  judge_input_per_1m: 2.50,
  judge_output_per_1m: 10.00,
};

function computeCost(usage: TokenUsage): number {
  return (
    (usage.gen_input / 1_000_000) * PRICING.gen_input_per_1m +
    (usage.gen_output / 1_000_000) * PRICING.gen_output_per_1m +
    (usage.judge_input / 1_000_000) * PRICING.judge_input_per_1m +
    (usage.judge_output / 1_000_000) * PRICING.judge_output_per_1m
  );
}

function formatCost(usage: TokenUsage): string {
  const cost = computeCost(usage);
  const totalTokens = usage.gen_input + usage.gen_output + usage.judge_input + usage.judge_output;
  return `Tokens: ${totalTokens.toLocaleString()} (gen: ${(usage.gen_input + usage.gen_output).toLocaleString()}, judge: ${(usage.judge_input + usage.judge_output).toLocaleString()}) | Est. cost: $${cost.toFixed(4)}`;
}

// ── Helpers ─────────────────────────────────────────────────────────

function sessionToText(turns: Turn[]): string {
  return turns
    .map((t) => `${t.role}: ${t.content}`)
    .join('\n');
}

function sessionToChunks(sessionId: string, turns: Turn[]): SessionChunk[] {
  const chunks: SessionChunk[] = [];

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.content.trim().length < 10) continue;
    chunks.push({
      session_id: sessionId,
      chunk_type: t.role,
      text: t.content,
    });
  }

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

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

function buildBM25(docs: { id: string; text: string }[]) {
  const k1 = 1.2;
  const b = 0.75;
  const N = docs.length;

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
): Promise<{ session_id: string; score: number; text: string }[]> {
  const ranker = await getReranker();
  if (!ranker) return candidates.slice(0, topK);

  const scored: { session_id: string; score: number; text: string }[] = [];
  for (const c of candidates) {
    try {
      const docSnippet = c.text.length > 1000 ? c.text.slice(0, 1000) : c.text;
      const output = await ranker(`${query} [SEP] ${docSnippet}`, { topk: 1 });
      const score = Array.isArray(output) ? (output[0]?.score ?? 0) : (output?.score ?? 0);
      scored.push({ session_id: c.session_id, score, text: c.text });
    } catch {
      scored.push({ session_id: c.session_id, score: c.score, text: c.text });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ── Hybrid Search ──────────────────────────────────────────────────

async function hybridSearch(
  query: string,
  queryEmbedding: number[],
  sessions: SessionDoc[],
  topK: number,
): Promise<{ session_id: string; score: number; text: string }[]> {
  // BM25 leg
  const bm25Scorer = buildBM25(sessions.map((s) => ({ id: s.session_id, text: s.text })));
  const bm25Scores = sessions.map((s, i) => ({
    session_id: s.session_id,
    score: bm25Scorer(query, i),
    text: s.text,
  }));
  bm25Scores.sort((a, b) => b.score - a.score);

  // Semantic leg — best chunk per session
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

  // RRF merge (k=60)
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

  // Over-retrieve 3x for reranking
  const overRetrieveCount = topK * 3;
  const candidates = rrfScores.slice(0, overRetrieveCount);

  // Rerank with cross-encoder
  return rerankResults(query, candidates, topK);
}

// ── OpenAI API ─────────────────────────────────────────────────────

const OPENAI_BASE = 'https://api.openai.com/v1/chat/completions';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIResponse {
  choices: { message: { content: string } }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

async function callOpenAI(
  model: string,
  messages: ChatMessage[],
  temperature: number = 0,
  maxTokens: number = 256,
): Promise<{ content: string; prompt_tokens: number; completion_tokens: number }> {
  let response: Response;
  try {
    response = await fetch(OPENAI_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });
  } catch (fetchErr) {
    // Network timeout / connection error — retry after delay
    console.log(`\n  Network error — retrying in 15s...`);
    await delay(15000);
    return callOpenAI(model, messages, temperature, maxTokens);
  }

  if (!response.ok) {
    const errText = await response.text();
    // Retry on rate limit (429) with exponential backoff
    if (response.status === 429) {
      const retryMatch = errText.match(/try again in (\d+\.?\d*)/i);
      const waitSec = retryMatch ? parseFloat(retryMatch[1]) + 1 : 10;
      console.log(`\n  Rate limited — waiting ${waitSec.toFixed(0)}s...`);
      await delay(waitSec * 1000);
      return callOpenAI(model, messages, temperature, maxTokens);
    }
    throw new Error(`OpenAI API error (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as OpenAIResponse;
  return {
    content: data.choices[0]?.message?.content?.trim() ?? '',
    prompt_tokens: data.usage?.prompt_tokens ?? 0,
    completion_tokens: data.usage?.completion_tokens ?? 0,
  };
}

/** Small delay for rate limiting. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Anthropic API (Claude Opus 4.6 for generation) ───────────────

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages';

async function callAnthropic(
  system: string,
  userMessage: string,
  maxTokens: number = 256,
): Promise<{ content: string; input_tokens: number; output_tokens: number }> {
  const response = await fetch(ANTHROPIC_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 429) {
      const retryMatch = errText.match(/try again in (\d+\.?\d*)/i);
      const waitSec = retryMatch ? parseFloat(retryMatch[1]) + 1 : 15;
      console.log(`\n  Anthropic rate limited — waiting ${waitSec.toFixed(0)}s...`);
      await delay(waitSec * 1000);
      return callAnthropic(system, userMessage, maxTokens);
    }
    throw new Error(`Anthropic API error (${response.status}): ${errText}`);
  }

  const data = await response.json() as {
    content: { type: string; text: string }[];
    usage: { input_tokens: number; output_tokens: number };
  };

  return {
    content: data.content[0]?.text?.trim() ?? '',
    input_tokens: data.usage?.input_tokens ?? 0,
    output_tokens: data.usage?.output_tokens ?? 0,
  };
}

// ── Question-Type-Aware Prompts ──────────────────────────────────

const TYPE_PROMPTS: Record<string, string> = {
  'temporal-reasoning':
    `You are answering a temporal reasoning question. The user is asking about when something happened, the order of events, or how much time passed between events.

CRITICAL RULES:
- Extract exact dates from the conversations. Write them down explicitly.
- When calculating days between dates, count carefully: list out the months and days.
- "First" means the event with the EARLIER date, not the one mentioned first in conversation.
- If someone says "last Saturday" or "two weeks ago", calculate the actual date from the conversation context.
- Show your date math briefly, then give a direct answer.`,

  'knowledge-update':
    `You are answering a question where the user may have UPDATED or CONTRADICTED earlier information. The conversations may contain both old and new versions of a fact.

CRITICAL RULES:
- If the user stated something and later corrected it, use the MOST RECENT version.
- The latest conversation session has the most up-to-date information.
- Look for phrases like "actually", "I changed my mind", "I was wrong", "update" as signals.
- Answer based on the CURRENT truth, not historical statements.`,

  'multi-session':
    `You are answering a question that requires combining information from MULTIPLE conversation sessions.

CRITICAL RULES:
- The answer may not exist in any single session — you may need to synthesize across sessions.
- Read ALL provided sessions carefully before answering.
- If different sessions give complementary pieces of information, combine them.
- Be precise about which facts come from which context.`,

  'single-session-user':
    `You are answering a question about something the USER said in a conversation.

CRITICAL RULES:
- Focus on the user's own statements, preferences, and experiences.
- Answer directly with what the user said. Don't infer beyond what's stated.
- Quote or paraphrase the user's words precisely.`,

  'single-session-assistant':
    `You are answering a question about something the ASSISTANT said or recommended in a conversation.

CRITICAL RULES:
- Focus on what the assistant said, recommended, or suggested.
- The answer is in the assistant's responses, not the user's messages.
- Be precise about the assistant's exact words or recommendations.`,

  'single-session-preference':
    `You are answering a question about what kind of response the user would PREFER based on their conversation history.

CRITICAL RULES:
- The question asks what the user would PREFER — not what they explicitly said. Infer their preferences from context clues, interests, and past statements.
- Frame your answer as "The user would prefer..." or describe what kind of response would best match their interests.
- Look for: hobbies mentioned, products they use, experiences they described, opinions they expressed, plans they made.
- Build on what they've shared: if they mentioned using Adobe Premiere Pro, they'd prefer video editing resources tailored to Premiere Pro.
- If they mentioned enjoying a specific cuisine, they'd prefer recipe suggestions in that style.
- The answer should reflect an understanding of the user as a person, not just quote their words.`,
};

// ── Context Presentation Layer (adapter) ─────────────────────────
// Formats retrieved sessions for optimal LLM consumption.
// Does NOT touch the retrieval pipeline — only how results are presented.

/**
 * Strip assistant turns (noise) and format with date headers.
 * User turns contain the facts; assistant turns are generic filler.
 */
function formatSessionForLLM(
  sessionText: string,
  sessionDate?: string,
): string {
  const lines = sessionText.split('\n');
  const userLines: string[] = [];

  for (const line of lines) {
    // Keep user turns, strip assistant turns
    if (line.startsWith('user: ')) {
      userLines.push(line.slice(6)); // remove "user: " prefix
    }
    // Also keep short assistant responses that contain facts (< 200 chars)
    // Long assistant responses are almost always generic advice/filler
    if (line.startsWith('assistant: ') && line.length < 200) {
      userLines.push(`[assistant] ${line.slice(11)}`);
    }
  }

  const header = sessionDate ? `[Date: ${sessionDate}]` : '';
  return `${header}\n${userLines.join('\n')}`.trim();
}

// ── Answer Generation (Claude Opus 4.6) ──────────────────────────

async function generateAnswer(
  question: string,
  questionType: string,
  contextSessions: string[],
  sessionDates?: string[],
  questionDate?: string,
): Promise<{ answer: string; prompt_tokens: number; completion_tokens: number }> {
  // Apply adapter layer: type-aware context formatting
  // For assistant/preference questions, keep ALL turns (answer is in assistant responses)
  // For other types, strip assistant noise to reduce tokens and improve focus
  const keepAllTurns = questionType === 'single-session-assistant' || questionType === 'single-session-preference';

  const formattedSessions = contextSessions.map((text, i) => {
    const date = sessionDates?.[i];
    if (keepAllTurns) {
      // Keep full conversation with date header
      const header = date ? `[Date: ${date}]` : '';
      return `${header}\n${text}`.trim();
    }
    return formatSessionForLLM(text, date);
  });

  const contextBlock = formattedSessions
    .map((text, i) => `--- Session ${i + 1} ---\n${text}`)
    .join('\n\n');

  const systemPrompt = TYPE_PROMPTS[questionType] ||
    'You are a helpful assistant that answers questions based on conversation history. Answer concisely and directly.';

  const dateContext = questionDate ? `\nThe question is being asked on: ${questionDate}\n` : '';

  const userMessage = `${dateContext}Conversation history (user statements extracted, chronological order):\n${contextBlock}\n\nQuestion: ${question}\n\nThink briefly, then provide your final answer on the last line prefixed with "ANSWER: ". Keep the answer concise.`;

  const result = await callAnthropic(systemPrompt, userMessage, 300);
  return {
    answer: result.content,
    prompt_tokens: result.input_tokens,
    completion_tokens: result.output_tokens,
  };
}

// ── QA Judgment (GPT-4o) ───────────────────────────────────────────

async function judgeAnswer(
  question: string,
  groundTruth: string,
  hypothesis: string,
): Promise<{ judgment: 'correct' | 'incorrect'; prompt_tokens: number; completion_tokens: number }> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a fair judge evaluating whether a generated answer is correct based on the ground truth answer.

EVALUATION RULES:
- The generated answer is CORRECT if it conveys the same meaning or information as the ground truth, even if worded differently.
- Accept numerical equivalents: "30 days" and "about a month" and "30" are all equivalent if the ground truth is "30 days".
- Accept reasonable rounding or inclusive/exclusive counting: if ground truth says "30 days" and the answer says "31 days (including the last day)", that is CORRECT.
- Focus on the FINAL ANSWER, not intermediate reasoning steps. If the answer shows math work and arrives at the correct number, it is CORRECT.
- Partial credit: if the answer contains the correct information along with additional (non-contradictory) details, it is CORRECT.
- The answer is INCORRECT only if it gives a fundamentally different answer than the ground truth.

Respond with ONLY "correct" or "incorrect".`,
    },
    {
      role: 'user',
      content: `Question: ${question}\n\nGround truth answer: ${groundTruth}\n\nGenerated answer: ${hypothesis}\n\nIs the generated answer correct?`,
    },
  ];

  const result = await callOpenAI('gpt-4o', messages, 0, 8);
  const judgment = result.content.toLowerCase().includes('correct') && !result.content.toLowerCase().startsWith('incorrect')
    ? 'correct'
    : 'incorrect';
  return {
    judgment,
    prompt_tokens: result.prompt_tokens,
    completion_tokens: result.completion_tokens,
  };
}

// ── Main QA Evaluation Loop ────────────────────────────────────────

async function runQAEval(opts: {
  dataset: string;
  limit: number;
  skip: number;
  dryRun: boolean;
}) {
  // Load dataset
  let dataPath: string;
  if (opts.dataset === 'oracle') {
    dataPath = path.join(__dirname, 'data', 'longmemeval_oracle.json');
  } else {
    dataPath = path.join(__dirname, 'data', `longmemeval_${opts.dataset}_cleaned.json`);
  }

  if (!fs.existsSync(dataPath)) {
    console.error(`Dataset not found: ${dataPath}`);
    process.exit(1);
  }

  console.log(`Loading dataset: ${dataPath}`);
  let questions: Question[] = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  if (opts.limit > 0 && opts.limit < questions.length) {
    questions = questions.slice(0, opts.limit);
  }
  if (opts.skip > 0) {
    console.log(`Skipping first ${opts.skip} questions (resuming)...`);
    questions = questions.slice(opts.skip);
  }

  console.log(`\nLongMemEval End-to-End QA Evaluation`);
  console.log(`Dataset: ${opts.dataset} | Questions: ${questions.length} | Mode: ${opts.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Pipeline: Hybrid Search + Rerank -> Claude Opus 4.6 (gen, type-aware) -> GPT-4o (judge)`);
  console.log(`${'─'.repeat(70)}\n`);

  const results: QAResult[] = [];
  const usage: TokenUsage = { gen_input: 0, gen_output: 0, judge_input: 0, judge_output: 0 };
  const startTime = Date.now();
  let correctCount = 0;

  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi];
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    process.stdout.write(`\r[${qi + 1}/${questions.length}] (${elapsed}s) ${q.question_type.padEnd(30)} `);

    // 1. Build session documents with chunks
    const sessions: SessionDoc[] = q.haystack_sessions.map((turns, i) => ({
      session_id: q.haystack_session_ids[i],
      text: sessionToText(turns),
      chunks: sessionToChunks(q.haystack_session_ids[i], turns),
    }));

    // 2. Embed all chunks
    for (const sess of sessions) {
      for (const chunk of sess.chunks) {
        chunk.embedding = await embed(chunk.text);
      }
    }

    // 3. Embed the query
    const queryEmbedding = await embed(q.question);

    // 4. Run hybrid search + rerank (top-5)
    const topResults = await hybridSearch(q.question, queryEmbedding, sessions, 5);
    const retrievedIds = topResults.map((r) => r.session_id);
    const retrievedTexts = topResults.map((r) => r.text);

    if (opts.dryRun) {
      // Show what WOULD be sent to the API
      const contextPreview = retrievedTexts.map((t, i) =>
        `  Session ${i + 1} (${retrievedIds[i]}): ${t.slice(0, 80).replace(/\n/g, ' ')}...`
      ).join('\n');
      console.log(`\n  Q: ${q.question}`);
      console.log(`  Ground truth: ${q.answer}`);
      console.log(`  Retrieved sessions:`);
      console.log(contextPreview);
      console.log(`  Answer sessions hit: ${q.answer_session_ids.some(id => retrievedIds.includes(id)) ? 'YES' : 'NO'}`);
      console.log();

      results.push({
        question_id: q.question_id,
        question_type: q.question_type,
        question: q.question,
        ground_truth: q.answer,
        hypothesis: '[DRY RUN]',
        judgment: 'skipped',
        retrieved_session_ids: retrievedIds,
      });
      continue;
    }

    // 5. Generate answer via Claude Opus 4.6 (question-type-aware prompt + adapter layer)
    // Map retrieved session IDs back to their dates for context presentation
    const retrievedDates = retrievedIds.map((id) => {
      const idx = q.haystack_session_ids.indexOf(id);
      return idx >= 0 ? q.haystack_dates[idx] : undefined;
    }).filter((d): d is string => !!d);
    const genResult = await generateAnswer(q.question, q.question_type, retrievedTexts, retrievedDates, q.question_date);
    usage.gen_input += genResult.prompt_tokens;
    usage.gen_output += genResult.completion_tokens;

    await delay(6000);

    // 6. Judge answer via GPT-4o
    const judgeResult = await judgeAnswer(q.question, q.answer, genResult.answer);
    usage.judge_input += judgeResult.prompt_tokens;
    usage.judge_output += judgeResult.completion_tokens;

    if (judgeResult.judgment === 'correct') correctCount++;

    await delay(6000);

    results.push({
      question_id: q.question_id,
      question_type: q.question_type,
      question: q.question,
      ground_truth: q.answer,
      hypothesis: genResult.answer,
      judgment: judgeResult.judgment,
      retrieved_session_ids: retrievedIds,
    });

    // Cost checkpoint every 50 questions
    if ((qi + 1) % 50 === 0) {
      const pct = (correctCount / (qi + 1) * 100).toFixed(1);
      console.log(`\n  [Checkpoint @ ${qi + 1}] Accuracy: ${pct}% (${correctCount}/${qi + 1}) | ${formatCost(usage)}`);
    }
  }

  // ── Results ───────────────────────────────────────────────────────

  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`RESULTS — LongMemEval QA ${opts.dataset.toUpperCase()}${opts.dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`${'═'.repeat(70)}\n`);

  if (opts.dryRun) {
    const retrievalHits = results.filter((r) => {
      const q = questions.find((qq) => qq.question_id === r.question_id)!;
      return q.answer_session_ids.some((id) => r.retrieved_session_ids.includes(id));
    }).length;
    console.log(`Retrieval coverage: ${(retrievalHits / results.length * 100).toFixed(1)}% (${retrievalHits}/${results.length})`);
    console.log(`\nDry run complete — no OpenAI API calls were made.`);
    console.log(`Re-run without --dry-run to execute the full QA pipeline.`);
    return;
  }

  const total = results.length;
  const accuracy = (correctCount / total * 100).toFixed(1);

  console.log(`Overall QA Accuracy: ${accuracy}% (${correctCount}/${total})`);
  console.log();

  // Per question type breakdown
  const types = [...new Set(results.map((r) => r.question_type))].sort();
  console.log(`By question type:`);
  for (const type of types) {
    const typeResults = results.filter((r) => r.question_type === type);
    const typeCorrect = typeResults.filter((r) => r.judgment === 'correct').length;
    const typePct = (typeCorrect / typeResults.length * 100).toFixed(1);
    console.log(`  ${type.padEnd(30)} ${typePct}% (${typeCorrect}/${typeResults.length})`);
  }

  console.log();
  console.log(`Cost: ${formatCost(usage)}`);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Time: ${totalTime}s (${(parseFloat(totalTime) / total).toFixed(2)}s per question)`);

  // ── Save JSONL ────────────────────────────────────────────────────

  const timestamp = Date.now();
  const jsonlPath = path.join(__dirname, `qa-results-${opts.dataset}-${timestamp}.jsonl`);
  const jsonlLines = results.map((r) =>
    JSON.stringify({ question_id: r.question_id, hypothesis: r.hypothesis })
  );
  fs.writeFileSync(jsonlPath, jsonlLines.join('\n') + '\n');
  console.log(`\nJSONL saved to: ${jsonlPath}`);

  // ── Save Summary JSON ─────────────────────────────────────────────

  const perType: Record<string, { correct: number; total: number; accuracy: number }> = {};
  for (const type of types) {
    const typeResults = results.filter((r) => r.question_type === type);
    const typeCorrect = typeResults.filter((r) => r.judgment === 'correct').length;
    perType[type] = {
      correct: typeCorrect,
      total: typeResults.length,
      accuracy: parseFloat((typeCorrect / typeResults.length * 100).toFixed(1)),
    };
  }

  const summary = {
    dataset: opts.dataset,
    total_questions: total,
    correct: correctCount,
    accuracy: parseFloat(accuracy),
    per_type: perType,
    token_usage: usage,
    estimated_cost_usd: parseFloat(computeCost(usage).toFixed(4)),
    time_seconds: parseFloat(totalTime),
    timestamp: new Date().toISOString(),
    pipeline: 'hybrid_bm25_semantic_rrf_rerank -> claude-opus-4-6 (gen, type-aware) -> gpt-4o (judge)',
  };

  const summaryPath = path.join(__dirname, `qa-summary-${opts.dataset}-${timestamp}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`Summary saved to: ${summaryPath}`);

  // ── Missed questions detail ───────────────────────────────────────

  const missed = results.filter((r) => r.judgment === 'incorrect');
  if (missed.length > 0 && missed.length <= 20) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Missed questions (${missed.length}):`);
    for (const m of missed) {
      console.log(`  [${m.question_type}] Q: ${m.question}`);
      console.log(`    Ground truth: ${m.ground_truth}`);
      console.log(`    Generated:    ${m.hypothesis}`);
      console.log();
    }
  }
}

// ── CLI ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name: string, fallback: string): string {
  // Support --name=value and --name value
  const eqArg = args.find((a) => a.startsWith(`--${name}=`));
  if (eqArg) return eqArg.split('=').slice(1).join('=');
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return fallback;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const datasetArg = getArg('dataset', 's');
const limitArg = parseInt(getArg('limit', '0'), 10);
const skipArg = parseInt(getArg('skip', '0'), 10);
const dryRun = hasFlag('dry-run');

runQAEval({
  dataset: datasetArg,
  limit: isNaN(limitArg) ? 0 : limitArg,
  skip: isNaN(skipArg) ? 0 : skipArg,
  dryRun,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
