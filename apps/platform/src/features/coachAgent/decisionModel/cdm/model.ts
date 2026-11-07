import type { CoachRecommendation, CoachRecommendationResult, KnowledgeEntry } from '../../recommendation/types'
import { answerCoachQuestion, recommendCoach } from '../../recommendation/engine'
import { candidatePool, rankCoachDecision, scoreCandidatesForEvaluation } from '../ranker'
import type { CatalogueAvailability } from '../types'
import { buildFeatures, FEATURE_GROUPS, FEATURE_NAMES, FEATURE_SET_VERSION } from './features'
import type { DecisionState } from './state'
import bundled from './fp-cdm-m2.weights.json'

export const CDM_MODEL_ID = 'fp-cdm-m2' as const
export const CDM_MODEL_VERSION = '1.0.0'
/** Runtime behaviour version: 1.1.0 = stage-1 retrieval (K=12) + top-candidate OOD rule with training ranges. */
export const CDM_RUNTIME_VERSION = '1.1.0'

/** Trained artefact exported by scripts/decision-model/cdm/train_m2.py (linear pairwise/pointwise model). */
export interface CdmWeights {
  schemaVersion: 1
  id: 'fp-cdm-m2'
  version: string
  status?: 'TRAINED' | 'AWAITING_LABELS'
  family: 'pairwise_lr' | 'pointwise_ridge'
  hyperparameter: number
  featureSet: string
  featureNames: string[]
  mean: number[]
  scale: number[]
  coef: number[]
  /** Validation temperature for pairwise preference probabilities. */
  pairTemperature: number
  /** Platt scaling: P(suitable = label >= 2) = sigmoid(a * score + b), fitted on dev out-of-fold scores. */
  platt: { a: number; b: number }
  abstainSuitabilityBelow: number
  /** Per-feature range observed in the training rows (optional; enables the range-based OOD rule). */
  featureRange?: { min: number[]; max: number[] }
  trainedOn: { matrixSha256: string; labels: { kind: string; file_sha256?: string; annotators?: unknown }; devFamilies: string[] }
}

export type CdmWeightsStatus = { ok: true; weights: CdmWeights } | { ok: false; reason: 'MODEL_NOT_TRAINED' | 'WEIGHTS_INVALID' }

/** Validates a weights object. Training labels must be human; planted/null pipeline artefacts are refused. */
export function loadWeights(raw: unknown): CdmWeightsStatus {
  const w = raw as Partial<CdmWeights> | null
  if (!w || typeof w !== 'object' || w.id !== CDM_MODEL_ID) return { ok: false, reason: 'WEIGHTS_INVALID' }
  if (w.status === 'AWAITING_LABELS' || !Array.isArray(w.coef)) return { ok: false, reason: 'MODEL_NOT_TRAINED' }
  const n = w.featureNames?.length ?? -1
  const finite = (a: unknown) => Array.isArray(a) && a.length === n && a.every(x => typeof x === 'number' && Number.isFinite(x))
  if (w.featureSet !== FEATURE_SET_VERSION || !w.featureNames!.every(name => FEATURE_NAMES.includes(name)) || !finite(w.mean) || !finite(w.scale) || !finite(w.coef)
    || !(typeof w.pairTemperature === 'number' && w.pairTemperature > 0) || !w.platt || !Number.isFinite(w.platt.a) || !Number.isFinite(w.platt.b)
    || typeof w.abstainSuitabilityBelow !== 'number' || w.trainedOn?.labels?.kind !== 'human'
    || (w.featureRange !== undefined && (!finite(w.featureRange.min) || !finite(w.featureRange.max)))) return { ok: false, reason: 'WEIGHTS_INVALID' }
  return { ok: true, weights: w as CdmWeights }
}
export const BUNDLED_WEIGHTS: CdmWeightsStatus = loadWeights(bundled)

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
const round = (x: number) => Math.round(x * 1e4) / 1e4

export interface CdmCandidateScore {
  id: string
  kind: 'chapter' | 'game'
  programId?: string
  title: string
  href: string | null
  launch: 'in_app_route' | 'external_app'
  /** Raw model score (relative within one user). */
  score: number
  /** Calibrated P(annotators would grade >= 2 "suitable"). */
  suitability: number
  /** Top feature contributions (coef × standardized value), for explanation. */
  contributions: Array<{ feature: string; group: 'P' | 'H' | 'R'; value: number; points: number }>
}

export interface CdmOutput {
  model: { id: typeof CDM_MODEL_ID; version: string; runtimeVersion: string; kind: 'trained_linear_preference_ranker'; trainedWeights: true; family: string; labelsSha256: string | null; matrixSha256: string; featureSet: string }
  status: 'ready' | 'abstain' | 'empty'
  abstainReason: null | 'LOW_SUITABILITY' | 'OUT_OF_DISTRIBUTION' | 'NO_CANDIDATES'
  /** Calibrated probability that the top item is preferred over the runner-up. */
  confidence: number | null
  candidates: CdmCandidateScore[]
  programmes: Array<{ programId: string; score: number; suitability: number }>
  priority: string[]
  result: CoachRecommendationResult | null
  answers: Record<'suitable' | 'first_game' | 'recent_issues' | 'why' | 'next_focus', string> | null
  stateOrigin: { history: string; report: string }
  excluded: { byAvailability: string[]; byMeasuredCaution: string[] }
  /** Stage-1 candidate set the trained model re-ranks (v1.1). */
  retrieval: { k: number; safePool: number; sources: { rulesP0: number; pr49: number; utilityFill: number } }
  /** Features of the top candidate outside the training range (only when abstaining as OUT_OF_DISTRIBUTION). */
  oodFeatures?: string[]
}

const GROUP_TEXT: Record<'P' | 'H' | 'R', string> = { P: '画像与内容', H: '训练历史', R: '最近报告' }

/**
 * Stage 1 retrieval (v1.1): the learned ranker only re-ranks a candidate set built the way the labelled pools were
 * built (P0 slate + PR #49 slate, padded by PR #49 utility), all inside the safe pool. Ranking the full catalogue put
 * the model off-distribution (content-only priors such as "neck content" dominated for users who did not select neck).
 */
export const RETRIEVAL_K = 12
export function retrieveCandidates(state: DecisionState, catalogue: readonly KnowledgeEntry[], safe: KnowledgeEntry[], evidence: CoachRecommendationResult['evidence']) {
  const allowed = new Map(safe.map(e => [e.id, e]))
  const p0 = recommendCoach(state.profile, { evidence: [...evidence], limitations: [], decisionStatus: 'not_connected' })
  const p0Ids = p0.status === 'ready' ? [...p0.chapters, ...p0.games].map(i => i.entry.id).filter(id => allowed.has(id)) : []
  const prIds = rankCoachDecision({ profile: state.profile, evidence: [...evidence], availability: null, catalogue }).priority.map(i => i.id).filter(id => allowed.has(id))
  const util = scoreCandidatesForEvaluation(state.profile, [...evidence], catalogue, [...allowed.keys()])
  const fill = [...allowed.keys()].sort((a, b) => util[b] - util[a] || a.localeCompare(b))
  const ids = [...new Set([...p0Ids, ...prIds, ...fill])].slice(0, RETRIEVAL_K)
  const from = (list: string[]) => ids.filter(id => list.includes(id)).length
  return { entries: ids.map(id => allowed.get(id) as KnowledgeEntry), sources: { rulesP0: from(p0Ids), pr49: ids.filter(id => prIds.includes(id) && !p0Ids.includes(id)).length, utilityFill: ids.length - new Set([...p0Ids, ...prIds].filter(id => ids.includes(id))).size } }
}

/** Pure inference: retrieval -> features -> scores -> calibrated suitability -> slate. No side effects, no network. */
export function inferCdm(weights: CdmWeights, state: DecisionState, catalogue: readonly KnowledgeEntry[], availability: CatalogueAvailability | null, evidence: CoachRecommendationResult['evidence']): CdmOutput {
  const pool = candidatePool(state.profile, catalogue, new Set(availability?.unavailableIds ?? []))
  const retrieval = retrieveCandidates(state, catalogue, [...pool.chapters, ...pool.games], evidence)
  const index = weights.featureNames.map(name => FEATURE_NAMES.indexOf(name))
  // OOD v1.1 (2026-11-07): judged on the TOP candidate only. With trained feature ranges: any feature outside
  // [min - 25% range, max + 25% range]. Legacy weights without ranges: more than 3 features beyond 8 sigma.
  // (v1 counted 8-sigma features across the whole pool and misfired on rare-but-observed binary features.)
  const oodOf = new Map<string, string[]>()
  const scored: CdmCandidateScore[] = retrieval.entries.map((entry): CdmCandidateScore => {
    const x = buildFeatures(state, entry, catalogue)
    const z = index.map((i, k) => (x[i] - weights.mean[k]) / (weights.scale[k] || 1))
    const range = weights.featureRange
    oodOf.set(entry.id, range
      ? weights.featureNames.filter((_, k) => { const pad = 0.25 * (range.max[k] - range.min[k]); return x[index[k]] < range.min[k] - pad - 1e-9 || x[index[k]] > range.max[k] + pad + 1e-9 })
      : (z.filter(v => Math.abs(v) > 8).length > 3 ? weights.featureNames.filter((_, k) => Math.abs(z[k]) > 8) : []))
    const parts = z.map((v, k) => ({ feature: weights.featureNames[k], group: FEATURE_GROUPS[weights.featureNames[k]], value: round(x[index[k]]), points: round(v * weights.coef[k]) }))
    const score = parts.reduce((s, p) => s + p.points, 0)
    return {
      id: entry.id, kind: entry.kind === 'game' ? 'game' as const : 'chapter' as const, ...(entry.programId ? { programId: entry.programId } : {}), title: entry.title, href: entry.href,
      launch: entry.kind === 'game' ? 'external_app' as const : 'in_app_route' as const, score: round(score), suitability: round(sigmoid(weights.platt.a * score + weights.platt.b)),
      contributions: parts.filter(p => p.points !== 0).sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 6),
    }
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  const base = {
    model: { id: CDM_MODEL_ID, version: weights.version, runtimeVersion: CDM_RUNTIME_VERSION, kind: 'trained_linear_preference_ranker' as const, trainedWeights: true as const, family: weights.family,
      labelsSha256: weights.trainedOn.labels.file_sha256 ?? null, matrixSha256: weights.trainedOn.matrixSha256, featureSet: weights.featureSet },
    candidates: scored,
    stateOrigin: { history: state.history.status === 'present' ? state.history.origin : 'missing', report: state.report.status === 'present' ? state.report.origin : 'missing' },
    excluded: { byAvailability: pool.excludedByAvailability, byMeasuredCaution: pool.excludedByMeasuredCaution },
    retrieval: { k: RETRIEVAL_K, safePool: pool.chapters.length + pool.games.length, sources: retrieval.sources },
  }
  const programmes = [...new Set(scored.filter(c => c.programId).map(c => c.programId as string))].map(programId => {
    const top = scored.filter(c => c.programId === programId).slice(0, 2)
    return { programId, score: round(top.reduce((s, c) => s + c.score, 0) / top.length), suitability: round(Math.max(...top.map(c => c.suitability))) }
  }).sort((a, b) => b.score - a.score)
  if (!scored.length) return { ...base, status: 'empty', abstainReason: 'NO_CANDIDATES', confidence: null, programmes, priority: [], result: null, answers: null }
  const confidence = scored.length > 1 ? round(sigmoid((scored[0].score - scored[1].score) / weights.pairTemperature)) : 1
  const oodTop = oodOf.get(scored[0].id) ?? []
  if (oodTop.length) return { ...base, status: 'abstain', abstainReason: 'OUT_OF_DISTRIBUTION', oodFeatures: oodTop, confidence, programmes, priority: [], result: null, answers: null }
  if (scored[0].suitability < weights.abstainSuitabilityBelow) return { ...base, status: 'abstain', abstainReason: 'LOW_SUITABILITY', confidence, programmes, priority: [], result: null, answers: null }

  // Product slate (same presentation limits as P0/PR #49): <=3 chapters from <=2 programmes, <=2 games.
  const chapters: CdmCandidateScore[] = []
  for (const c of scored.filter(x => x.kind === 'chapter')) {
    const progs = new Set(chapters.map(x => x.programId))
    if (chapters.length < 3 && (progs.has(c.programId) || progs.size < 2)) chapters.push(c)
  }
  const games = scored.filter(x => x.kind === 'game').slice(0, 2)
  const pref = state.profile.preference
  const priority = pref === 'routine' ? [...chapters, ...games] : pref === 'game' ? [...games, ...chapters]
    : Array.from({ length: Math.max(chapters.length, games.length) }, (_, i) => [chapters[i], games[i]]).flat().filter(Boolean) as CdmCandidateScore[]
  const byId = new Map(catalogue.map(e => [e.id, e]))
  const historyIds = state.history.status === 'present' ? new Set([...state.history.routines.map(r => r.chapterId), ...state.history.games.map(g => g.gameId)]) : new Set<string>()
  const recommend = (c: CdmCandidateScore): CoachRecommendation => {
    const linked = evidence.filter(e => e.contentId === c.id || (c.programId !== undefined && e.contentId === c.programId)).map(e => e.id)
    return {
      entry: byId.get(c.id) as KnowledgeEntry,
      reasons: [
        `训练模型 ${CDM_MODEL_ID}@${weights.version} 适配分 ${c.score.toFixed(2)}，校准适配概率 ${(c.suitability * 100).toFixed(0)}%（由人工标注学习，非医学结论）。`,
        ...c.contributions.slice(0, 4).map(p => `${GROUP_TEXT[p.group]}特征 ${p.feature}=${p.value}（${p.points >= 0 ? '+' : ''}${p.points.toFixed(2)}）`),
        ...(historyIds.has(c.id) ? ['该内容出现在训练历史中。'] : []),
        `动作依据：${byId.get(c.id)?.movement ?? ''}。`,
      ],
      evidenceIds: linked,
      basis: linked.length ? (evidence.some(e => linked.includes(e.id) && e.source === 'live') ? 'live_and_rules' : 'synthetic_and_rules') : 'profile_rules',
    }
  }
  const chosenProgrammes = [...new Set(chapters.map(c => c.programId as string))]
  const result: CoachRecommendationResult = {
    status: 'ready',
    message: `已由训练的偏好排序模型生成候选（顶部置信度 ${(confidence * 100).toFixed(0)}%）。请在舒适范围内选择，出现不适即停止。`,
    routines: chosenProgrammes.map(pid => ({ entry: { ...(catalogue.find(e => e.kind === 'routine' && e.programId === pid) as KnowledgeEntry), href: null },
      reasons: [`由模型排序靠前的章节归纳；仅建议从章节入口开始，不是整套处方。`], evidenceIds: [], basis: 'profile_rules' as const })),
    chapters: chapters.map(recommend), games: games.map(recommend),
    focus: [], evidence: [...evidence],
    limitations: [
      `排序由训练模型 ${CDM_MODEL_ID}@${weights.version}（${weights.family}）生成；标签来自两名独立标注者对合成场景的分级判断，未经真实用户或疗效验证。`,
      '安全筛选（风险暂停、受限画像注意项、可启动性、可用性）在模型之前和之后独立执行，模型分数不能解除任何限制。',
      ...(state.history.status === 'present' && state.history.origin !== 'live_reader' ? ['训练历史为合成或演示数据，不代表本人真实表现。'] : []),
      '不做诊断、不承诺疗效、不提供剂量。',
    ],
  }
  const answers = { suitable: answerCoachQuestion('suitable', result), first_game: answerCoachQuestion('first_game', result), recent_issues: answerCoachQuestion('recent_issues', result), why: answerCoachQuestion('why', result), next_focus: answerCoachQuestion('next_focus', result) }
  return { ...base, status: 'ready', abstainReason: null, confidence, programmes, priority: priority.map(c => c.id), result, answers }
}
