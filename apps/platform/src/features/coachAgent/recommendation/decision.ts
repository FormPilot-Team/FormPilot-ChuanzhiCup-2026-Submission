import { guardLocalStrategy, LOCAL_POLICY } from '../../adaptiveTraining/LocalAdaptiveDecisionEngine'
import { guardStrategy } from '../../adaptiveTraining/decisionPolicy'
import { parseTrainingInput, STRATEGIES, type InterventionStrategy, type TrainingDecisionInput } from '../../adaptiveTraining/protocol'
import type { CoachEvidence, Focus } from './types'

export interface GuardedDecisionDTO {
  schemaVersion: 1
  source: 'startlux' | 'rules' | 'synthetic'
  modelId: string | null
  modelVersion: string | null
  inputRef: string
  decisionRef: string
  createdAt: number
  guardedStrategy: InterventionStrategy
  fallbackReason: 'none' | 'safety_guard' | 'cooldown' | 'unavailable'
}
export interface DecisionReadScope {
  input: TrainingDecisionInput
  inputRef: string
  now: number
  /** App-owned activation time, never supplied by a model. */
  lastAcceptedAt: number | null
  modelId: string
  modelVersion: string
  /** App-owned provider identity. The output is not allowed to label itself as a live model. */
  expectedSource: GuardedDecisionDTO['source']
}
const KEYS: Array<keyof GuardedDecisionDTO> = ['schemaVersion', 'source', 'modelId', 'modelVersion', 'inputRef', 'decisionRef', 'createdAt', 'guardedStrategy', 'fallbackReason']
const DIRECTIONS: Record<InterventionStrategy, Focus[]> = { CONTINUE_STANDARD: ['general'], SWITCH_CUE: ['rhythm'], SHOW_DECOMPOSITION: ['coordination'], SUGGEST_PAUSE: ['general'] }
const TEXT: Record<InterventionStrategy, string> = { CONTINUE_STANDARD: '保持原有训练与反馈', SWITCH_CUE: '换一种本地提示，留意节奏', SHOW_DECOMPOSITION: '先查看既有动作分解与配合', SUGGEST_PAUSE: '可在允许阶段自行选择短暂休息' }
const bounded = (value: unknown) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 128
  && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)

/** Read-only adapter design. It does not call a model, execute a strategy or alter training state. */
export function adaptGuardedDecision(raw: unknown, scope: DecisionReadScope): { ok: true; dto: GuardedDecisionDTO; evidence: CoachEvidence } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) return fail('INVALID_DTO')
  const record = raw as Record<string, unknown>
  if (Reflect.ownKeys(record).length !== KEYS.length || !KEYS.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
  })) return fail('INVALID_FIELDS')
  if (record.schemaVersion !== 1 || typeof record.source !== 'string' || !['startlux', 'rules', 'synthetic'].includes(record.source) || record.source !== scope.expectedSource
    || !bounded(record.inputRef) || record.inputRef !== scope.inputRef || !bounded(record.decisionRef)
    || !STRATEGIES.includes(record.guardedStrategy as InterventionStrategy)
    || typeof record.fallbackReason !== 'string' || !['none', 'safety_guard', 'cooldown', 'unavailable'].includes(record.fallbackReason)) return fail('INVALID_DTO')
  if (!Number.isSafeInteger(scope.now) || !Number.isSafeInteger(record.createdAt) || Number(record.createdAt) < 0
    || Number(record.createdAt) > scope.now || scope.now - Number(record.createdAt) > 30_000) return fail('EXPIRED_OR_INVALID_CLOCK')
  if (record.source === 'rules' ? record.modelId !== null || record.modelVersion !== null
    : !bounded(record.modelId) || !bounded(record.modelVersion) || record.modelId !== scope.modelId || record.modelVersion !== scope.modelVersion) return fail('MODEL_IDENTITY_MISMATCH')
  if (record.source !== 'rules' && record.fallbackReason !== 'none') return fail('FALLBACK_MUST_BE_RULES')
  if (record.source === 'rules' && record.fallbackReason !== 'none' && record.guardedStrategy !== 'CONTINUE_STANDARD') return fail('INVALID_FALLBACK')
  let input: TrainingDecisionInput
  try { input = parseTrainingInput(scope.input) } catch { return fail('INVALID_INPUT') }
  const strategy = record.guardedStrategy as InterventionStrategy
  if (strategy !== guardStrategy(input, guardLocalStrategy(input, strategy))) return fail('SAFETY_GUARD_REJECTED')
  if (scope.lastAcceptedAt !== null) {
    if (!Number.isSafeInteger(scope.lastAcceptedAt) || scope.lastAcceptedAt < 0 || scope.lastAcceptedAt > scope.now) return fail('INVALID_COOLDOWN_CLOCK')
    if (strategy !== 'CONTINUE_STANDARD' && scope.now - scope.lastAcceptedAt < LOCAL_POLICY.cooldownMs[strategy]) return fail('COOLDOWN')
  }
  const dto = { ...record } as unknown as GuardedDecisionDTO
  return { ok: true, dto, evidence: { id: `decision:${dto.decisionRef}`, category: 'decision', source: dto.source === 'synthetic' ? 'synthetic' : 'live', title: `${dto.source === 'startlux' ? 'StartLux' : dto.source === 'synthetic' ? '模型输出合成样例' : '本地规则'}：${dto.guardedStrategy}`,
    detail: `${TEXT[strategy]}。仅为经安全校验后的建议，不是已检测的身体问题；fallback=${dto.fallbackReason}。`, focuses: DIRECTIONS[strategy], occurredAt: dto.createdAt,
    references: [`input:${dto.inputRef}`, `decision:${dto.decisionRef}`, ...(dto.modelId ? [`model:${dto.modelId}@${dto.modelVersion}`] : ['policy:local-rules'])] } }
}
