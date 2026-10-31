import type { MotionSubject } from './contracts'
import type { DispatcherTool, ToolIntent, ToolQuery } from './dispatchTypes'

const TOOLS: readonly DispatcherTool[] = ['read_session', 'read_history', 'read_scoring_evidence']
const EXERCISES = ['shoulder_rotation', 'overhead_raise', 'lateral_raise', 'step_jack', 'squat', 'knee_raise']
const ROUTINES = ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing']

/** Descriptor-based parsing does not execute provider-controlled getters. */
export function plainFields(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (!value || typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error('Expected plain data.')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))
    || required.some(key => !Object.hasOwn(descriptors, key))
    || Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, 'value'))) throw new Error('Unexpected fields.')
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]))
}

export function boundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value
    && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
}

export function parseToolIntent(value: unknown): ToolIntent | null {
  try {
    const intent = plainFields(value, ['tool', 'query'])
    if (!TOOLS.includes(intent.tool as DispatcherTool)) return null
    const fields = plainFields(intent.query, ['kind', 'sessionId', 'subject', 'limit'], ['kind'])
    if (fields.kind !== 'warmup' && fields.kind !== 'routine') return null
    const query: ToolQuery = { kind: fields.kind }
    if (Object.hasOwn(fields, 'sessionId')) {
      if (!boundedId(fields.sessionId)) return null
      query.sessionId = fields.sessionId
    }
    if (intent.tool !== 'read_history' && !query.sessionId) return null
    if (Object.hasOwn(fields, 'limit')) {
      if (intent.tool !== 'read_history' || !Number.isSafeInteger(fields.limit) || (fields.limit as number) < 1 || (fields.limit as number) > 64) return null
      query.limit = fields.limit as number
    }
    if (Object.hasOwn(fields, 'subject')) {
      const subject = plainFields(fields.subject, ['kind', 'id'])
      if (subject.kind !== (query.kind === 'warmup' ? 'exercise' : 'routine')
        || typeof subject.id !== 'string' || !(query.kind === 'warmup' ? EXERCISES : ROUTINES).includes(subject.id)) return null
      query.subject = { kind: subject.kind, id: subject.id } as MotionSubject
    }
    return { tool: intent.tool as DispatcherTool, query }
  } catch { return null }
}
