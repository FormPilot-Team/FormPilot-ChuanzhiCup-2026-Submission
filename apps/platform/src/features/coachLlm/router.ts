import type { KnowledgeTopic } from './knowledge'
import type { AgentToolCall } from './protocol'
import { linkEntities } from './retrieval'

/**
 * Deterministic intent router: the grounding guarantee of the V1.2 agent. The model chooses tools first; when it tries
 * to answer a question of a known intent without having called the matching tool, the agent runs the routed tool
 * itself and asks the model again (visible in the trace as 由意图路由补充). Measured reason (agent-eval run 1): the 4B
 * model answered 7 of 26 knowledge/recommendation questions from memory, several of them wrongly.
 */

const RECORD_LAST = /(上一次|上次|最近一次|刚才|这次).{0,12}(练|训练|跟练|表现|得分|评分|怎么样|如何)|(练得|表现|做得)怎么样|主要问题|哪.{0,3}(最弱|最差|不好)/u
const PROGRESS = /(进步|退步|提升|提高|变化|比较|对比|趋势|比上次|有没有变好)/u
const RECOMMEND = /(练什么|推荐|适合.{0,6}(练|功法|游戏|动作)|该练|先练|下一步|计划|安排)/u
const CATALOG = /(有哪些|有什么|几个|多少).{0,6}(功法|章节|游戏|动作|内容|课程)|一共有几/u
const KNOWLEDGE = /(要领|要求|要点|注意|错误|纠正|怎么做|如何做|做法|动作|标准|依据|来源|呼吸|意思|是什么|检查|识别|姿势|手型|步型|马步|膝|肘|肩|腰|呼吸)/u
const ROUTINE_WORDS = /(功法|跟练|八段锦|太极|五禽|易筋|式|势)/u

export interface RoutedIntent {
  intents: Array<'record_last' | 'progress' | 'recommend' | 'catalog' | 'knowledge'>
  calls: AgentToolCall[]
}

export function routeQuestion(question: string): RoutedIntent {
  const intents: RoutedIntent['intents'] = []
  const calls: AgentToolCall[] = []
  const kind = ROUTINE_WORDS.test(question) ? 'routine' : 'warmup'
  const linked = linkEntities(question)
  if (PROGRESS.test(question) && /(我|最近|近期)/u.test(question)) {
    intents.push('progress')
    calls.push({ name: 'compare_recent_training', arguments: { kind } })
  } else if (RECORD_LAST.test(question) && /(我|上次|上一次)/u.test(question)) {
    intents.push('record_last')
    calls.push({ name: 'read_last_training', arguments: { kind } })
  }
  if (RECOMMEND.test(question) && !intents.length) {
    intents.push('recommend')
    calls.push({ name: 'recommend_training', arguments: {} })
  }
  if (CATALOG.test(question) && !linked.subjects.size) {
    intents.push('catalog')
    calls.push({ name: 'get_catalog', arguments: { kind: 'all' } })
  }
  const named = linked.topics.size > 0 || linked.subjects.size > 0
  if ((named || KNOWLEDGE.test(question)) && !intents.includes('record_last') && !intents.includes('progress') && !intents.includes('recommend')) {
    intents.push('knowledge')
    const topics = [...linked.topics] as KnowledgeTopic[]
    calls.push({ name: 'search_knowledge', arguments: { query: question.slice(0, 120), topic: topics.length === 1 ? topics[0] : 'any' } })
  }
  return { intents, calls }
}

/** Resolve a follow-up ("第二个动作…") against the previous question so retrieval sees the subject. */
export function contextualQuery(question: string, history: ReadonlyArray<{ question: string; answer: string }>): string {
  if (!history.length) return question
  const linked = linkEntities(question)
  if (linked.topics.size || linked.subjects.size) return question
  const previous = history[history.length - 1]
  return `${previous.question} ${previous.answer.slice(0, 80)} ${question}`
}
