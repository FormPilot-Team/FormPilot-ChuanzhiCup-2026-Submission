import { COACH_KNOWLEDGE } from '../../recommendation/catalogue'
import { validCoachProfile } from '../../recommendation/engine'
import type { CoachProfile, KnowledgeEntry } from '../../recommendation/types'
import { getCoachWebRecommendation } from '../../recommendation/webService'
import type { CoachWebResponse } from '../../recommendation/webContracts'
import { compareSlates } from '../adapter'
import { DESCRIPTOR_USAGE, MOTION_DESCRIPTORS } from '../descriptors'
import type { CatalogueAvailability, DecisionComparison, DecisionModelMode } from '../types'
import { BUNDLED_WEIGHTS, CDM_MODEL_ID, inferCdm, type CdmOutput, type CdmWeightsStatus } from './model'
import { stateFromEvidence, type DecisionState } from './state'

export const DEFAULT_CDM_MODE: DecisionModelMode = 'off'
export type CdmFallbackReason = 'MODEL_DISABLED' | 'SHADOW_MODE' | 'REQUEST_INVALID' | 'PROFILE_REQUIRED' | 'SAFETY_HOLD' | 'MODEL_NOT_TRAINED'
  | 'WEIGHTS_INVALID' | 'INVALID_AVAILABILITY' | 'STATE_PROFILE_MISMATCH' | 'MODEL_ERROR' | 'MODEL_ABSTAINED' | 'OUTPUT_GUARD_REJECTED'

export interface CdmOptions {
  mode?: DecisionModelMode
  availability?: CatalogueAvailability
  /** Trusted host state (reader-built history/report). Its profile must equal the request profile. */
  state?: DecisionState
}

export interface CdmResponse {
  schemaVersion: 1
  rules: CoachWebResponse
  decisionOrigin: 'rules' | 'model'
  active: { status: CoachWebResponse['status']; result: CoachWebResponse['result']; answers: CoachWebResponse['answers'] }
  mode: DecisionModelMode
  modelExecution: 'disabled' | 'not_applicable' | 'executed' | 'failed'
  fallbackReason: CdmFallbackReason | null
  model: CdmOutput | null
  guard: { checked: boolean; violations: string[] }
  comparison: DecisionComparison
  executedActions: false
  limitations: string[]
}

/** Independent output guard: recomputes the safe pool itself and never repairs output. */
export function guardCdmOutput(out: CdmOutput, profile: CoachProfile, catalogue: readonly KnowledgeEntry[], availability: CatalogueAvailability | null): string[] {
  const v: string[] = []
  const byId = new Map(catalogue.map(e => [e.id, e]))
  const limited = profile.difficulties.includes('reach_difficulty') || profile.difficulties.includes('soreness') || profile.goals.includes('rehab_support')
  const unavailable = new Set(availability?.unavailableIds ?? [])
  if (out.model.id !== CDM_MODEL_ID || out.model.trainedWeights !== true) v.push('MODEL_IDENTITY')
  if (profile.risk !== 'none') v.push('RISK_PROFILE_REACHED_MODEL')
  if (out.confidence !== null && !(out.confidence >= 0 && out.confidence <= 1)) v.push('CONFIDENCE_RANGE')
  for (let i = 0; i < out.candidates.length; i += 1) {
    const c = out.candidates[i]
    const e = byId.get(c.id)
    if (!e || e.kind === 'routine') { v.push(`UNKNOWN:${c.id}`); continue }
    if (!(c.suitability >= 0 && c.suitability <= 1) || !Number.isFinite(c.score)) v.push(`SCORE:${c.id}`)
    if (i > 0 && out.candidates[i - 1].score < c.score) v.push('NOT_SORTED')
    if (e.verification !== 'project_verified') v.push(`UNVERIFIED:${c.id}`)
    if (limited && e.caution.length) v.push(`CAUTION_FOR_LIMITED:${c.id}`)
    if (e.kind === 'chapter' && e.href === null) v.push(`NOT_LAUNCHABLE:${c.id}`)
    if (unavailable.has(c.id) || (e.programId && unavailable.has(e.programId))) v.push(`UNAVAILABLE:${c.id}`)
    const d = MOTION_DESCRIPTORS.get(c.id)
    if (limited && d?.reliable && DESCRIPTOR_USAGE.cautionUnion.some(f => d.flags[f].flagged)) v.push(`MEASURED_CAUTION_FOR_LIMITED:${c.id}`)
  }
  if (new Set(out.candidates.map(c => c.id)).size !== out.candidates.length) v.push('DUPLICATE')
  if (out.status === 'ready') {
    if (!out.result) v.push('READY_WITHOUT_RESULT')
    else {
      const ids = [...out.result.chapters, ...out.result.games].map(x => x.entry.id)
      if (out.result.chapters.length > 3 || out.result.games.length > 2) v.push('SLATE_LIMIT')
      if (new Set(out.result.chapters.map(x => x.entry.programId)).size > 2) v.push('PROGRAMME_LIMIT')
      if ([...ids].sort().join() !== [...out.priority].sort().join()) v.push('PRIORITY_RESULT_MISMATCH')
      if (!ids.every(id => out.candidates.some(c => c.id === id))) v.push('SLATE_OUTSIDE_CANDIDATES')
      for (const item of [...out.result.chapters, ...out.result.games]) {
        const e = byId.get(item.entry.id)
        if (!e || JSON.stringify(e) !== JSON.stringify(item.entry)) v.push(`ENTRY_ALTERED:${item.entry.id}`)
      }
    }
  } else if (out.result !== null || out.priority.length) v.push('ABSTAIN_WITH_RESULT')
  return v
}

export interface CdmDeps { catalogue: readonly KnowledgeEntry[]; rules: (r: unknown) => CoachWebResponse; weights: CdmWeightsStatus; now: () => number }

const MODES: readonly DecisionModelMode[] = ['off', 'shadow', 'active']

export function createCdmService(deps: CdmDeps) {
  return function getCoachCdmRecommendation(request: unknown, options: CdmOptions = {}): CdmResponse {
    const mode = MODES.includes(options.mode as DecisionModelMode) ? options.mode as DecisionModelMode : DEFAULT_CDM_MODE
    let snapshot: unknown
    try { snapshot = structuredClone(request) } catch { snapshot = request }
    const rules = deps.rules(snapshot)
    const base = (fallbackReason: CdmFallbackReason | null, extra: Partial<CdmResponse> = {}): CdmResponse => structuredClone({
      schemaVersion: 1, rules, decisionOrigin: 'rules', active: { status: rules.status, result: rules.result, answers: rules.answers }, mode,
      modelExecution: 'not_applicable', fallbackReason, model: null, guard: { checked: false, violations: [] },
      comparison: { rankingEffect: 'not_compared', addedIds: [], removedIds: [], influencedIds: [] }, executedActions: false,
      limitations: ['rules 字段为原 P0 输出，未修改；模型只能在安全筛选之后的候选内排序。'], ...extra,
    } satisfies CdmResponse)
    if (mode === 'off') return base('MODEL_DISABLED', { modelExecution: 'disabled' })
    if (rules.status === 'error') return base('REQUEST_INVALID')
    if (rules.status === 'profile_required') return base('PROFILE_REQUIRED')
    if (rules.status === 'safety_hold') return base('SAFETY_HOLD')
    if (!deps.weights.ok) return base(deps.weights.reason)
    const profile = (snapshot as { profile?: unknown }).profile
    if (!validCoachProfile(profile) || profile.risk !== 'none') return base('PROFILE_REQUIRED')
    const availability = options.availability ?? null
    const known = new Set(deps.catalogue.flatMap(e => [e.id, ...(e.programId ? [e.programId] : [])]))
    if (availability && (typeof availability.snapshotRef !== 'string' || !availability.snapshotRef || !Array.isArray(availability.unavailableIds) || !availability.unavailableIds.every(id => known.has(id)))) return base('INVALID_AVAILABILITY')
    if (options.state && JSON.stringify(options.state.profile) !== JSON.stringify(profile)) return base('STATE_PROFILE_MISMATCH')
    const evidence = rules.result?.evidence ?? []
    const state = options.state ?? stateFromEvidence(profile, evidence, deps.now(), id => deps.catalogue.find(e => e.id === id)?.programId)
    let out: CdmOutput
    try { out = inferCdm(deps.weights.weights, state, deps.catalogue, availability, evidence) } catch { return base('MODEL_ERROR', { modelExecution: 'failed' }) }
    let violations: string[]
    try { violations = guardCdmOutput(out, profile, deps.catalogue, availability) } catch { violations = ['GUARD_EXCEPTION'] }
    if (violations.length) return base('OUTPUT_GUARD_REJECTED', { modelExecution: 'executed', guard: { checked: true, violations } })
    const executed = { modelExecution: 'executed' as const, model: out, guard: { checked: true, violations: [] } }
    if (out.status !== 'ready') return base('MODEL_ABSTAINED', executed)
    const comparison = compareSlates(rules.result, out.result)
    if (mode === 'shadow') return base('SHADOW_MODE', { ...executed, comparison })
    return base(null, { ...executed, comparison, decisionOrigin: 'model', active: { status: 'ready', result: out.result, answers: out.answers } })
  }
}

export const getCoachCdmRecommendation = createCdmService({ catalogue: COACH_KNOWLEDGE, rules: getCoachWebRecommendation, weights: BUNDLED_WEIGHTS, now: () => Date.now() })
