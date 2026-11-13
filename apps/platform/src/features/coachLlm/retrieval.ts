import { exerciseRegistry } from '../exercises/registry'
import { ROUTINE_PROGRAMS } from '../routines/programs'
import { buildKnowledgeBase, type KnowledgeChunk, type KnowledgeTopic } from './knowledge'

/**
 * Lexical retrieval for the FormPilot knowledge base: BM25 over Chinese unigrams + bigrams (and latin words), with
 * title/keyword field weights and entity linking for routine, chapter and exercise names. The corpus is a few hundred
 * short chunks, so an in-memory inverted index answers in well under a millisecond and needs no vector database,
 * embedding model or network. Retrieval says "insufficient" instead of returning weak matches.
 */

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

/** 第2式 / 第 2 势 → 第二式, so numerals and Chinese numbers retrieve the same chapter. */
export function normalizeQuery(text: string): string {
  return text
    .replace(/[！-～]/gu, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/第\s*(\d{1,2})\s*(式|势|动|戏)/gu, (_, n: string, unit: string) => `第${CN_DIGITS[Number(n)] ?? n}${unit}`)
    .toLowerCase()
}

const CJK = /[㐀-鿿]/u

export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const normalized = normalizeQuery(text)
  for (const run of normalized.match(/[㐀-鿿]+|[a-z0-9]+/gu) ?? []) {
    if (CJK.test(run)) {
      for (let i = 0; i < run.length; i += 1) {
        tokens.push(run[i])
        if (i + 1 < run.length) tokens.push(run.slice(i, i + 2))
      }
    } else tokens.push(run)
  }
  return tokens
}

/** Single characters that carry almost no meaning in these questions. */
const STOP = new Set(['的', '了', '是', '在', '和', '有', '我', '你', '吗', '呢', '么', '什', '怎', '样', '要', '做', '时', '个', '这', '那', '一', '中', '上', '下', '不', '会', '能', '该', '哪', '些'])

interface Entity { kind: 'topic' | 'subject'; value: string; topic: KnowledgeTopic; names: string[] }

function entities(): Entity[] {
  const list: Entity[] = []
  for (const program of ROUTINE_PROGRAMS) {
    list.push({ kind: 'topic', value: program.id, topic: program.id, names: [program.title] })
    for (const chapter of program.chapters) {
      const names = [chapter.name]
      // A short distinctive phrase of the name, e.g. 左右开弓 for 左右开弓似射雕.
      if (chapter.name.length >= 6) names.push(chapter.name.slice(0, 4))
      list.push({ kind: 'subject', value: chapter.id, topic: program.id, names })
      list.push({ kind: 'subject', value: chapter.id, topic: program.id, names: [`${program.title}${chapter.label}`] })
    }
  }
  for (const definition of exerciseRegistry.values()) list.push({ kind: 'subject', value: definition.id, topic: 'warmup', names: [definition.displayName] })
  list.push({ kind: 'topic', value: 'warmup', topic: 'warmup', names: ['热身'] })
  return list
}

export interface LinkedEntities { topics: Set<KnowledgeTopic>; subjects: Set<string> }

export function linkEntities(query: string): LinkedEntities {
  const text = normalizeQuery(query).replace(/\s+/gu, '')
  const topics = new Set<KnowledgeTopic>()
  const subjects = new Set<string>()
  for (const entity of entities()) {
    if (entity.names.some((name) => name && text.includes(name.toLowerCase()))) {
      topics.add(entity.topic)
      if (entity.kind === 'subject') subjects.add(entity.value)
    }
  }
  // 第二式 alone is ambiguous across routines; resolve it only inside a mentioned routine.
  for (const program of ROUTINE_PROGRAMS) {
    if (!topics.has(program.id)) continue
    for (const chapter of program.chapters) if (text.includes(chapter.label)) subjects.add(chapter.id)
  }
  return { topics, subjects }
}

interface Posting { doc: number; tf: number }

const FIELD_WEIGHTS = { title: 2, keywords: 2.5, text: 1 } as const
const K1 = 1.2
const B = 0.75

class Bm25Index {
  readonly docs: ReadonlyArray<KnowledgeChunk>
  private readonly postings = new Map<string, Posting[]>()
  private readonly lengths: number[] = []
  private readonly avgLength: number

  constructor(docs: ReadonlyArray<KnowledgeChunk>) {
    this.docs = docs
    docs.forEach((doc, index) => {
      const counts = new Map<string, number>()
      let length = 0
      for (const [field, weight] of Object.entries(FIELD_WEIGHTS) as Array<[keyof typeof FIELD_WEIGHTS, number]>) {
        const value = field === 'keywords' ? doc.keywords.join(' ') : doc[field]
        for (const token of tokenize(value)) {
          if (token.length === 1 && STOP.has(token)) continue
          counts.set(token, (counts.get(token) ?? 0) + weight)
          length += weight
        }
      }
      this.lengths.push(length)
      for (const [token, tf] of counts) {
        const list = this.postings.get(token) ?? []
        list.push({ doc: index, tf })
        this.postings.set(token, list)
      }
    })
    this.avgLength = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, this.lengths.length)
  }

  score(query: string): Map<number, { score: number; matched: Set<string> }> {
    const result = new Map<number, { score: number; matched: Set<string> }>()
    const n = this.docs.length
    for (const token of new Set(tokenize(query))) {
      if (token.length === 1 && STOP.has(token)) continue
      const list = this.postings.get(token)
      if (!list) continue
      const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5))
      // Bigrams carry the meaning in Chinese; single characters only help ranking.
      const tokenWeight = token.length >= 2 ? 1 : 0.35
      for (const { doc, tf } of list) {
        const norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * this.lengths[doc] / this.avgLength))
        const entry = result.get(doc) ?? { score: 0, matched: new Set<string>() }
        entry.score += idf * norm * tokenWeight
        if (token.length >= 2) entry.matched.add(token)
        result.set(doc, entry)
      }
    }
    return result
  }
}

let index: Bm25Index | null = null
function getIndex(): Bm25Index {
  if (!index) index = new Bm25Index(buildKnowledgeBase())
  return index
}

export interface RetrievalHit {
  chunk: KnowledgeChunk
  score: number
  matchedTerms: string[]
}

export interface RetrievalResult {
  status: 'ok' | 'insufficient'
  hits: RetrievalHit[]
  linked: { topics: string[]; subjects: string[] }
  elapsedMs: number
}

/** Medical or risk wording always brings the matching product safety rule into the results. */
const SAFETY_TRIGGERS: ReadonlyArray<[RegExp, string]> = [
  [/(治好|治愈|根治|治疗|疗效|康复|诊断|病|突出|炎|手术|术后|药)/u, 'safety:not-medical'],
  [/(疼|痛|眩晕|头晕|晕|受伤|损伤|扭伤|不舒服|难受)/u, 'safety:stop'],
]

export const RETRIEVAL_CONFIG = Object.freeze({ topK: 6, minScore: 4.5, minMatchedBigrams: 2, subjectBoost: 1.8, topicBoost: 1.25, offTopicPenalty: 0.35 })

export function retrieveKnowledge(query: string, options: { topic?: KnowledgeTopic | 'any'; topK?: number } = {}): RetrievalResult {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const idx = getIndex()
  const linked = linkEntities(query)
  if (options.topic && options.topic !== 'any') linked.topics.add(options.topic)
  const scored = [...idx.score(query)].map(([doc, entry]) => {
    const chunk = idx.docs[doc]
    let score = entry.score
    if (chunk.subject && linked.subjects.has(chunk.subject)) score *= RETRIEVAL_CONFIG.subjectBoost
    if (linked.topics.size) {
      if (linked.topics.has(chunk.topic)) score *= RETRIEVAL_CONFIG.topicBoost
      else if (chunk.topic !== 'general') score *= RETRIEVAL_CONFIG.offTopicPenalty
    }
    // A named chapter/exercise: other chapters of the same routine drop below it.
    if (linked.subjects.size && chunk.subject && !linked.subjects.has(chunk.subject) && chunk.kind !== 'routine') score *= 0.6
    return { chunk, score, matchedTerms: [...entry.matched] }
  }).sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
  const top = scored[0]
  const enough = !!top && top.score >= RETRIEVAL_CONFIG.minScore && top.matchedTerms.length >= RETRIEVAL_CONFIG.minMatchedBigrams
  const topK = options.topK ?? RETRIEVAL_CONFIG.topK
  const hits = enough ? scored.filter((hit) => hit.score >= top.score * 0.35).slice(0, topK) : []
  for (const [pattern, id] of SAFETY_TRIGGERS) {
    if (!pattern.test(query) || hits.some((hit) => hit.chunk.id === id)) continue
    const chunk = idx.docs.find((doc) => doc.id === id)
    if (chunk) hits.push({ chunk, score: 0, matchedTerms: ['safety-rule'] })
  }
  const ended = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return {
    status: hits.length ? 'ok' : 'insufficient',
    hits: hits.map((hit) => ({ ...hit, score: Math.round(hit.score * 100) / 100 })),
    linked: { topics: [...linked.topics], subjects: [...linked.subjects] },
    elapsedMs: Math.round((ended - started) * 100) / 100,
  }
}

export function knowledgeChunkCount(): number {
  return getIndex().docs.length
}
