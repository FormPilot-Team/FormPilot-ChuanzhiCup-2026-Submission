import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ruleFallbackText, runAgentTurn } from '../../src/features/coachLlm/agent'
import { buildKnowledgeBase } from '../../src/features/coachLlm/knowledge'
import { executeAgentTool } from '../../src/features/coachLlm/tools'
import { bridgeTransport, toolContext } from './fixtures'
import { RAG_CASES, type RagCase } from './rag-cases'

/**
 * RAG comparison (V1.2), all three arms on the same 20 questions:
 * - llm_no_rag: the same local Qwen model answering from its own knowledge (plain prompt, no tools);
 * - llm_rag: the full V1.2 agent (tool calling + retrieval + validation);
 * - rules_only: retrieval + deterministic rendering, no model.
 * Ground truth = key facts and source chunks from the product's registries (official-source paraphrases).
 */
const NO_RAG_SYSTEM = '你是健身气功与动作训练助手。使用简体中文，先给结论，再给 2–4 条要点，总长度不超过 220 字。'
const OUT = process.env.FP_EVAL_OUT ?? 'test-results/llm-eval'
const OLLAMA = process.env.FP_OLLAMA_URL ?? 'http://127.0.0.1:11441'
const MODEL = process.env.FP_AGENT_MODEL ?? 'qwen3:4b-instruct-2507-q4_K_M'

function score(text: string, testCase: RagCase) {
  const matched = testCase.facts.filter((fact) => fact.test(text)).length
  return { factRecall: Math.round((matched / testCase.facts.length) * 100) / 100, matched, total: testCase.facts.length }
}

const CHUNKS = new Map(buildKnowledgeBase().map((chunk) => [chunk.id, chunk]))

/** Relevant = the chunk's own subject (chapter / exercise id) or exact id is in the case's expected list. */
function relevant(chunkId: string, testCase: RagCase): boolean {
  const chunk = CHUNKS.get(chunkId)
  if (!chunk) return false
  return testCase.subjects.some((subject) => chunkId === subject || (chunk.subject !== null && chunk.subject === subject)
    || (subject === 'tjq' && chunk.topic === 'taijiquan'))
}

async function noRag(question: string) {
  const started = performance.now()
  const response = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, stream: false, think: false, keep_alive: '30m', messages: [{ role: 'system', content: NO_RAG_SYSTEM }, { role: 'user', content: question }], options: { temperature: 0.2, num_ctx: 8192, num_predict: 700 } }) })
  const body = await response.json() as { message?: { content?: string } }
  return { text: body.message?.content ?? '', ms: Math.round(performance.now() - started) }
}

describe('RAG comparison with the real local model', () => {
  it('compares no-RAG, RAG and rules-only on the same questions', async () => {
    const transport = bridgeTransport()
    const rows: Array<Record<string, unknown>> = []
    for (const testCase of RAG_CASES) {
      const a = await noRag(testCase.question)
      const ragAnswer = await runAgentTurn(testCase.question, { transport, context: toolContext() })
      const started = performance.now()
      const search = await executeAgentTool({ name: 'search_knowledge', arguments: { query: testCase.question, topic: 'any' } }, toolContext())
      const rulesText = ruleFallbackText([search], testCase.question)
      const rulesMs = Math.round(performance.now() - started)
      const cited = [...ragAnswer.text.matchAll(/\[(K\d+)\]/gu)].map((match) => match[1])
      const citedChunks = cited.map((ref) => ragAnswer.citations.find((c) => c.ref === ref)?.chunkId).filter((id): id is string => !!id)
      const row = {
        id: testCase.id, question: testCase.question, decline: !!testCase.decline,
        llm_no_rag: { text: a.text, ms: a.ms, ...score(a.text, testCase) },
        llm_rag: { text: ragAnswer.text, ms: ragAnswer.metrics.totalMs, source: ragAnswer.source, ...score(ragAnswer.text, testCase),
          citations: cited.length, citedChunks, citationRelevant: testCase.subjects.length ? citedChunks.filter((id) => relevant(id, testCase)).length : null,
          retrieved: ragAnswer.citations.map((c) => c.chunkId), validation: ragAnswer.validation, tools: ragAnswer.tools.map((t) => `${t.name}${t.routed ? '(router)' : ''}`) },
        rules_only: { text: rulesText, ms: rulesMs, ...score(rulesText, testCase),
          retrievedRelevant: testCase.subjects.length ? search.citations.filter((c) => relevant(c.chunkId, testCase)).length : null, retrieved: search.citations.map((c) => c.chunkId) },
      }
      rows.push(row)
      console.log(`${testCase.id}: noRAG ${row.llm_no_rag.factRecall} | RAG ${row.llm_rag.factRecall} (${row.llm_rag.source}, cites ${row.llm_rag.citationRelevant}/${row.llm_rag.citations}) | rules ${row.rules_only.factRecall}`)
    }
    const mean = (key: 'llm_no_rag' | 'llm_rag' | 'rules_only') => Math.round(rows.reduce((sum, row) => sum + ((row[key] as { factRecall: number }).factRecall), 0) / rows.length * 100) / 100
    const medianMs = (key: 'llm_no_rag' | 'llm_rag' | 'rules_only') => rows.map((row) => (row[key] as { ms: number }).ms).sort((x, y) => x - y)[Math.floor(rows.length / 2)]
    const ragRows = rows.map((row) => row.llm_rag as { citations: number; citationRelevant: number | null; source: string })
    const summary = {
      model: MODEL, at: new Date().toISOString(), questions: rows.length,
      meanFactRecall: { llm_no_rag: mean('llm_no_rag'), llm_rag: mean('llm_rag'), rules_only: mean('rules_only') },
      medianMs: { llm_no_rag: medianMs('llm_no_rag'), llm_rag: medianMs('llm_rag'), rules_only: medianMs('rules_only') },
      ragCitations: { answersWithCitation: ragRows.filter((row) => row.citations > 0).length, cited: ragRows.reduce((s, r) => s + r.citations, 0), relevant: ragRows.reduce((s, r) => s + (r.citationRelevant ?? 0), 0) },
      ragSources: Object.fromEntries(['llm', 'rules_fallback', 'safety_rule'].map((s) => [s, ragRows.filter((row) => row.source === s).length])),
    }
    mkdirSync(OUT, { recursive: true })
    writeFileSync(join(OUT, 'rag-eval.json'), JSON.stringify({ summary, rows }, null, 2))
    console.log(JSON.stringify(summary))
    expect(rows.length).toBe(RAG_CASES.length)
  }, 60 * 60_000)
})
