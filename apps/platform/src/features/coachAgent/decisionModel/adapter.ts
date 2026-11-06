import { COACH_KNOWLEDGE } from '../recommendation/catalogue'
import { validCoachProfile } from '../recommendation/engine'
import type { CoachRecommendationResult, KnowledgeEntry } from '../recommendation/types'
import { getCoachWebRecommendation } from '../recommendation/webService'
import type { CoachWebResponse } from '../recommendation/webContracts'
import { descriptorIntegrity } from './descriptors'
import { guardModelOutput } from './guard'
import { catalogueFingerprint, rankCoachDecision } from './ranker'
import type { CatalogueAvailability, CoachDecisionResponse, DecisionComparison, DecisionFallbackReason, DecisionModelMode, DecisionModelOptions, DecisionModelOutput, RankerInput } from './types'

/** Formal enable switch. Stays 'off' until the owner accepts the model; hosts may only opt into shadow/active explicitly. */
export const DEFAULT_DECISION_MODEL_MODE: DecisionModelMode = 'off'

/**
 * Catalogue the v1 usage rules, weights and descriptors were validated against. Any catalogue edit
 * changes the fingerprint and the model falls back to rules (INTEGRITY_MISMATCH) until re-validated:
 * rerun scripts/decision-model/audit-descriptors.ts + evaluate.ts and update this constant.
 */
export const VALIDATED_CATALOGUE_FINGERPRINT = 'fnv1a32x2:e01fd2104d0ef965'

export interface DecisionServiceDeps {
  catalogue: readonly KnowledgeEntry[]
  ranker: (input: RankerInput) => DecisionModelOutput
  rules: (request: unknown) => CoachWebResponse
  validatedFingerprint: string
}

const MODES: readonly DecisionModelMode[] = ['off', 'shadow', 'active']

function slateIds(result: CoachRecommendationResult | null) {
  return { chapters: result?.chapters.map(item => item.entry.id) ?? [], games: result?.games.map(item => item.entry.id) ?? [] }
}

export function compareSlates(rules: CoachRecommendationResult | null, model: CoachRecommendationResult | null): DecisionComparison {
  if (!rules || !model) return { rankingEffect: 'not_compared', addedIds: [], removedIds: [], influencedIds: [] }
  const a = slateIds(rules), b = slateIds(model)
  const before = [...a.chapters, ...a.games], after = [...b.chapters, ...b.games]
  const addedIds = after.filter(id => !before.includes(id))
  const removedIds = before.filter(id => !after.includes(id))
  const moved = after.filter(id => before.includes(id) && (a.chapters.indexOf(id) !== b.chapters.indexOf(id) || a.games.indexOf(id) !== b.games.indexOf(id)))
  const rankingEffect = addedIds.length || removedIds.length ? 'changed' : moved.length ? 'reordered' : 'identical'
  return { rankingEffect, addedIds, removedIds, influencedIds: [...new Set([...addedIds, ...removedIds, ...moved])] }
}

function validAvailability(value: unknown, catalogue: readonly KnowledgeEntry[]): value is CatalogueAvailability {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const known = new Set(catalogue.flatMap(entry => [entry.id, ...(entry.programId ? [entry.programId] : [])]))
  return Object.keys(record).every(key => key === 'snapshotRef' || key === 'unavailableIds')
    && typeof record.snapshotRef === 'string' && record.snapshotRef.length > 0 && record.snapshotRef.length <= 128
    && Array.isArray(record.unavailableIds) && record.unavailableIds.length <= catalogue.length
    && record.unavailableIds.every(id => typeof id === 'string' && known.has(id))
}

export function createCoachDecisionService(deps: DecisionServiceDeps) {
  return function getCoachDecisionRecommendation(request: unknown, options: DecisionModelOptions = {}): CoachDecisionResponse {
    const mode: DecisionModelMode = MODES.includes(options.mode as DecisionModelMode) ? options.mode as DecisionModelMode : DEFAULT_DECISION_MODEL_MODE
    let snapshot: unknown
    try { snapshot = structuredClone(request) } catch { snapshot = request }
    const rules = deps.rules(snapshot)
    const availability = options.availability ?? null
    const availabilityOk = availability === null || validAvailability(availability, deps.catalogue)
    const unavailable = new Set(availabilityOk ? availability?.unavailableIds ?? [] : [])
    const rulesItems = rules.result ? [...rules.result.chapters, ...rules.result.games, ...rules.result.routines] : []
    const rulesAvailabilityConflicts = rulesItems.filter(item => unavailable.has(item.entry.id) || (item.entry.programId !== undefined && unavailable.has(item.entry.programId))).map(item => item.entry.id)
    const dataOrigin: CoachDecisionResponse['dataOrigin'] = rules.status === 'error' ? 'none' : rules.source.synthetic ? 'self_report_profile_with_synthetic_fixture' : 'self_report_profile'
    const base = (fallbackReason: DecisionFallbackReason | null, extra: Partial<CoachDecisionResponse> = {}): CoachDecisionResponse => structuredClone({
      schemaVersion: 1,
      rules,
      decisionOrigin: 'rules',
      active: { status: rules.status, result: rules.result, answers: rules.answers },
      mode,
      modelExecution: 'not_applicable',
      fallbackReason,
      model: null,
      guard: { checked: false, violations: [] },
      comparison: { rankingEffect: 'not_compared', addedIds: [], removedIds: [], influencedIds: [] },
      dataOrigin,
      rulesAvailabilityConflicts,
      executedActions: false,
      limitations: [
        '规则结果（rules）为原 P0 getCoachWebRecommendation 输出，未修改；决策模型只能在其安全门禁之后、更严格的候选池内排序。',
        ...(rulesAvailabilityConflicts.length ? [`规则结果未接入宿主可用性快照，仍包含当前不可启动的条目：${rulesAvailabilityConflicts.join('、')}。`] : []),
      ],
      ...extra,
    } satisfies CoachDecisionResponse)

    if (mode === 'off') return base('MODEL_DISABLED', { modelExecution: 'disabled' })
    if (rules.status === 'error') return base('REQUEST_INVALID')
    if (rules.status === 'profile_required') return base('PROFILE_REQUIRED')
    if (rules.status === 'safety_hold') return base('SAFETY_HOLD')
    if (!availabilityOk) return base('INVALID_AVAILABILITY')
    const profile = (snapshot as { profile?: unknown }).profile
    if (!validCoachProfile(profile) || profile.risk !== 'none') return base('PROFILE_REQUIRED')
    if (catalogueFingerprint(deps.catalogue) !== deps.validatedFingerprint || descriptorIntegrity(deps.catalogue).length) return base('INTEGRITY_MISMATCH')

    let output: DecisionModelOutput
    try {
      output = deps.ranker({ profile, evidence: rules.result?.evidence ?? [], availability, catalogue: deps.catalogue })
    } catch {
      return base('MODEL_ERROR', { modelExecution: 'failed' })
    }
    let violations: string[]
    try { violations = guardModelOutput(output, profile, deps.catalogue, availability) } catch { violations = ['GUARD_EXCEPTION'] }
    if (violations.length) return base('OUTPUT_GUARD_REJECTED', { modelExecution: 'executed', guard: { checked: true, violations } })

    const comparison = compareSlates(rules.result, output.result)
    const executed = { modelExecution: 'executed' as const, model: output, guard: { checked: true, violations: [] }, comparison }
    if (mode === 'shadow') return base('SHADOW_MODE', executed)
    return base(null, {
      ...executed,
      decisionOrigin: 'model',
      active: { status: output.status === 'empty' ? 'empty' : 'ready', result: output.result, answers: output.answers },
    })
  }
}

/** Trusted-host entry point. Same request contract as P0; model mode/availability come only from host options. */
export const getCoachDecisionRecommendation = createCoachDecisionService({
  catalogue: COACH_KNOWLEDGE,
  ranker: rankCoachDecision,
  rules: getCoachWebRecommendation,
  validatedFingerprint: VALIDATED_CATALOGUE_FINGERPRINT,
})
