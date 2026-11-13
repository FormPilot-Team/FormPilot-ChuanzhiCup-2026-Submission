import { exerciseRegistry } from '../exercises/registry'
import type { ExerciseId } from '../exercises/types'
import { ROUTINE_PROGRAMS } from '../routines/programs'
import { chapterDisplayName, formatClock } from '../routines/scope'
import type { RoutineId } from '../routines/types'
import { CRITERIA } from '../scoring/criteria'
import { SCORING_SOURCES, findScoringSource } from '../scoring/sources'
import type { EvaluationCriterion, ScoringSource, SourceVerification } from '../scoring/types'

/**
 * FormPilot knowledge base for the V1.2 agent (RAG). Every chunk is generated from the product's own registries at
 * runtime, so the text, the numbers and the citations are exactly what the scoring code and the course pages use:
 * - Scoring v2 criteria: paraphrased movement requirements bound to a registered source, the deduction reason, the
 *   correction cue, what the camera can and cannot check, and limitations;
 * - the scoring source registry itself (title, publisher, verification status, what it is used for);
 * - course chapters (cue and length) and warm-up exercise guidance;
 * - the product's safety rules.
 * Nothing is scraped, invented or written by a model. Sources still PENDING verification are labelled as such.
 */

export type KnowledgeTopic = RoutineId | 'warmup' | 'general'

export interface KnowledgeCitation {
  /** Registered source id, or a FormPilot-internal source key. */
  sourceId: string
  label: string
  organization: string | null
  verification: SourceVerification | 'FORMPILOT_RULE'
  url: string | null
}

export interface KnowledgeChunk {
  id: string
  kind: 'criterion' | 'chapter' | 'routine' | 'exercise' | 'source' | 'safety'
  topic: KnowledgeTopic
  /** Chapter id (routines) or exercise id (warm-up); null for general chunks. */
  subject: string | null
  title: string
  text: string
  /** Extra retrieval terms: display names, labels, aliases. Not shown as content. */
  keywords: string[]
  citations: KnowledgeCitation[]
}

export const VERIFICATION_LABEL: Readonly<Record<KnowledgeCitation['verification'], string>> = Object.freeze({
  VERIFIED_FULL_TEXT: '已核对原文',
  VERIFIED_METADATA: '已核对发布信息，未读全文',
  SECONDARY_ONLY: '仅二手来源',
  PENDING: '来源待核实',
  FORMPILOT_RULE: 'FormPilot 产品规则',
})

const RULE_CITATIONS = {
  course: { sourceId: 'formpilot-course-catalogue', label: 'FormPilot 课程目录（章节时间与要领据标准示范视频字幕整理）', organization: 'FormPilot', verification: 'FORMPILOT_RULE', url: null },
  warmup: { sourceId: 'formpilot-warmup-rules', label: 'FormPilot 热身动作识别规则（exercise-rules-v1.0）', organization: 'FormPilot', verification: 'FORMPILOT_RULE', url: null },
  safety: { sourceId: 'formpilot-safety', label: 'FormPilot 训练安全提示', organization: 'FormPilot', verification: 'FORMPILOT_RULE', url: null },
  scoring: { sourceId: 'formpilot-scoring-v2', label: 'FormPilot 评分说明（scoring-v2.1，阈值为工程标定，非官方数值）', organization: 'FormPilot', verification: 'FORMPILOT_RULE', url: null },
} as const satisfies Record<string, KnowledgeCitation>

function citationOf(source: ScoringSource): KnowledgeCitation {
  return { sourceId: source.id, label: source.title, organization: source.organization, verification: source.verification, url: source.url }
}

const OBSERVABILITY_TEXT = { OBSERVABLE: '摄像头可直接观察', PROXY: '摄像头只能间接估计', NOT_OBSERVABLE: '摄像头无法观察' } as const
const ROLE_TEXT = { SCORED: '计入动作规范分', ADVISORY: '只作提醒，不计分', REFERENCE_ONLY: '仅作动作要求参考，不测量' } as const

function subjectName(criterion: EvaluationCriterion): { topic: KnowledgeTopic; name: string; keywords: string[] } {
  if (criterion.mode === 'warm-up') {
    const definition = exerciseRegistry.get(criterion.exercise as ExerciseId)
    const name = definition?.displayName ?? criterion.exercise
    return { topic: 'warmup', name: `热身 · ${name}`, keywords: [name, '热身'] }
  }
  const program = ROUTINE_PROGRAMS.find((item) => item.id === criterion.mode)!
  if (criterion.exercise === '*') return { topic: program.id, name: `${program.title} · 全套`, keywords: [program.title] }
  const chapter = program.chapters.find((item) => item.id === criterion.exercise)
  const label = chapter ? chapterDisplayName(chapter) : criterion.exercise
  return { topic: program.id, name: `${program.title} · ${label}`, keywords: [program.title, ...(chapter ? [chapter.label, chapter.name] : [])] }
}

function criterionChunk(criterion: EvaluationCriterion): KnowledgeChunk {
  const subject = subjectName(criterion)
  const lines = [`动作要求：${criterion.requirement}`]
  if (criterion.observable !== 'NOT_OBSERVABLE') {
    lines.push(`常见问题：${criterion.feedback.issue}`, `纠正提示：${criterion.feedback.cue}`)
    lines.push(`摄像头检查：${criterion.description}（${OBSERVABILITY_TEXT[criterion.observable]}；${ROLE_TEXT[criterion.scoring]}）`)
  } else {
    lines.push(`摄像头无法检查这一项（${criterion.description}），需要自己体会或请教练观察。`)
  }
  if (criterion.limitations.length) lines.push(`识别局限：${criterion.limitations.join('；')}`)
  const primary = findScoringSource(criterion.sourceId)
  const extra = criterion.additionalSourceIds.map(findScoringSource).filter((item): item is ScoringSource => !!item)
  return {
    id: `crit:${criterion.id}`,
    kind: 'criterion',
    topic: subject.topic,
    subject: criterion.mode === 'warm-up' ? criterion.exercise : criterion.exercise === '*' ? null : criterion.exercise,
    title: `${subject.name} · ${criterion.name}`,
    text: lines.join('\n'),
    keywords: [...subject.keywords, criterion.name, criterion.phase ?? ''].filter(Boolean),
    citations: [...(primary ? [citationOf(primary)] : []), ...extra.map(citationOf)],
  }
}

function routineChunks(): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = []
  for (const program of ROUTINE_PROGRAMS) {
    chunks.push({
      id: `routine:${program.id}`,
      kind: 'routine',
      topic: program.id,
      subject: null,
      title: `${program.title} · 课程概况`,
      text: `${program.description}\n全套时长 ${formatClock(program.video.durationSeconds)}，共 ${program.chapters.length} 段：${program.chapters.map(chapterDisplayName).join('、')}。`,
      keywords: [program.title, program.subtitle, '有哪些', '章节', '组成'],
      citations: [RULE_CITATIONS.course],
    })
    for (const chapter of program.chapters) {
      chunks.push({
        id: `chapter:${program.id}:${chapter.id}`,
        kind: 'chapter',
        topic: program.id,
        subject: chapter.id,
        title: `${program.title} · ${chapterDisplayName(chapter)}`,
        text: `要领：${chapter.cue}\n本段在标准示范视频中约 ${formatClock(chapter.endSeconds - chapter.startSeconds)}。`,
        keywords: [program.title, chapter.label, chapter.name],
        citations: [RULE_CITATIONS.course],
      })
    }
  }
  return chunks
}

function exerciseChunks(): KnowledgeChunk[] {
  return [...exerciseRegistry.values()].map((definition) => {
    const p = definition.presentation
    const phases = Object.values(p.phaseLabels).filter(Boolean).join(' → ')
    return {
      id: `exercise:${definition.id}`,
      kind: 'exercise',
      topic: 'warmup',
      subject: definition.id,
      title: `热身 · ${definition.displayName}`,
      text: [`动作要领：${p.guidance}`, `练习建议：${p.adviceFallback}`, `动作阶段：${phases}`, `阶段提示：${p.phaseHint}`, `准备姿势：${p.coach.preparationText}`].join('\n'),
      keywords: [definition.displayName, p.subtitle, '热身'],
      citations: [RULE_CITATIONS.warmup],
    }
  })
}

function sourceChunks(): KnowledgeChunk[] {
  return SCORING_SOURCES.map((source) => ({
    id: `source:${source.id}`,
    kind: 'source',
    topic: 'general',
    subject: null,
    title: `来源 · ${source.title}`,
    text: [`${source.organization}${source.published ? `，${source.published}` : ''}${source.identifier ? `，${source.identifier}` : ''}。`,
      `在 FormPilot 中的用途：${source.usedFor}`, `核实状态：${VERIFICATION_LABEL[source.verification]}。`].join('\n'),
    keywords: [source.title, source.organization, '来源', '依据', '标准'],
    citations: [citationOf(source)],
  }))
}

/** Product safety rules, worded as on the AI Coach profile page and the scoring basis. */
const SAFETY_TEXTS: ReadonlyArray<[string, string, string[]]> = [
  ['safety:stop', '出现疼痛加重、眩晕、近期受伤或术后情况：请停止训练并咨询医生或康复治疗师。AI Coach 在画像中出现这些风险时会暂停推荐，不展示任何功法、章节或游戏。', ['疼痛', '眩晕', '受伤', '术后', '头晕', '安全']],
  ['safety:not-medical', 'FormPilot 提供的是运动练习建议，不是诊断或治疗方案。康复辅助内容需要医生或治疗师确认；传统章节名称（例如“理三焦”“去心火”）不代表医学疗效。', ['治疗', '治好', '疗效', '诊断', '康复', '医学']],
  ['safety:comfort', '训练时在舒适范围内完成动作；马步、下蹲、转体和平衡类动作量力而行，可以减小幅度或扶稳。', ['马步', '下蹲', '平衡', '量力', '幅度']],
  ['safety:scores', '评分来自摄像头二维姿态识别和项目规则：跟练相似度衡量与示范的姿态接近程度，不等于动作规范评分；模型的“适配度”只在本次候选内比较，不是医学概率。', ['评分', '相似度', '适配度', '概率', '准确']],
]

function safetyChunks(): KnowledgeChunk[] {
  return SAFETY_TEXTS.map(([id, text, keywords]) => ({
    id, kind: 'safety', topic: 'general', subject: null, title: `安全提示 · ${keywords[0]}`, text, keywords,
    citations: [id === 'safety:scores' ? RULE_CITATIONS.scoring : RULE_CITATIONS.safety],
  }))
}

let cached: ReadonlyArray<KnowledgeChunk> | null = null

export function buildKnowledgeBase(): ReadonlyArray<KnowledgeChunk> {
  if (!cached) cached = Object.freeze([...CRITERIA.map(criterionChunk), ...routineChunks(), ...exerciseChunks(), ...sourceChunks(), ...safetyChunks()])
  return cached
}
