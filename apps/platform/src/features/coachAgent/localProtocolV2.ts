import { freezeCoachValue, type AnswerMode } from './provider.ts'

export type LocalInputProjection = 'structured' | 'question-scope'
export interface LocalPlanContext {
  protocol: 'coach-plan-v2'
  inputProjection: LocalInputProjection
  mode?: AnswerMode
  question?: string
  scope: { warmup: boolean; routine: boolean; historyLimit: number }
  remainingCalls: number
}
export interface LocalPlanCandidate {
  intent: AnswerMode
  tool: 'read_scoring_evidence' | 'read_history' | 'none'
  limit?: number
}

const MODES = ['explain', 'history', 'routine', 'insufficient'] as const
const MASK = '[已隐去]'
// A conservative privacy allowlist, not an intent classifier. Retained spans keep
// their original order/spelling. Unknown phrases are masked, so rare wording can
// lose meaning. No identity recognition or complete free-text anonymization is claimed.
const QUESTION_WORDS = [
  '八段锦', '八断锦', '深蹲', '深尊', '蹲起', '下蹲', '评分', '分数', '平分', '打分', '得分', '低分项', '扣分',
  // Finite spelling/ASR variants, not fuzzy matching or identity recognition.
  '伸敦', '申吨', '深墩', '八短今', '八锻紧', '最劲',
  '为什么', '为何', '怎么', '怎样', '怎么样', '咋样', '为啥', '哪里', '哪儿', '什么', '如何', '多少',
  '这次', '本次', '上次', '这回', '上回', '这组', '刚才', '最近', '最进', '之前', '前后', '过去', '现在',
  '历史', '趋势', '进步', '退步', '改善', '稳定', '比较', '相比', '有没有', '不高', '偏低', '这么', '那么',
  '跟练', '跟连', '跟得', '表现', '情况', '质量', '动作', '幅度', '原因', '问题', '解释', '说说', '讲讲',
  '看看', '一下', '看下', '想看', '示范', '相似', '对上', '完成', '整套', '这套', '练习', '训练', '视频',
  '忽略', '门禁', '伪造', '证据', '越权', '读取', '别人', '其他人', '权限', '全部', '上限', '来源',
  '改成', '真人', '报告', '满分', '请求', '编号', '回答', '告诉', '已经', '直接', '修改', '删除', '记录',
  '所有', '规则', '授权', '跳过', '绕过', '存储', '成绩', '假装', '冒充', '不管', '禁止', '允许',
  '不要', '也别', '别', '不问', '不改', '只看', '先', '再', '但是', '但', '也', '都', '问', '讲',
  '这趟', '拉胯', '唠唠', '合拍', '哪块儿', '掉链子', '更稳', '稳当', '咋个样', '说下', '讲下', '吧', '哇', '咋',
  '你好', '今天', '天气', '下雨', '治疗', '膝关节', '疾病',
  '我', '你', '帮', '请', '这', '那', '的', '是', '有', '没', '不', '高', '低', '好', '坏', '吗', '么', '呢',
  '了', '得', '只', '就', '能', '还', '行', '分', '点', '次', '几', '回', '比', '和', '跟', '给', '说',
  '看', '做', '呀', '呗', '啊', '练', '越', '差', '扣', '把', '并', '在', '到', '来', '会', '打', '可以', '还是',
].sort((a, b) => b.length - a.length)

// Latin terms must match a complete token. Do not extract "squat" or "gate"
// from an account name such as private_squat_42 or delegate.
const QUESTION_LATIN_WORDS = new Set([
  'gate', 'none', 'squat', 'baduanjin', 'explain', 'history', 'follow-along', 'improvement', 'only',
])
const ENGLISH_COUNTS: Readonly<Record<string, number>> = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
})

function adjacentCharacter(text: string, offset: number, before = false): string {
  if (before) {
    offset -= 1
    if (offset > 0 && /[\uDC00-\uDFFF]/u.test(text[offset]) && /[\uD800-\uDBFF]/u.test(text[offset - 1])) offset -= 1
  }
  const point = text.codePointAt(offset)
  return point === undefined ? '' : String.fromCodePoint(point)
}

function identifierNeighbor(value: string): boolean {
  return /[\p{L}\p{N}\p{M}_.$%+-]/u.test(value) && !/\p{Script=Han}/u.test(value)
}

/** Hide complete nested payloads, including quoted brackets; malformed input fails closed. */
function maskStructuredPayloads(text: string): string {
  let output = ''
  let offset = 0
  while (offset < text.length) {
    if (text.startsWith(MASK, offset)) { output += MASK; offset += MASK.length; continue }
    // A stray closer can belong to a malformed payload whose private prefix
    // was already scanned. Do not keep that prefix or guess its start boundary.
    if (text[offset] === ']' || text[offset] === '}') return MASK
    if (text[offset] !== '[' && text[offset] !== '{') { output += text[offset++]; continue }
    const stack: string[] = []
    let quote = ''
    let escaped = false
    let end = offset
    for (; end < text.length; end += 1) {
      const character = text[end]
      if (quote) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === quote) quote = ''
      } else if (character === '"' || character === "'") quote = character
      else if (character === '[' || character === '{') stack.push(character === '[' ? ']' : '}')
      else if (character === ']' || character === '}') {
        if (stack.pop() !== character) return output + MASK
        if (!stack.length) { end += 1; break }
      }
    }
    output += MASK
    offset = end
  }
  return output
}

function validQuestionCount(raw: string): boolean {
  // This is a finite lexical support range, not the caller's authorized history
  // limit. Unsupported counts stay masked; never clamp them into allowed reads.
  const number = raw.replace(/[０-９]/gu, value => String(value.charCodeAt(0) - 0xff10))
  if (/^(?:[1-9]|[1-5][0-9]|6[0-4])$/u.test(number)) return true
  if (Object.hasOwn(ENGLISH_COUNTS, number.toLowerCase())) return true
  if (/^[一二两三四五六七八九]$/u.test(number)) return true
  if (!/^(?:十[一二三四五六七八九]?|[二三四五六]十[一二三四五六七八九]?)$/u.test(number)) return false
  const [tens, units] = number.split('十')
  const digit = (value: string) => '一二三四五六七八九'.indexOf(value) + 1
  return (tens ? digit(tens) : 1) * 10 + (units ? digit(units) : 0) <= 64
}

/** Retain the whole count phrase, including its role; never expose bare numbers. */
function questionCountPhrase(text: string, offset: number): { text: string; length: number } | null {
  if (identifierNeighbor(adjacentCharacter(text, offset, true))) return null
  // A task count needs both its unit and an explicit request verb. Retain the
  // complete phrase after privacy masking; bare counts/units remain private.
  const tasks = /^([0-9０-９零〇一二两三四五六七八九十百千万负正点.+-]+|[a-z]+)\s*(?:件|项)\s*(?:都|只|先|再)(?:做|解释|比较)/iu.exec(text.slice(offset))
  if (tasks) {
    if (identifierNeighbor(adjacentCharacter(text, offset + tasks[0].length))) return null
    return { text: validQuestionCount(tasks[1]) ? tasks[0].replace(/\s+/gu, ' ') : MASK, length: tasks[0].length }
  }
  const match = /^(最近|最进|最劲|过去|只看|做了|做)\s*([0-9０-９零〇一二两三四五六七八九十百千万负正点.+-]+|[a-z]+)\s*(次|回|下)/iu.exec(text.slice(offset))
  if (!match) return null
  if (identifierNeighbor(adjacentCharacter(text, offset + match[0].length))) return null
  const roleValid = match[1] === '做' || match[1] === '做了' ? match[3] === '下' : match[3] !== '下'
  return { text: roleValid && validQuestionCount(match[2]) ? match[0].replace(/\s+/gu, ' ') : MASK, length: match[0].length }
}

export function minimizeCoachQuestion(question: string): string {
  if (typeof question !== 'string' || !question.trim() || question.length > 4096) throw new Error('INVALID_LOCAL_QUESTION')
  // Remove labelled identities and structured/raw payloads as whole spans before
  // retaining words. Otherwise a name or record could accidentally contain a domain word.
  const text = maskStructuredPayloads(question.normalize('NFC'))
    .replace(/(?:姓名|我叫|名字|用户名|昵称|称呼我|称呼|手机号|电话|邮箱|地址|住址|身份证|病历|账号|帐号|用户ID|sessionId|recordRef|evidenceId|requestId)\s*[:：=]?\s*[^，。！？!?;；\r\n]+/giu, MASK)
    .replace(/\b(?:name|nickname|username|account|phone|email|address)\s*[:：=]\s*[^，。！？!?;；\r\n]+/giu, MASK)
    // Spaces and Han characters are legal in filenames. Only a real delimiter
    // ends a path; do not recover a question by guessing a filename boundary.
    .replace(/(?:https?:\/\/|file:\/\/|[a-z]:[\\/]|(?:~|\.\.?)[\\/]|[\\/])[^，。！？!?;；\r\n]*/giu, MASK)
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+/gu, MASK)
    .replace(/[0-9][0-9+(). _-]{3,}[0-9]/gu, MASK)
  const pieces: string[] = []
  let offset = 0
  let masked = false
  while (offset < text.length) {
    if (text.startsWith(MASK, offset)) {
      if (!masked) pieces.push(MASK)
      masked = true; offset += MASK.length; continue
    }
    const count = questionCountPhrase(text, offset)
    if (count) {
      if (count.text !== MASK || !masked) pieces.push(count.text)
      masked = count.text === MASK; offset += count.length; continue
    }
    const latin = /^(?:[A-Za-z0-9_]|[.$%+-](?=[A-Za-z0-9_]))[A-Za-z0-9_.$%+-]*/u.exec(text.slice(offset))
    if (latin) {
      // Also reject a known ASCII suffix/prefix of a Unicode identifier. Han
      // boundaries still allow mixed questions such as "请explain本次squat".
      const wholeToken = !identifierNeighbor(adjacentCharacter(text, offset, true)) && !identifierNeighbor(adjacentCharacter(text, offset + latin[0].length))
      if (wholeToken && QUESTION_LATIN_WORDS.has(latin[0].toLowerCase())) { pieces.push(latin[0]); masked = false }
      else { if (!masked) pieces.push(MASK); masked = true }
      offset += latin[0].length; continue
    }
    const word = QUESTION_WORDS.find(item => text.startsWith(item, offset))
    const character = text[offset]
    if (word) { pieces.push(word); offset += word.length; masked = false }
    else if (/^[\s，。！？、；：,.!?;:=()（）“”「」]$/u.test(character)) {
      pieces.push(/\s/u.test(character) ? ' ' : character); offset += 1; masked = false
    } else {
      if (!masked) pieces.push(MASK)
      masked = true; offset += 1
    }
  }
  let bounded = ''
  for (const piece of pieces) {
    if (bounded.length + piece.length > 512) break
    bounded += piece
  }
  return bounded.replace(/ +/gu, ' ').trim() || MASK
}

function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('INVALID_LOCAL_PLAN')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || ![...required, ...optional].includes(key)
    || !('value' in descriptors[key]) || !descriptors[key].enumerable)
    || required.some(key => !Object.hasOwn(descriptors, key))) throw new Error('INVALID_LOCAL_PLAN')
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]))
}

export function parseLocalPlanContext(value: unknown): LocalPlanContext {
  const raw = fields(value, ['protocol', 'inputProjection', 'scope', 'remainingCalls'], ['question', 'mode'])
  const scope = fields(raw.scope, ['warmup', 'routine', 'historyLimit'])
  if (raw.protocol !== 'coach-plan-v2' || !['structured', 'question-scope'].includes(raw.inputProjection as string)
    || typeof scope.warmup !== 'boolean' || typeof scope.routine !== 'boolean'
    || !Number.isSafeInteger(scope.historyLimit) || (scope.historyLimit as number) < 1 || (scope.historyLimit as number) > 64
    || !Number.isSafeInteger(raw.remainingCalls) || (raw.remainingCalls as number) < 0 || (raw.remainingCalls as number) > 64) {
    throw new Error('INVALID_LOCAL_PLAN')
  }
  const projection = raw.inputProjection as LocalInputProjection
  if (projection === 'structured'
    ? Object.hasOwn(raw, 'question') || !MODES.includes(raw.mode as AnswerMode)
    : Object.hasOwn(raw, 'mode') || typeof raw.question !== 'string' || !raw.question.trim() || raw.question.length > 512
      || minimizeCoachQuestion(raw.question) !== raw.question) throw new Error('INVALID_LOCAL_PLAN')
  return freezeCoachValue({ protocol: 'coach-plan-v2', inputProjection: projection,
    ...(projection === 'structured' ? { mode: raw.mode as AnswerMode } : { question: raw.question as string }),
    scope: { warmup: scope.warmup, routine: scope.routine, historyLimit: scope.historyLimit as number },
    remainingCalls: raw.remainingCalls as number })
}

export const LOCAL_PLAN_SCHEMA = freezeCoachValue({
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['intent', 'tool'], properties: {
      intent: { enum: ['explain', 'routine'] }, tool: { const: 'read_scoring_evidence' },
    } },
    { type: 'object', additionalProperties: false, required: ['intent', 'tool', 'limit'], properties: {
      intent: { const: 'history' }, tool: { const: 'read_history' }, limit: { type: 'integer', minimum: 1, maximum: 64 },
    } },
    { type: 'object', additionalProperties: false, required: ['intent', 'tool'], properties: {
      intent: { const: 'insufficient' }, tool: { const: 'none' },
    } },
  ],
})

/** Syntax/schema checks do not authorize storage access. Dispatcher remains final authority. */
export function validateLocalPlanCandidate(value: unknown, context: LocalPlanContext): LocalPlanCandidate {
  const scope = parseLocalPlanContext(context)
  const raw = fields(value, ['intent', 'tool'], ['limit'])
  if (!MODES.includes(raw.intent as AnswerMode)) throw new Error('INVALID_LOCAL_PLAN')
  const intent = raw.intent as AnswerMode
  if (intent === 'insufficient') {
    if (raw.tool !== 'none' || Object.hasOwn(raw, 'limit')) throw new Error('INVALID_LOCAL_PLAN')
    return freezeCoachValue({ intent, tool: 'none' })
  }
  if (scope.remainingCalls < 1 || !(intent === 'routine' ? scope.scope.routine : scope.scope.warmup)
    || (scope.inputProjection === 'structured' && intent !== scope.mode)) throw new Error('INVALID_LOCAL_PLAN')
  if (intent === 'history') {
    if (raw.tool !== 'read_history' || !Number.isSafeInteger(raw.limit) || (raw.limit as number) < 1
      || (raw.limit as number) > scope.scope.historyLimit) throw new Error('INVALID_LOCAL_PLAN')
    return freezeCoachValue({ intent, tool: 'read_history', limit: raw.limit as number })
  }
  if (raw.tool !== 'read_scoring_evidence' || Object.hasOwn(raw, 'limit')) throw new Error('INVALID_LOCAL_PLAN')
  return freezeCoachValue({ intent, tool: 'read_scoring_evidence' })
}
