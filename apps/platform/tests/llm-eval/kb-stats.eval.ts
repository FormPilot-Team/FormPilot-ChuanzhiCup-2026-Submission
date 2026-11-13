import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildKnowledgeBase } from '../../src/features/coachLlm/knowledge'
import { RETRIEVAL_CONFIG, retrieveKnowledge } from '../../src/features/coachLlm/retrieval'
import { RAG_CASES } from './rag-cases'

/** Knowledge-base statistics and retrieval-only metrics (no model): corpus make-up, recall@k and latency per question. */
describe('knowledge base statistics', () => {
  it('writes corpus and retrieval statistics', () => {
    const base = buildKnowledgeBase()
    const count = (key: (chunk: (typeof base)[number]) => string) => base.reduce<Record<string, number>>((acc, chunk) => { const k = key(chunk); acc[k] = (acc[k] ?? 0) + 1; return acc }, {})
    const verification = base.reduce<Record<string, number>>((acc, chunk) => { for (const c of chunk.citations) acc[c.verification] = (acc[c.verification] ?? 0) + 1; return acc }, {})
    const retrieval = RAG_CASES.map((testCase) => {
      const result = retrieveKnowledge(testCase.question)
      const subjects = result.hits.map((hit) => hit.chunk.subject ?? hit.chunk.id)
      const relevantAt = subjects.findIndex((subject) => testCase.subjects.includes(subject) || (testCase.subjects.includes('tjq') && result.hits[subjects.indexOf(subject)]?.chunk.topic === 'taijiquan'))
      return { id: testCase.id, status: result.status, hits: result.hits.length, firstRelevantRank: relevantAt >= 0 ? relevantAt + 1 : null, expectsDecline: !!testCase.decline, elapsedMs: Math.round(result.elapsedMs * 100) / 100 }
    })
    const answerable = retrieval.filter((row) => !row.expectsDecline && RAG_CASES.find((c) => c.id === row.id)!.subjects.length && !RAG_CASES.find((c) => c.id === row.id)!.subjects.includes('*'))
    const stats = {
      chunks: base.length, byKind: count((chunk) => chunk.kind), byTopic: count((chunk) => chunk.topic), citationVerification: verification,
      config: RETRIEVAL_CONFIG,
      recallAt1: answerable.filter((row) => row.firstRelevantRank === 1).length / answerable.length,
      recallAtK: answerable.filter((row) => row.firstRelevantRank !== null).length / answerable.length,
      answerableQuestions: answerable.length,
      declineQuestionsInsufficient: retrieval.filter((row) => row.expectsDecline && row.status === 'insufficient').map((row) => row.id),
      maxRetrievalMs: Math.max(...retrieval.map((row) => row.elapsedMs)),
      retrieval,
    }
    const out = process.env.FP_EVAL_OUT ?? 'test-results/llm-eval'
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'kb-stats.json'), JSON.stringify(stats, null, 2))
    // Full corpus (generated from the registries) for the citation / support review.
    writeFileSync(join(out, 'kb-corpus.json'), JSON.stringify(base.map((chunk) => ({ id: chunk.id, kind: chunk.kind, subject: chunk.subject, title: chunk.title, text: chunk.text, citations: chunk.citations })), null, 1))
    console.log(JSON.stringify({ ...stats, retrieval: undefined }))
    expect(base.length).toBeGreaterThan(0)
  })
})
