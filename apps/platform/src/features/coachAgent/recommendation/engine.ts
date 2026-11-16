import { COACH_KNOWLEDGE } from './catalogue'
import type { BodyRegion, CoachEvidence, CoachProfile, CoachQuestion, CoachRecommendation, CoachRecommendationResult, Focus, KnowledgeEntry, RecommendationContext } from './types'

export const FOCUS_LABELS: Record<Focus, string> = {
  reach: '舒适范围内的动作幅度', stability: '姿势与支撑稳定', coordination: '左右与手脚配合', rhythm: '动作节奏', general: '日常活动与流程熟悉',
}
const REGION_LABELS: Record<BodyRegion, string> = { shoulders: '肩部', neck: '颈部', arms: '上肢', trunk: '躯干', legs: '下肢' }
const GOAL_LABELS: Record<CoachProfile['goals'][number], string> = { mobility: '肩颈活动', upper_limb: '上肢功能练习', daily: '日常锻炼', rehab_support: '康复辅助意向（需先专业确认）' }
const DIFFICULTY_LABELS: Record<CoachProfile['difficulties'][number], string> = { stiffness: '僵硬感', reach_difficulty: '抬手困难', soreness: '酸痛', sedentary: '久坐不适', none: '暂无明显困难' }
const CATEGORIES = ['training', 'game', 'report', 'decision'] as const
const FOCUSES: Focus[] = ['reach', 'stability', 'coordination', 'rhythm', 'general']
const has = (values: readonly unknown[], value: unknown) => values.includes(value)
function selection(value: unknown, choices: readonly string[]): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= choices.length
    && new Set(value).size === value.length && value.every(item => typeof item === 'string' && choices.includes(item))
}

/** The profile is untrusted form input. Invalid or incomplete input never reaches ranking. */
export function validCoachProfile(value: unknown): value is CoachProfile {
  if (!value || typeof value !== 'object') return false
  const p = value as CoachProfile
  return p.version === 1 && p.acknowledged === true
    && selection(p.goals, Object.keys(GOAL_LABELS)) && selection(p.difficulties, Object.keys(DIFFICULTY_LABELS))
    && !(p.difficulties.includes('none') && p.difficulties.length > 1)
    && selection(p.regions, Object.keys(REGION_LABELS))
    && has(['routine', 'game', 'mixed'], p.preference) && has(['none', 'acute_pain', 'dizziness', 'recent_injury'], p.risk)
}

function profileFocus(profile: CoachProfile): Focus[] {
  const out: Focus[] = []
  if (profile.goals.includes('mobility') || profile.goals.includes('upper_limb')) out.push('reach', 'coordination')
  if (profile.difficulties.includes('reach_difficulty') || profile.difficulties.includes('soreness')) out.push('stability', 'coordination')
  if (profile.goals.includes('daily') || profile.difficulties.includes('sedentary')) out.push('general', 'rhythm')
  if (profile.goals.includes('rehab_support')) out.push('general', 'stability')
  return [...new Set(out.length ? out : ['general' as const])]
}

function directMatch(entry: KnowledgeEntry, item: CoachEvidence): boolean {
  return typeof item.contentId === 'string' && (item.contentId === entry.id || item.contentId === entry.programId || item.contentId === entry.chapterId)
}

/** No evidence-count voting: each lower-priority category contributes a bounded tie-breaker. */
function rank(entry: KnowledgeEntry, profile: CoachProfile, focuses: Focus[], evidence: CoachEvidence[]): number[] {
  const regionMatch = entry.regions.filter(region => profile.regions.includes(region)).length
  const focusMatch = entry.focuses.filter(focus => focuses.includes(focus)).length
  const profileScore = regionMatch * 10 + focusMatch
  return [profileScore, ...CATEGORIES.map(category => Math.max(0, ...evidence.filter(item => item.category === category).map(item =>
    directMatch(entry, item) ? 3
      : item.focuses.some(focus => entry.focuses.includes(focus)) ? 1 : 0)))]
}
function compareTuple(a: number[], b: number[]): number { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i]; return 0 }
function matchingEvidence(entry: KnowledgeEntry, evidence: CoachEvidence[]) {
  const matches = evidence.filter(item => directMatch(entry, item)
    || item.focuses.some(focus => entry.focuses.includes(focus)))
  return CATEGORIES.flatMap(category => matches.filter(item => item.category === category).slice(0, 2))
}
function usableEvidence(context: RecommendationContext): CoachEvidence[] {
  const seen = new Set<string>()
  const validated = (Array.isArray(context.evidence) ? context.evidence : []).filter(item => {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)
      || !has(CATEGORIES, item.category) || !has(['live', 'synthetic'], item.source)
      || typeof item.title !== 'string' || typeof item.detail !== 'string'
      || !Array.isArray(item.references) || !item.references.length || !item.references.every(ref => typeof ref === 'string' && ref.length > 0)
      || !Array.isArray(item.focuses) || !item.focuses.every(focus => has(FOCUSES, focus)) || !Number.isFinite(item.occurredAt)) return false
    seen.add(item.id); return true
  }).sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id))
  const limits = { training: 12, game: 4, report: 3, decision: 2 }
  return CATEGORIES.flatMap(category => validated.filter(item => item.category === category).slice(0, limits[category]))
}

export function recommendCoach(profile: unknown, context: RecommendationContext): CoachRecommendationResult {
  const empty = (status: CoachRecommendationResult['status'], message: string): CoachRecommendationResult => ({ status, message, routines: [], chapters: [], games: [], focus: [], evidence: [], limitations: [] })
  if (!validCoachProfile(profile)) return empty('profile_required', '请完整填写目标、困难、关注部位、偏好与风险信息，并确认风险提示。')
  if (profile.risk !== 'none') return empty('safety_hold', '你报告了急性疼痛、眩晕或近期损伤。本次暂停动作推荐，请先咨询医生或康复专业人员；本工具不提供诊断或替代医疗建议。')
  const evidence = usableEvidence(context)
  const profileDirections = profileFocus(profile)
  const focus = FOCUSES.filter(item => profileDirections.includes(item) || evidence.some(e => e.focuses.includes(item)))
    .map(item => ({ item, rank: [profileDirections.includes(item) ? 1 : 0, ...CATEGORIES.map(category => evidence.some(e => e.category === category && e.focuses.includes(item)) ? 1 : 0)] }))
    .sort((a, b) => compareTuple(a.rank, b.rank) || FOCUSES.indexOf(a.item) - FOCUSES.indexOf(b.item)).slice(0, 3).map(item => item.item)
  const limited = profile.difficulties.some(d => d === 'reach_difficulty' || d === 'soreness') || profile.goals.includes('rehab_support')
  const safe = (entry: KnowledgeEntry) => entry.verification === 'project_verified' && (!limited || entry.caution.length === 0)
  const chapterPool = COACH_KNOWLEDGE.filter(entry => entry.kind === 'chapter' && entry.href !== null && safe(entry))
  const eligiblePrograms = new Set(chapterPool.map(entry => entry.programId))
  const candidates = COACH_KNOWLEDGE.filter(entry => entry.kind === 'routine' ? eligiblePrograms.has(entry.programId) && entry.verification === 'project_verified' : entry.kind === 'chapter' ? chapterPool.includes(entry) : safe(entry))
  const sorted = candidates.map(entry => ({ entry, rank: rank(entry, profile, profileDirections, evidence) }))
    .sort((a, b) => compareTuple(a.rank, b.rank) || a.entry.id.localeCompare(b.entry.id))
  // Keep programme directions, visible chapters and their explanations consistent.
  const chapterOrder = sorted.filter(item => item.entry.kind === 'chapter')
  const allowedPrograms = [...new Set(chapterOrder.map(item => item.entry.programId))].slice(0, 2)
  const selectedChapters = chapterOrder.filter(item => allowedPrograms.includes(item.entry.programId)).slice(0, 3)
  const selectedPrograms = [...new Set(selectedChapters.map(item => item.entry.programId))]
  const make = (entry: KnowledgeEntry): CoachRecommendation => {
    const linked = matchingEvidence(entry, evidence)
    const regions = entry.regions.filter(region => profile.regions.includes(region)).map(region => REGION_LABELS[region])
    const reasons = [
      `画像规则：你选择了${profile.goals.map(goal => GOAL_LABELS[goal]).join('、')}，${profile.difficulties.map(item => DIFFICULTY_LABELS[item]).join('、')}；${regions.length ? `本条目包含${regions.join('、')}动作。` : '本条目作为补充活动选项。'}`,
      `动作依据：${entry.movement}。画像适配是工程建议，医学改善效果待核验。`,
      ...linked.map(item => `${item.source === 'synthetic' ? '合成样例' : item.category === 'decision' ? '受守卫的决策建议' : '本机记录'}：${item.title}（${item.id}）。`),
    ]
    if (entry.kind === 'routine') {
      const safeTitles = selectedChapters.filter(item => item.entry.programId === entry.programId).map(item => item.entry.title)
      reasons.push(`仅建议从可选章节「${safeTitles.join('、')}」开始了解；这不是整套训练处方，请使用下方章节入口。`)
    }
    return { entry: entry.kind === 'routine' ? { ...entry, href: null } : entry, reasons, evidenceIds: linked.map(item => item.id), basis: linked.some(item => item.source === 'live' && item.category !== 'decision') ? 'live_and_rules' : linked.some(item => item.source === 'synthetic') ? 'synthetic_and_rules' : 'profile_rules' }
  }
  const limitations = [...new Set([
    ...context.limitations,
    '不做诊断、不承诺医学疗效，不提供康复剂量；不把相似度、游戏得分或工程评分混成健康总分。',
    '未进行真人效果验证；下一阶段侧重点属于建议，不表示已确认的身体问题或进步。',
    ...(limited ? ['已按保守规则排除有过顶、平衡、转体、明显俯身或支撑负担标记的章节和游戏；无法保证个体适用性。'] : []),
    ...(profile.goals.includes('rehab_support') ? ['你选择了康复辅助意向，请先由医生或康复专业人员确认可练范围。'] : []),
    ...(evidence.some(item => item.source === 'synthetic') ? ['当前含 synthetic 合成样例；样例不能用于断言你的真实训练表现或模型已接入。'] : []),
    ...(context.decisionStatus === 'not_connected' ? ['StartLux 决策模型尚未接入；当前使用本地画像规则兜底。'] : []),
  ])]
  return {
    status: 'ready', message: `已根据画像生成三类候选。你的偏好为${{ routine: '功法优先', game: '游戏优先', mixed: '功法与游戏混合' }[profile.preference]}；请在舒适范围内选择，出现不适即停止。`,
    routines: selectedPrograms.flatMap(programId => sorted.filter(item => item.entry.kind === 'routine' && item.entry.programId === programId)).map(item => make(item.entry)),
    chapters: selectedChapters.map(item => make(item.entry)),
    games: sorted.filter(item => item.entry.kind === 'game').slice(0, 2).map(item => make(item.entry)),
    focus, evidence, limitations,
  }
}

/** A model can rank content without predicting a focus. Use that content's verified metadata for the display. */
export function recommendationFocus(result: CoachRecommendationResult): Focus[] {
  const focus = result.focus.length ? result.focus : (result.chapters[0] ?? result.games[0])?.entry.focuses ?? []
  return [...new Set(focus)].filter(item => FOCUSES.includes(item)).slice(0, 3)
}

export function answerCoachQuestion(question: CoachQuestion, result: CoachRecommendationResult): string {
  if (result.status !== 'ready') return result.message
  const firstChapter = result.chapters[0]
  const firstGame = result.games[0]
  if (question === 'suitable') return `${result.routines.length ? `可先了解${result.routines.map(item => item.entry.title).join('、')}。` : '当前没有安全可用的功法候选。'}${firstChapter ? `建议先查看章节「${firstChapter.entry.title}」，按舒适范围练习。` : '暂不建议具体章节。'}这是画像规则建议，不是医学处方。`
  // Independent apps can have a host-provided launcher even when the knowledge catalogue has no href.
  if (question === 'first_game') return firstGame ? `可先了解「${firstGame.entry.title}」：${firstGame.entry.movement}。${firstGame.reasons[0]}` : '当前没有通过风险筛选的游戏，暂不推荐强行开始。'
  if (question === 'recent_issues') {
    const reports = result.evidence.filter(item => item.category === 'report').slice(0, 3)
    return reports.length ? reports.map(item => `${item.source === 'synthetic' ? '合成报告样例（不代表你的表现）' : '最近本机报告分项'}：${item.title}。${item.detail} 引用：${item.id}。`).join('\n')
      : '证据不足：尚无可用于说明主要问题的有效报告分项。画像中的不适是你的自述，练过某动作也不能证明存在动作缺陷。'
  }
  if (question === 'why') return firstChapter ? `以「${firstChapter.entry.title}」为例：${firstChapter.reasons.join('\n')}知识来源：${firstChapter.entry.sources.join('；')}。` : '当前缺少可解释的章节候选，请先完善画像或咨询专业人员。'
  const focus = recommendationFocus(result)
  if (!focus.length) return '当前缺少可执行的训练重点，请完善画像后重新生成推荐。'
  const next = firstChapter ? `可先从章节「${firstChapter.entry.title}」开始，在舒适范围内练习；完成后结合新的训练记录调整。` : '请从本次推荐中选择适合的项目，在舒适范围内练习。'
  return `下一阶段可关注：${focus.map(item => FOCUS_LABELS[item]).join('、')}。${next}这是训练建议，不代表已测得疾病或疗效。`
}
