import { describe, expect, it } from 'vitest'
import { buildKnowledgeBase } from '../src/features/coachLlm/knowledge'
import { knowledgeChunkCount, linkEntities, normalizeQuery, retrieveKnowledge, tokenize } from '../src/features/coachLlm/retrieval'

describe('FormPilot knowledge base (V1.2 RAG)', () => {
  it('is generated from the registries, with a citation on every chunk', () => {
    const base = buildKnowledgeBase()
    expect(base.length).toBeGreaterThan(150)
    expect(new Set(base.map((chunk) => chunk.id)).size).toBe(base.length)
    for (const chunk of base) expect(chunk.citations.length, chunk.id).toBeGreaterThan(0)
    const bdj2 = base.filter((chunk) => chunk.subject === 'bdj-2' && chunk.kind === 'criterion')
    expect(bdj2.length).toBeGreaterThan(0)
    expect(bdj2[0].citations[0].label).toContain('八段锦')
  })

  it('normalizes numerals and tokenizes Chinese into unigrams and bigrams', () => {
    expect(normalizeQuery('八段锦第2式')).toBe('八段锦第二式')
    expect(tokenize('开弓')).toEqual(['开', '开弓', '弓'])
  })

  it('links routine and chapter names, including 第N式 inside a routine', () => {
    const linked = linkEntities('八段锦第二式怎么做')
    expect([...linked.topics]).toContain('baduanjin')
    expect([...linked.subjects]).toContain('bdj-2')
    expect([...linkEntities('左右开弓似射雕的常见错误').subjects]).toContain('bdj-2')
  })

  it('retrieves the named chapter first', () => {
    const result = retrieveKnowledge('八段锦左右开弓似射雕有哪些常见错误')
    expect(result.status).toBe('ok')
    expect(result.hits[0].chunk.subject).toBe('bdj-2')
    expect(result.hits.length).toBeLessThanOrEqual(6)
    expect(result.elapsedMs).toBeLessThan(50)
  })

  it('answers insufficient instead of returning weak matches', () => {
    expect(retrieveKnowledge('明天上海的天气怎么样').status).toBe('insufficient')
    expect(retrieveKnowledge('如何用 Python 写排序算法').status).toBe('insufficient')
  })

  it('finds safety guidance for medical questions', () => {
    const result = retrieveKnowledge('练八段锦能治好腰椎间盘突出吗')
    expect(result.hits.some((hit) => hit.chunk.id === 'safety:not-medical')).toBe(true)
  })

  it('has a stable corpus size', () => {
    expect(knowledgeChunkCount()).toBe(buildKnowledgeBase().length)
  })
})
