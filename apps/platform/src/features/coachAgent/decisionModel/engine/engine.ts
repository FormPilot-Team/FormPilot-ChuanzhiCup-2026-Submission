import { COACH_KNOWLEDGE } from '../../recommendation/catalogue'
import { validCoachProfile } from '../../recommendation/engine'
import type { CoachProfile, KnowledgeEntry } from '../../recommendation/types'
import { getCoachWebRecommendation } from '../../recommendation/webService'
import type { CoachWebResponse } from '../../recommendation/webContracts'
import { compareSlates } from '../adapter'
import { featureLabel, GROUP_LABELS } from '../cdm/explain'
import { guardCdmOutput } from '../cdm/guard'
import { BUNDLED_WEIGHTS, CDM_RUNTIME_VERSION, inferCdm, loadWeights, type CdmOutput, type CdmWeightsStatus } from '../cdm/model'
import { catalogueFingerprint } from '../ranker'
import {
  COACH_DECISION_CONTRACT, DEFAULT_COACH_DECISION_MODE, type CoachDecisionFallbackReason, type CoachDecisionMode, type CoachDecisionModelInfo,
  type CoachDecisionOptions, type CoachDecisionRankedItem, type CoachDecisionResponse,
} from './contract'
import { prepareDecisionInput } from './input'
import { contentTableFingerprint, FP_CDM_RELEASE, weightsFingerprint } from './release'

export interface CoachDecisionEngineConfig {
  /** Weights object; omitted = the bundled release weights. */
  weights?: unknown
  /** 'release' (default): weights, M1 table and catalogue must match FP_CDM_RELEASE. 'unbound': research variants (never ACTIVE). */
  binding?: 'release' | 'unbound'
  /** Trusted catalogue (tests only; the product always uses COACH_KNOWLEDGE). */
  catalogue?: readonly KnowledgeEntry[]
  now?: () => number
  /** Rules service (tests only; default Agent Web P0 getCoachWebRecommendation). */
  rules?: (request: unknown) => CoachWebResponse
  /** Inference function (fault-injection tests only). */
  infer?: typeof inferCdm
}

const MODES: readonly CoachDecisionMode[] = ['off', 'shadow', 'active']
const TIER_LABEL = { human: '人工标注训练（两名独立标注者）', ai_experimental: '实验性：AI 标注弱监督训练（单一 AI 标注者，未经人工验证）' } as const

export function createCoachDecisionEngine(config: CoachDecisionEngineConfig = {}) {
  const catalogue = config.catalogue ?? COACH_KNOWLEDGE
  const binding = config.binding ?? 'release'
  const rulesService = config.rules ?? getCoachWebRecommendation
  const clock = config.now ?? (() => Date.now())
  const infer = config.infer ?? inferCdm
  const loaded: CdmWeightsStatus = 'weights' in config ? loadWeights(config.weights) : BUNDLED_WEIGHTS

  // Integrity of the shipped bundle, computed once. Any mismatch keeps the model from running (rules are displayed).
  let bundleFailure: CoachDecisionFallbackReason | null = loaded.ok ? null : loaded.reason
  let info: CoachDecisionModelInfo | null = null
  if (loaded.ok) {
    const w = loaded.weights
    const fp = weightsFingerprint(w)
    if (binding === 'release') {
      if (fp !== FP_CDM_RELEASE.m2.weightsFingerprint || w.version !== FP_CDM_RELEASE.m2.version || CDM_RUNTIME_VERSION !== FP_CDM_RELEASE.m2.runtimeVersion) bundleFailure = 'MODEL_VERSION_MISMATCH'
      else if (contentTableFingerprint() !== FP_CDM_RELEASE.m1.contentTableFingerprint) bundleFailure = 'CONTENT_FEATURES_MISMATCH'
      else if (catalogueFingerprint(catalogue) !== FP_CDM_RELEASE.catalogueFingerprint) bundleFailure = 'CATALOGUE_MISMATCH'
    }
    info = {
      release: binding === 'release' ? FP_CDM_RELEASE.release : 'unbound',
      id: 'fp-cdm-m2', version: w.version, runtimeVersion: CDM_RUNTIME_VERSION, family: w.family, featureSet: w.featureSet,
      tier: loaded.tier, tierLabel: TIER_LABEL[loaded.tier], binding: binding === 'release' ? 'release_bound' : 'unbound_research_variant',
      weightsFingerprint: fp, weightsSha256: binding === 'release' && fp === FP_CDM_RELEASE.m2.weightsFingerprint ? FP_CDM_RELEASE.m2.weightsSha256 : null,
      contentModel: { id: 'fp-cdm-m1', tableVersion: FP_CDM_RELEASE.m1.contentTableVersion, fingerprint: contentTableFingerprint(), modelOfRecord: FP_CDM_RELEASE.m1.modelOfRecord },
      catalogueFingerprint: catalogueFingerprint(catalogue),
      trainedOn: { labelsSha256: w.trainedOn.labels.file_sha256 ?? null, matrixSha256: w.trainedOn.matrixSha256, devFamilies: w.trainedOn.devFamilies?.length ?? 0 },
      validation: { offlineTechnical: 'passed', humanValidation: loaded.tier === 'human' ? 'human_labels' : 'pending', productAcceptance: 'not_accepted' },
    }
  }

  function rankingOf(out: CdmOutput): CoachDecisionRankedItem[] {
    const slate = new Set(out.priority)
    return out.candidates.map((c, i) => ({
      rank: i + 1, id: c.id, kind: c.kind, programId: c.programId ?? null, title: c.title, href: c.href, launch: c.launch,
      score: c.score, suitability: c.suitability, inSlate: slate.has(c.id), reasons: [...c.reasons],
      explanation: c.contributions.map(p => ({ feature: p.feature, label: featureLabel(p.feature), group: p.group, groupLabel: GROUP_LABELS[p.group], value: p.value, points: p.points })),
    }))
  }

  function recommend(input: unknown, options: CoachDecisionOptions = {}): CoachDecisionResponse {
    const mode: CoachDecisionMode = MODES.includes(options?.mode as CoachDecisionMode) ? options.mode as CoachDecisionMode : DEFAULT_COACH_DECISION_MODE
    let snapshot: unknown
    try { snapshot = structuredClone(input) } catch { snapshot = undefined }
    const prepared = prepareDecisionInput(snapshot, catalogue, clock)
    const rules = rulesService(prepared.envelopeOk ? { schemaVersion: 1, source: 'rules', profile: prepared.profile } : snapshot)
    const limitations = [
      'rules 为 Agent Web P0 规则服务的原输出，未修改；模型只在安全筛选之后的候选内排序，不能解除任何限制。',
      ...(info?.tier === 'ai_experimental' ? ['当前模型为实验性版本：训练标签来自单一 AI 标注者（弱监督），未经人工、专家或真实用户验证。'] : []),
      ...(prepared.dataSources.trainingHistory === 'synthetic_demo' || prepared.dataSources.latestReport === 'synthetic_demo' || prepared.dataSources.gameHistory === 'synthetic_demo' ? ['输入中含合成演示数据，不代表本人真实训练表现。'] : []),
      ...(prepared.dataSources.gameHistory === 'missing' ? ['游戏历史未提供（平台暂无游戏历史仓储），模型按缺失处理。'] : []),
      '不做诊断、不承诺疗效、不提供剂量；出现不适即停止。',
    ]
    const base = (fallbackReason: CoachDecisionFallbackReason | null, extra: Partial<CoachDecisionResponse> = {}): CoachDecisionResponse => structuredClone({
      contract: COACH_DECISION_CONTRACT, mode,
      status: rules.status === 'error' ? 'error' : rules.status,
      decisionOrigin: 'rules',
      display: rules.status === 'error' ? null : { result: rules.result, answers: rules.answers },
      ranking: [], programmes: [], model: info, execution: 'not_run', confidence: null, abstained: false, abstainReason: null, outOfDistributionFeatures: [],
      fallbackReason, comparison: null, guard: { checked: false, violations: [] }, inputIssues: prepared.issues, dataSources: prepared.dataSources,
      rules, error: !prepared.envelopeOk ? { code: 'INVALID_REQUEST', message: `请求必须是对象且 contract 为 ${COACH_DECISION_CONTRACT}` } : rules.status === 'error' ? rules.error : null,
      limitations, executedActions: false, ...extra,
    } satisfies CoachDecisionResponse)

    if (!prepared.envelopeOk) return base('INPUT_INVALID', { status: 'error', display: null })
    if (mode === 'off') return base('MODEL_DISABLED', { execution: 'disabled' })
    if (rules.status === 'error') return base('INPUT_INVALID')
    if (rules.status === 'profile_required') return base('PROFILE_REQUIRED')
    if (rules.status === 'safety_hold') return base('SAFETY_HOLD')
    const profile = prepared.profile
    if (!validCoachProfile(profile)) return base('PROFILE_REQUIRED')
    if ((profile as CoachProfile).risk !== 'none') return base('SAFETY_HOLD')
    if (prepared.issues.length) return base('INPUT_INVALID')
    if (!prepared.availabilityValid) return base('INVALID_AVAILABILITY')
    if (bundleFailure || !loaded.ok) return base(bundleFailure ?? 'MODEL_MISSING')

    const state = { profile, ...prepared.state }
    let out: CdmOutput
    try { out = infer(loaded.weights, state, catalogue, prepared.availability, prepared.evidence) } catch { return base('MODEL_ERROR', { execution: 'failed' }) }
    let violations: string[]
    try { violations = guardCdmOutput(out, profile, catalogue, prepared.availability) } catch { violations = ['GUARD_EXCEPTION'] }
    if (violations.length) return base('OUTPUT_GUARD_REJECTED', { execution: 'executed', guard: { checked: true, violations } })
    const titleOf = new Map(catalogue.map(e => [e.id, e.title]))
    const executed: Partial<CoachDecisionResponse> = {
      execution: 'executed', guard: { checked: true, violations: [] }, confidence: out.confidence, ranking: rankingOf(out),
      programmes: out.programmes.map(p => ({ programId: p.programId, title: titleOf.get(p.programId) ?? p.programId, score: p.score, suitability: p.suitability })),
    }
    if (out.status === 'empty') return base('NO_CANDIDATES', { ...executed, ranking: [] })
    if (out.status === 'abstain') return base('MODEL_ABSTAINED', { ...executed, abstained: true, abstainReason: out.abstainReason, outOfDistributionFeatures: out.oodFeatures ?? [] })
    const comparison = compareSlates(rules.result, out.result)
    if (mode === 'shadow') return base('SHADOW_MODE', { ...executed, comparison })
    if (binding !== 'release') return base('UNBOUND_WEIGHTS', { ...executed, comparison })
    if (loaded.tier === 'ai_experimental' && options?.allowExperimentalModel !== true) return base('EXPERIMENTAL_MODEL_NOT_APPROVED', { ...executed, comparison })
    if (!out.result || !out.answers) return base('MODEL_ERROR', { execution: 'failed' })
    return base(null, { ...executed, comparison, status: 'ready', decisionOrigin: 'model', display: { result: out.result, answers: out.answers } })
  }

  /** Model card for the UI ("模型信息" panel) and the integration self-check. */
  function describe() {
    return structuredClone({
      contract: COACH_DECISION_CONTRACT, release: FP_CDM_RELEASE.release, defaultMode: DEFAULT_COACH_DECISION_MODE, modes: [...MODES],
      bundleStatus: bundleFailure ?? 'ok' as const, model: info,
    })
  }

  return { recommend, describe }
}

export type CoachDecisionEngine = ReturnType<typeof createCoachDecisionEngine>

/** Default engine: bundled, release-bound weights; mode defaults to 'off'. */
const defaultEngine = createCoachDecisionEngine()
export const recommendCoachDecision = defaultEngine.recommend
export const describeCoachDecisionModel = defaultEngine.describe
