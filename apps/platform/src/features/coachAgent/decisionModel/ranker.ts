import { answerCoachQuestion, FOCUS_LABELS } from '../recommendation/engine'
import type { BodyRegion, CoachEvidence, CoachProfile, CoachRecommendation, CoachRecommendationResult, Focus, KnowledgeEntry } from '../recommendation/types'
import { DESCRIPTOR_META, DESCRIPTOR_USAGE, MOTION_DESCRIPTORS, sourceRef, type ChapterDescriptor } from './descriptors'
import { DECISION_MODEL_ID, DECISION_MODEL_VERSION, type CoverageGap, type DecisionModelOutput, type DecisionSlateItem, type FeatureContribution, type RankerInput } from './types'

/**
 * fp-coach-ranker v1: a deterministic, constrained, interpretable utility ranker.
 * Weights are documented engineering choices (no trained parameters): there are no independent
 * expert or outcome labels for profile -> content ranking, so fitting weights would only imitate
 * rules or author rubrics. Every score is the sum of the listed contributions.
 */
export const RANKER_WEIGHTS = Object.freeze({
  regionRelevance: 3.0,
  focusAlignment: 1.5,
  measuredInvolvement: 1.0,
  loadWithDifficulty: 0.6,
  loadWithoutDifficulty: 0.3,
  evidenceCap: 0.6,
  coverageGain: 1.2,
  diversityPenalty: 0.6,
})
export const SLATE_LIMITS = Object.freeze({ programmes: 2, chapters: 3, games: 2 })

/** Profile -> training-direction needs. Engineering mapping v1, pending domain review; not a prescription. */
const GOAL_NEEDS: Record<CoachProfile['goals'][number], Partial<Record<Focus, number>>> = {
  mobility: { reach: 1.0, general: 0.3 },
  upper_limb: { coordination: 1.0, reach: 0.5, stability: 0.5 },
  daily: { general: 1.0, rhythm: 0.6 },
  rehab_support: { stability: 1.0, general: 0.6 },
}
const DIFFICULTY_NEEDS: Record<CoachProfile['difficulties'][number], Partial<Record<Focus, number>>> = {
  stiffness: { reach: 0.6, rhythm: 0.4 },
  reach_difficulty: { stability: 0.8, coordination: 0.5 },
  soreness: { stability: 0.8, general: 0.4 },
  sedentary: { general: 0.8, rhythm: 0.6 },
  none: {},
}
const EVIDENCE_WEIGHTS: Record<CoachEvidence['category'], number> = { training: 0.3, game: 0.25, report: 0.2, decision: 0.1 }
const FOCUSES: Focus[] = ['reach', 'stability', 'coordination', 'rhythm', 'general']
const REGION_LABELS: Record<BodyRegion, string> = { shoulders: '肩部', neck: '颈部', arms: '上肢', trunk: '躯干', legs: '下肢' }
const CAUTION_LABELS: Record<KnowledgeEntry['caution'][number], string> = { overhead: '过顶', balance: '平衡', twist: '转体', bending: '俯身', weight_bearing: '支撑负荷' }
const CATALOGUE_SOURCE = 'apps/platform/src/features/coachAgent/recommendation/catalogue.ts#COACH_KNOWLEDGE'

/** Same predicate as the P0 engine (recommendation/engine.ts); parity is tested. */
export function isLimitedProfile(profile: CoachProfile): boolean {
  return profile.difficulties.some(d => d === 'reach_difficulty' || d === 'soreness') || profile.goals.includes('rehab_support')
}

export function profileNeeds(profile: CoachProfile): Record<Focus, number> {
  const needs: Record<Focus, number> = { reach: 0, stability: 0, coordination: 0, rhythm: 0, general: 0 }
  for (const goal of profile.goals) for (const [focus, value] of Object.entries(GOAL_NEEDS[goal])) needs[focus as Focus] += value
  for (const difficulty of profile.difficulties) for (const [focus, value] of Object.entries(DIFFICULTY_NEEDS[difficulty])) needs[focus as Focus] += value
  const total = FOCUSES.reduce((sum, focus) => sum + needs[focus], 0)
  if (!(total > 0)) return { reach: 0, stability: 0, coordination: 0, rhythm: 0, general: 1 }
  for (const focus of FOCUSES) needs[focus] = needs[focus] / total
  return needs
}

/** FNV-1a 32-bit ×2 over the ranking-relevant catalogue fields. Drift detection only, not a security control. */
export function catalogueFingerprint(catalogue: readonly KnowledgeEntry[]): string {
  const text = catalogue.map(entry => [entry.id, entry.kind, entry.programId ?? '', entry.regions.join(','), entry.focuses.join(','), entry.caution.join(','), entry.verification, entry.href ?? ''].join(':')).join('|')
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ code ^ (index & 0xff), 0x01000193) >>> 0
  }
  return `fnv1a32x2:${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
}

interface Pool {
  chapters: KnowledgeEntry[]
  games: KnowledgeEntry[]
  excludedByAvailability: string[]
  excludedByMeasuredCaution: string[]
}

function unavailable(entry: KnowledgeEntry, ids: ReadonlySet<string>): boolean {
  return ids.has(entry.id) || (entry.programId !== undefined && ids.has(entry.programId))
}

/** Hard constraints. P0-equivalent safe filter, then stricter-only model filters. */
export function candidatePool(profile: CoachProfile, catalogue: readonly KnowledgeEntry[], unavailableIds: ReadonlySet<string>): Pool {
  const limited = isLimitedProfile(profile)
  const p0Safe = (entry: KnowledgeEntry) => entry.verification === 'project_verified' && (!limited || entry.caution.length === 0)
  const excludedByAvailability: string[] = [], excludedByMeasuredCaution: string[] = []
  const keep = (entry: KnowledgeEntry) => {
    if (!p0Safe(entry)) return false
    if (entry.kind === 'chapter' && entry.href === null) return false
    if (unavailable(entry, unavailableIds)) { excludedByAvailability.push(entry.id); return false }
    if (limited && entry.kind === 'chapter') {
      const descriptor = MOTION_DESCRIPTORS.get(entry.id)
      if (descriptor?.reliable && DESCRIPTOR_USAGE.cautionUnion.some(flag => descriptor.flags[flag].flagged)) { excludedByMeasuredCaution.push(entry.id); return false }
    }
    return true
  }
  const chapters = catalogue.filter(entry => entry.kind === 'chapter' && keep(entry))
  const games = catalogue.filter(entry => entry.kind === 'game' && keep(entry))
  return { chapters, games, excludedByAvailability, excludedByMeasuredCaution }
}

interface Scored {
  entry: KnowledgeEntry
  base: number
  overlap: BodyRegion[]
  loadIndex: number
  order: number
  contributions: FeatureContribution[]
  evidenceIds: string[]
}

const round = (value: number) => Math.round(value * 1e6) / 1e6
const contribution = (feature: FeatureContribution['feature'], value: number, weight: number, detail: string, sources: string[]): FeatureContribution =>
  ({ feature, value: round(value), weight, points: round(value * weight), detail, sources })

function directMatch(entry: KnowledgeEntry, item: CoachEvidence): boolean {
  return typeof item.contentId === 'string' && (item.contentId === entry.id || item.contentId === entry.programId || item.contentId === entry.chapterId)
}

function scoreEntry(entry: KnowledgeEntry, profile: CoachProfile, needs: Record<Focus, number>, evidence: CoachEvidence[], order: number): Scored {
  const selected = profile.regions
  const overlap = entry.regions.filter(region => selected.includes(region))
  const recall = overlap.length / selected.length
  const precision = entry.regions.length ? overlap.length / entry.regions.length : 0
  const relevance = overlap.length ? (2 * recall * precision) / (recall + precision) : 0
  const contributions: FeatureContribution[] = [
    contribution('region_relevance', relevance, RANKER_WEIGHTS.regionRelevance,
      overlap.length ? `目录标签覆盖所选部位 ${overlap.map(r => REGION_LABELS[r]).join('、')}（覆盖 ${overlap.length}/${selected.length}，本条目共 ${entry.regions.length} 个部位标签）` : '目录标签不含你选择的部位，仅作补充选项',
      [CATALOGUE_SOURCE]),
  ]
  const focusValue = FOCUSES.reduce((sum, focus) => sum + (entry.focuses.includes(focus) ? needs[focus] : 0), 0)
  const matchedFocus = FOCUSES.filter(focus => entry.focuses.includes(focus) && needs[focus] > 0)
  contributions.push(contribution('focus_alignment', focusValue, RANKER_WEIGHTS.focusAlignment,
    matchedFocus.length ? `训练方向与画像需求一致：${matchedFocus.map(f => FOCUS_LABELS[f]).join('、')}` : '训练方向与画像需求无直接重合', [CATALOGUE_SOURCE]))

  const descriptor: ChapterDescriptor | undefined = entry.kind === 'chapter' ? MOTION_DESCRIPTORS.get(entry.id) : undefined
  const measurable = descriptor?.reliable ? overlap.filter(region => (DESCRIPTOR_USAGE.rankingRegions as readonly string[]).includes(region) && descriptor.involvement[region] !== null) : []
  if (descriptor && measurable.length) {
    const mean = measurable.reduce((sum, region) => sum + (descriptor.involvement[region] as number), 0) / measurable.length
    contributions.push(contribution('measured_involvement', mean - 0.5, RANKER_WEIGHTS.measuredInvolvement,
      `参考轨迹实测：标准示范中${measurable.map(r => `${REGION_LABELS[r]}活动幅度 ${(descriptor.involvement[r] as number).toFixed(2)}`).join('、')}（目录内相对值 0–1，单一示范者二维代理）`,
      [sourceRef(descriptor)]))
  }

  const cautionCount = entry.caution.length
  const deepKnee = descriptor?.reliable && descriptor.flags.deepKnee.flagged ? descriptor.flags.deepKnee.sustainedSeconds : 0
  const loadIndex = Math.min(1, 0.2 * cautionCount + (deepKnee > 0 ? 0.3 * Math.min(1, deepKnee / 10) : 0))
  const loadWeight = profile.difficulties.includes('none') ? RANKER_WEIGHTS.loadWithoutDifficulty : RANKER_WEIGHTS.loadWithDifficulty
  if (loadIndex > 0) {
    contributions.push(contribution('load_penalty', -loadIndex, loadWeight,
      `冷启动优先较低负荷：${cautionCount ? `目录注意标签 ${entry.caution.map(c => CAUTION_LABELS[c]).join('、')}` : '无目录注意标签'}${deepKnee > 0 ? `；参考轨迹测得深屈膝约 ${deepKnee.toFixed(1)} 秒` : ''}`,
      deepKnee > 0 && descriptor ? [CATALOGUE_SOURCE, sourceRef(descriptor)] : [CATALOGUE_SOURCE]))
  }

  let evidencePoints = 0
  const evidenceIds: string[] = []
  for (const category of ['training', 'game', 'report', 'decision'] as const) {
    let best = 0, bestId: string | null = null
    for (const item of evidence) {
      if (item.category !== category) continue
      const strength = directMatch(entry, item) ? 1 : item.focuses.some(focus => entry.focuses.includes(focus)) ? 0.34 : 0
      if (strength > best) { best = strength; bestId = item.id }
    }
    if (bestId) { evidencePoints += EVIDENCE_WEIGHTS[category] * best; evidenceIds.push(bestId) }
  }
  evidencePoints = Math.min(RANKER_WEIGHTS.evidenceCap, evidencePoints)
  if (evidenceIds.length) {
    const synthetic = evidence.filter(item => evidenceIds.includes(item.id)).some(item => item.source === 'synthetic')
    contributions.push(contribution('evidence', evidencePoints, 1, `${synthetic ? '合成样例证据（不代表你的真实表现）' : '已授权本机证据'}：${evidenceIds.join('、')}；有界加分，不覆盖画像与安全规则`, evidenceIds.map(id => `evidence:${id}`)))
  }
  const base = contributions.reduce((sum, item) => sum + item.points, 0)
  return { entry, base: round(base), overlap, loadIndex, order, contributions, evidenceIds }
}

function similarity(a: KnowledgeEntry, b: KnowledgeEntry): number {
  const tokens = (entry: KnowledgeEntry) => new Set([...entry.regions.map(r => `r:${r}`), ...entry.focuses.map(f => `f:${f}`), ...entry.caution.map(c => `c:${c}`), `p:${entry.programId ?? entry.id}`])
  const left = tokens(a), right = tokens(b)
  const intersection = [...left].filter(token => right.has(token)).length
  return intersection / (left.size + right.size - intersection)
}

interface Pick { scored: Scored; total: number; extra: FeatureContribution[] }

/** Offline evaluation hook: what decided each greedy pick against the runner-up. Not exposed by the adapter. */
export interface RankerTrace { steps: Array<{ kind: 'chapter' | 'game'; step: number; pickedId: string; runnerUpId: string | null; decidedBy: 'single' | 'tier' | 'utility' | 'load' | 'order' | 'id' }> }

/** Greedy slate selection: primary matches before supplementary, coverage gain and diversity, documented tie-breaks. */
function greedy(candidates: Scored[], limit: number, selectedRegions: BodyRegion[], covered: Set<BodyRegion>, programmeLimit: number | null, trace?: RankerTrace, kind: 'chapter' | 'game' = 'chapter'): Pick[] {
  const picks: Pick[] = []
  const remaining = [...candidates]
  while (picks.length < limit && remaining.length) {
    const programmes = new Set(picks.map(pick => pick.scored.entry.programId))
    const options = remaining.filter(item => programmeLimit === null || programmes.has(item.entry.programId) || programmes.size < programmeLimit)
    if (!options.length) break
    const hasPrimary = options.some(item => item.overlap.length > 0)
    // The first pick's coverage is already inside region relevance (F1 recall); gain counts only afterwards.
    const coverageActive = picks.length > 0 || covered.size > 0
    const evaluated = options.filter(item => !hasPrimary || item.overlap.length > 0).map(item => {
      const fresh = item.overlap.filter(region => !covered.has(region))
      // Iteration 2: count of newly covered selected regions (was a fraction of |selected|, which let
      // measured refinement outweigh covering a selected region; full coverage fell 98.9% -> 94.3%).
      const gain = coverageActive && selectedRegions.length > 1 ? fresh.length : 0
      const maxSimilarity = picks.length ? Math.max(...picks.map(pick => similarity(pick.scored.entry, item.entry))) : 0
      const extra: FeatureContribution[] = []
      if (gain > 0) extra.push(contribution('coverage_gain', gain, RANKER_WEIGHTS.coverageGain, `补充覆盖尚未覆盖的所选部位（${fresh.map(r => REGION_LABELS[r]).join('、')}）`, [CATALOGUE_SOURCE]))
      if (maxSimilarity > 0) extra.push(contribution('diversity_penalty', -maxSimilarity, RANKER_WEIGHTS.diversityPenalty, '与已选条目的部位/方向/注意标签/所属功法相似，适度降低以保持多样', [CATALOGUE_SOURCE]))
      const total = round(item.base + extra.reduce((sum, c) => sum + c.points, 0))
      return { scored: item, total, extra }
    })
    evaluated.sort((a, b) => b.total - a.total || a.scored.loadIndex - b.scored.loadIndex || a.scored.order - b.scored.order || a.scored.entry.id.localeCompare(b.scored.entry.id))
    const best = evaluated[0]
    if (trace) {
      const second = evaluated[1]
      const tierRunner = !second && hasPrimary ? options.find(item => item.overlap.length === 0) : undefined
      trace.steps.push({
        kind, step: picks.length, pickedId: best.scored.entry.id, runnerUpId: second?.scored.entry.id ?? tierRunner?.entry.id ?? null,
        decidedBy: !second ? (tierRunner ? 'tier' : 'single') : best.total !== second.total ? 'utility' : best.scored.loadIndex !== second.scored.loadIndex ? 'load' : best.scored.order !== second.scored.order ? 'order' : 'id',
      })
    }
    picks.push(best)
    for (const region of best.scored.overlap) covered.add(region)
    remaining.splice(remaining.indexOf(best.scored), 1)
  }
  return picks
}

const PREFERENCE_TEXT: Record<CoachProfile['preference'], string> = { routine: '功法优先', game: '游戏优先', mixed: '功法与游戏混合' }

function unifiedOrder<T>(preference: CoachProfile['preference'], chapters: T[], games: T[]): T[] {
  if (preference === 'routine') return [...chapters, ...games]
  if (preference === 'game') return [...games, ...chapters]
  const out: T[] = []
  for (let index = 0; index < Math.max(chapters.length, games.length); index += 1) {
    if (chapters[index]) out.push(chapters[index])
    if (games[index]) out.push(games[index])
  }
  return out
}

/**
 * Read-only base utility this ranker assigns to each given candidate before greedy slate selection.
 * Used by fp-cdm E1 baselines and by fp-cdm stage-1 retrieval. rankCoachDecision behaviour is unchanged.
 */
export function scoreCandidatesForEvaluation(profile: CoachProfile, evidence: CoachEvidence[], catalogue: readonly KnowledgeEntry[], ids: readonly string[]): Record<string, number> {
  const needs = profileNeeds(profile)
  const out: Record<string, number> = {}
  for (const id of ids) {
    const entry = catalogue.find(e => e.id === id)
    if (!entry) continue
    const siblings = catalogue.filter(e => e.kind === entry.kind && (entry.kind !== 'chapter' || e.programId === entry.programId))
    out[id] = scoreEntry(entry, profile, needs, evidence, siblings.indexOf(entry)).base
  }
  return out
}

export function rankCoachDecision(input: RankerInput, trace?: RankerTrace): DecisionModelOutput {
  const { profile, evidence, catalogue } = input
  const unavailableIds = new Set(input.availability?.unavailableIds ?? [])
  const pool = candidatePool(profile, catalogue, unavailableIds)
  const needs = profileNeeds(profile)
  const chapterOrder = new Map<string, number>()
  for (const entry of catalogue) if (entry.kind === 'chapter') chapterOrder.set(entry.id, catalogue.filter(e => e.kind === 'chapter' && e.programId === entry.programId).indexOf(entry))
  const scoredChapters = pool.chapters.map(entry => scoreEntry(entry, profile, needs, evidence, chapterOrder.get(entry.id) ?? 0))
  const scoredGames = pool.games.map((entry, index) => scoreEntry(entry, profile, needs, evidence, index))
  const covered = new Set<BodyRegion>()
  const chapterPicks = greedy(scoredChapters, SLATE_LIMITS.chapters, profile.regions, covered, SLATE_LIMITS.programmes, trace, 'chapter')
  const gamePicks = greedy(scoredGames, SLATE_LIMITS.games, profile.regions, covered, null, trace, 'game')

  const coverable = new Set<BodyRegion>([...pool.chapters, ...pool.games].flatMap(entry => entry.regions))
  const gaps: CoverageGap[] = profile.regions.filter(region => !coverable.has(region)).map(region => ({ region, reason: 'NO_SAFE_LAUNCHABLE_ITEM' as const }))
  const ordered = unifiedOrder(profile.preference, chapterPicks, gamePicks)
  const priority: DecisionSlateItem[] = ordered.map((pick, index) => ({
    rank: index + 1,
    id: pick.scored.entry.id,
    kind: pick.scored.entry.kind === 'game' ? 'game' : 'chapter',
    ...(pick.scored.entry.programId ? { programId: pick.scored.entry.programId } : {}),
    title: pick.scored.entry.title,
    href: pick.scored.entry.href,
    launch: pick.scored.entry.kind === 'game' ? 'external_app' : 'in_app_route',
    matchLevel: pick.scored.overlap.length ? 'primary' : 'supplementary',
    utility: pick.total,
    contributions: [...pick.scored.contributions, ...pick.extra],
  }))

  const linkedEvidence = (ids: string[]) => evidence.filter(item => ids.includes(item.id))
  const basis = (ids: string[]): CoachRecommendation['basis'] => {
    const linked = linkedEvidence(ids)
    return linked.some(item => item.source === 'live' && item.category !== 'decision') ? 'live_and_rules' : linked.some(item => item.source === 'synthetic') ? 'synthetic_and_rules' : 'profile_rules'
  }
  const toRecommendation = (pick: Pick, rank: number): CoachRecommendation => ({
    entry: pick.scored.entry,
    reasons: [
      `决策模型 ${DECISION_MODEL_ID}@${DECISION_MODEL_VERSION} 排序第 ${rank} 位（${pick.scored.overlap.length ? '主要匹配' : '补充选项'}，效用 ${pick.total.toFixed(2)}）。`,
      ...[...pick.scored.contributions, ...pick.extra].map(item => `${item.detail}（${item.points >= 0 ? '+' : ''}${item.points.toFixed(2)}）`),
      `动作依据：${pick.scored.entry.movement}。画像适配是工程建议，医学改善效果待核验。`,
    ],
    evidenceIds: pick.scored.evidenceIds,
    basis: basis(pick.scored.evidenceIds),
  })
  const rankOf = (id: string) => priority.find(item => item.id === id)?.rank ?? 0
  const chapters = chapterPicks.map(pick => toRecommendation(pick, rankOf(pick.scored.entry.id)))
  const games = gamePicks.map(pick => toRecommendation(pick, rankOf(pick.scored.entry.id)))
  const programmeIds = [...new Set(chapterPicks.map(pick => pick.scored.entry.programId))]
  const routines: CoachRecommendation[] = programmeIds.flatMap(programId => {
    const routine = catalogue.find(entry => entry.kind === 'routine' && entry.programId === programId)
    if (!routine) return []
    const titles = chapterPicks.filter(pick => pick.scored.entry.programId === programId).map(pick => pick.scored.entry.title)
    return [{ entry: { ...routine, href: null }, reasons: [`由所选章节归纳的功法方向；仅建议从章节「${titles.join('、')}」开始了解，这不是整套训练处方，请使用章节入口。`], evidenceIds: [], basis: 'profile_rules' as const }]
  })

  const focus = FOCUSES.map(item => ({ item, weight: needs[item] + (evidence.some(e => e.focuses.includes(item)) ? 0.05 : 0) }))
    .filter(item => item.weight > 0).sort((a, b) => b.weight - a.weight || FOCUSES.indexOf(a.item) - FOCUSES.indexOf(b.item)).slice(0, 3).map(item => item.item)

  const limitations = [
    '决策模型为确定性可解释排序（未训练权重）；没有专家或真人效果标签，排序质量未经真实用户验证。',
    'StartLux 未使用：其冻结 LoRA 是 Isleward 肩部游戏的下一回合六动作干预模型（CC BY-NC 4.0），不适用于功法/章节/游戏排序。',
    '参考轨迹实测来自标准示范视频的单人二维姿态，仅作目录核对与排序细化，不是关节活动度、负荷或疗效的临床测量。',
    '不做诊断、不承诺医学疗效，不提供康复剂量；画像为自述。',
    ...(isLimitedProfile(profile) ? ['已按保守规则排除带过顶、平衡、转体、明显俯身或支撑负荷标记的章节和游戏，并叠加经验证的实测注意项；无法保证个体适用性。'] : []),
    ...(profile.goals.includes('rehab_support') ? ['你选择了康复辅助意向，请先由医生或康复专业人员确认可练范围。'] : []),
    ...(gaps.length ? [`所选部位 ${gaps.map(gap => REGION_LABELS[gap.region]).join('、')} 当前没有通过安全与可用性筛选的章节或游戏，不会补造内容。`] : []),
    ...(evidence.some(item => item.source === 'synthetic') ? ['当前含 synthetic 合成样例；样例不能用于断言你的真实训练表现或模型已接入真实历史。'] : []),
    ...(pool.excludedByAvailability.length ? [`宿主可用性快照排除了 ${pool.excludedByAvailability.length} 个当前不可启动的条目。`] : []),
    '游戏为独立应用，当前平台未配置启动地址；推荐不代表已启动或已接入游戏历史。',
  ]
  const hasCandidates = chapters.length + games.length > 0
  const result: CoachRecommendationResult = {
    status: 'ready',
    message: hasCandidates
      ? `已根据画像生成排序候选（${PREFERENCE_TEXT[profile.preference]}；确定性可解释决策模型，未训练权重）。请在舒适范围内选择，出现不适即停止。`
      : '当前筛选下没有可用的功法、章节或游戏候选；不会补造或强行替换推荐。',
    routines, chapters, games, focus, evidence, limitations,
  }
  return {
    model: {
      id: DECISION_MODEL_ID, version: DECISION_MODEL_VERSION, kind: 'deterministic_constrained_ranker', trainedWeights: false,
      descriptorsId: DESCRIPTOR_META.id, descriptorsExtractorVersion: DESCRIPTOR_META.extractorVersion, catalogueFingerprint: catalogueFingerprint(catalogue),
    },
    status: hasCandidates ? 'ready' : 'empty',
    priority,
    result,
    answers: {
      suitable: answerCoachQuestion('suitable', result),
      first_game: answerCoachQuestion('first_game', result),
      recent_issues: answerCoachQuestion('recent_issues', result),
      why: answerCoachQuestion('why', result),
      next_focus: answerCoachQuestion('next_focus', result),
    },
    focus,
    coverage: { selectedRegions: [...profile.regions], coveredRegions: profile.regions.filter(region => covered.has(region)), gaps },
    excluded: { byAvailability: pool.excludedByAvailability, byMeasuredCaution: pool.excludedByMeasuredCaution },
    availabilityRef: input.availability?.snapshotRef ?? null,
  }
}
