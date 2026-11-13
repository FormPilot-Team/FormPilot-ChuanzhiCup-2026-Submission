/**
 * V1.2 agent guard: deterministic checks before and after the model. The model is never the safety boundary.
 * - Input: acute-risk wording and requests to modify data get an immediate rule answer (no model call); medical and
 *   prompt-injection wording is flagged and still answered under the system rules.
 * - Output: the answer is rejected (→ rule fallback) for medical promises, diagnoses, claims of having changed data,
 *   numbers that appear in no tool result, or out-of-catalogue programmes in a recommendation; unknown citation
 *   markers are removed.
 */

export type GuardFlag = 'risk' | 'medical' | 'injection' | 'write_request'

const RISK = /(剧痛|很疼|疼得|痛得|刺痛|疼痛加重|越来越疼|头晕|眩晕|晕倒|要晕|恶心|胸闷|胸痛|心慌|心悸|喘不上|呼吸困难|扭伤|拉伤|摔倒|摔了|骨折|出血|麻木|抽筋)/u
const MEDICAL = /(治好|治愈|根治|治疗|疗效|诊断|确诊|病|药|手术|术后|康复|突出|关节炎|颈椎|腰椎|血压|糖尿病)/u
const INJECTION = /((忽略|无视|忘记|不要管).{0,8}(规则|指令|设定|提示|限制)|system\s*prompt|系统提示词?|你现在是|扮演|管理员|开发者模式|越狱|jailbreak|prompt|developer mode)/iu
const WRITE = /((修改|改成|改为|改一下|调高|调低|删除|删掉|清空|伪造|编造|篡改|写入).{0,10}(分数|评分|得分|成绩|记录|历史|报告|画像)|(分数|评分|得分|成绩|记录|历史).{0,6}(改成|改为|改到|删除|删掉|清空|调高))/u

export function classifyQuestion(text: string): { flags: GuardFlag[] } {
  const flags: GuardFlag[] = []
  if (RISK.test(text)) flags.push('risk')
  if (MEDICAL.test(text)) flags.push('medical')
  if (INJECTION.test(text)) flags.push('injection')
  if (WRITE.test(text)) flags.push('write_request')
  return { flags }
}

export const RISK_ANSWER = '先停下来。你描述的情况（疼痛、头晕、扭伤或不适）需要立即停止训练，坐下或躺下休息；如果症状持续、加重，或出现胸闷、呼吸困难，请尽快就医或联系医生、康复治疗师。\n在情况明确之前，我不会推荐任何训练。等身体恢复、医生同意后，可以回到 AI Coach 重新生成建议。'
export const WRITE_ANSWER = '我做不到。AI 教练只能读取你授权的训练记录和评分证据，不能修改、删除或伪造任何记录、评分、报告或画像；评分由摄像头识别和项目规则计算，任何对话都改变不了它。\n如果你觉得某次评分不准，可以在报告里展开“评分说明”查看依据，或者重新训练一次。'
export const MEDICAL_NOTICE = '以下是运动练习建议，不是医疗诊断或治疗方案；涉及疾病或康复时请先咨询医生或康复治疗师。'

export interface AnswerValidation {
  ok: boolean
  issues: string[]
  /** Answer with unknown citation markers removed. */
  text: string
}

const NEGATED = /(不|无法|不能|没有|没法|切勿|别|勿|并非|不会|不应|不可|不要)/u

function promiseHits(text: string): string[] {
  const issues: string[] = []
  for (const match of text.matchAll(/(治好|治愈|根治|保证.{0,4}(好|痊愈)|彻底消除)/gu)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 10), match.index ?? 0)
    if (!NEGATED.test(before) && !/[“"「]$/u.test(before)) issues.push(`MEDICAL_PROMISE:${match[0]}`)
  }
  if (/(诊断为|确诊为|你(患|得)了|属于.{0,6}(病|症))/u.test(text)) issues.push('DIAGNOSIS')
  return issues
}

const NON_CATALOGUE = /(六字诀|瑜伽|普拉提|太极剑|太极扇|马王堆导引术|十二段锦|大舞|导引养生功|广场舞|跑步|游泳|哑铃|健身房)/u

export interface ValidationContext {
  /** Concatenated tool contents of this turn (numbers in the answer must appear here or in the question). */
  toolText: string
  question: string
  citationRefs: string[]
  usedRecordTools: boolean
  usedRecommendation: boolean
  flags?: GuardFlag[]
}

/** Numbers that carry a claim: two or more digits, or a digit followed by 分/%/个百分点/次/秒. */
function claimNumbers(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(%|分|个百分点|次|秒)/gu)) found.add(match[1])
  for (const match of text.matchAll(/(?<![\d.])(\d{2,}(?:\.\d+)?)(?![\d.])/gu)) found.add(match[1])
  return [...found]
}

export function validateAnswer(answer: string, context: ValidationContext): AnswerValidation {
  const issues: string[] = []
  let text = answer.replace(/\*\*/gu, '').trim()
  if (!text) return { ok: false, issues: ['EMPTY'], text }
  issues.push(...promiseHits(text))
  if (/(已|已经)(帮你|为你)?(修改|改为|改成|删除|更新|调整|清空)(了)?.{0,8}(分|记录|评分|成绩|画像)/u.test(text)) issues.push('WRITE_CLAIM')
  // A prompt-injection question is never echoed back as if it were the system speaking.
  if (context.flags?.includes('injection')) {
    const echo = context.question.trim()
    if (echo.length >= 8) text = text.split(echo).join('').trim()
  }
  if (context.flags?.includes('medical')) {
    for (const match of text.matchAll(/(缓解|改善|治疗|修复|恢复|减轻).{0,4}(症状|病情|突出|炎症|疼痛|病)/gu)) {
      const before = text.slice(Math.max(0, (match.index ?? 0) - 10), match.index ?? 0)
      if (!NEGATED.test(before)) issues.push(`MEDICAL_EFFICACY:${match[0]}`)
    }
  }
  if ((context.usedRecommendation || context.flags?.includes('injection')) && NON_CATALOGUE.test(text)
    && !/(不包含|没有|不在|无法推荐|不能推荐|未包含|不提供)/u.test(text)) issues.push('OUT_OF_CATALOGUE')
  if (context.usedRecordTools || context.usedRecommendation) {
    const grounded = `${context.toolText} ${context.question} 100 0`
    const ungrounded = claimNumbers(text).filter((value) => !grounded.includes(value))
    if (ungrounded.length) issues.push(`UNGROUNDED_NUMBER:${ungrounded.slice(0, 3).join(',')}`)
  }
  // Unknown citation markers are removed (a soft fix); they never count as evidence.
  const refs = new Set(context.citationRefs)
  text = text.replace(/\[(K\d+)\]/gu, (marker, ref: string) => (refs.has(ref) ? marker : ''))
  // Invented reference markers (「[规则1]」「[原因1]」「[动作依据2]」「[R1]」「[来源]」) look like evidence but are not: strip them.
  text = text.replace(/\[(?!K\d+\])[^\]\n]{0,10}\]/gu, (marker) => (/\d\]$/u.test(marker) || /(规则|工具|来源|依据|资料|证据|引用|参考)/u.test(marker) ? '' : marker))
  if (/\[K\d+\]/u.test(answer) && !refs.size) issues.push('CITATION_WITHOUT_RETRIEVAL')
  const hard = issues.filter((issue) => !issue.startsWith('CITATION_WITHOUT_RETRIEVAL'))
  return { ok: hard.length === 0, issues, text }
}
