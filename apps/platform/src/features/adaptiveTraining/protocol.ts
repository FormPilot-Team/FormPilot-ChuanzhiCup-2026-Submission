export const STRATEGIES = ['CONTINUE_STANDARD', 'SWITCH_CUE', 'SHOW_DECOMPOSITION', 'SUGGEST_PAUSE'] as const
export type InterventionStrategy = typeof STRATEGIES[number]
export const EXERCISE_NAMES = {
  shoulder_rotation: '肩部环绕', overhead_raise: '双臂上举', lateral_raise: '侧平举',
  step_jack: '侧步开合', squat: '徒手深蹲', knee_raise: '交替提膝',
} as const
export const ERROR_CODES = [
  'ARM_TOO_LOW_L', 'ARM_TOO_LOW_R', 'ELBOW_TOO_BENT_L', 'ELBOW_TOO_BENT_R', 'ASYMMETRY',
  'TORSO_LEAN', 'TOO_FAST', 'INCOMPLETE_REP', 'POSE_LOW_CONFIDENCE', 'BODY_OUT_OF_FRAME',
  'STEP_TOO_SMALL', 'ARM_TOO_LOW', 'ARM_LEG_UNSYNCED', 'WRONG_SIDE_SEQUENCE', 'BODY_SWAY',
  'INCOMPLETE_RETURN', 'DEPTH_INSUFFICIENT', 'KNEE_VALGUS', 'LEFT_RIGHT_ASYMMETRY',
  'TORSO_LATERAL_LEAN', 'KNEE_TOO_LOW_L', 'KNEE_TOO_LOW_R', 'LEFT_RIGHT_HEIGHT_GAP',
  'MOTION_TOO_SMALL', 'ARMS_UNSYNCED', 'MOTION_PAUSED', 'ARMS_TOO_LOW',
] as const
export const PHASES = [
  'START', 'RAISING', 'TOP', 'LOWERING', 'COMPLETE', 'CENTER', 'LEFT_OPENING', 'LEFT_OPEN',
  'RETURNING_FROM_LEFT', 'RIGHT_OPENING', 'RIGHT_OPEN', 'RETURNING_FROM_RIGHT', 'STANDING',
  'DESCENDING', 'BOTTOM', 'ASCENDING', 'LEFT_RAISING', 'LEFT_TOP', 'LEFT_RETURNING',
  'RIGHT_RAISING', 'RIGHT_TOP', 'RIGHT_RETURNING', 'READY', 'ROTATING',
] as const
export type ErrorCode = typeof ERROR_CODES[number]
export interface TrainingDecisionInput {
  exerciseId: keyof typeof EXERCISE_NAMES
  phase: typeof PHASES[number]
  trainingState: 'ACTIVE' | 'PAUSED' | 'PREPARING' | 'COMPLETE'
  poseValid: boolean
  poseReliability?: number
  score: number | null
  errors: { code: ErrorCode; severity: number }[]
  consecutiveErrors: number
  feedbackResponse: 'unknown' | 'not_corrected' | 'corrected'
  elapsedSeconds: number
  completion: number
  history: { averageScore: number | null; stableSeconds: number; completedReps: number; activeSeconds?: number }
}
export interface JevChoiceAnswer {
  type: 'choice'
  choice: InterventionStrategy
  probabilities: Record<InterventionStrategy, number>
  confidence: number
}
export type DecisionReason = 'model' | 'not_configured' | 'unavailable' | 'timeout' | 'invalid_response'
  | 'rate_limited' | 'safety_guard' | 'waiting' | 'mock' | 'local'
export interface LocalDecisionFeatures {
  windowSeconds: number
  reliableSamples: number
  poseReliability: number
  qualityScore: number | null
  errorFrequency: number
  errorDurationSeconds: number
  repeatedPrompts: number
  scoreTrend: number | null
  trend: 'improving' | 'steady' | 'worsening' | 'insufficient'
  previousStrategy: InterventionStrategy
  interventionEffect: 'none' | 'observing' | 'effective' | 'ineffective'
  ineffectiveInterventions: number
  stableSeconds: number
  activeSeconds: number
}
export interface LocalDecisionExplanation {
  strategyScores: Record<InterventionStrategy, number>
  eligibleStrategies: InterventionStrategy[]
  features: LocalDecisionFeatures
  reasons: string[]
  selection: 'score' | 'cooldown' | 'hysteresis' | 'sampling' | 'collecting' | 'safety'
}
export interface TrainingDecision {
  strategy: InterventionStrategy
  baseline: 'CONTINUE_STANDARD'
  source: 'jev' | 'rules' | 'mock' | 'local'
  reason: DecisionReason
  latencyMs: number
  safetyFallback: boolean
  model?: string
  modelAnswer?: JevChoiceAnswer
  local?: LocalDecisionExplanation
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
export function bounded(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}
export function isStrategy(value: unknown): value is InterventionStrategy {
  return STRATEGIES.includes(value as InterventionStrategy)
}

// Reconstruct an explicit allowlist. No images, landmarks, IDs, free text or additional fields leave this boundary.
export function parseTrainingInput(value: unknown): TrainingDecisionInput {
  const v = record(value)
  const h = record(v?.history)
  if (!v || !h || !Object.hasOwn(EXERCISE_NAMES, String(v.exerciseId))
    || !PHASES.includes(v.phase as typeof PHASES[number])
    || !['ACTIVE', 'PAUSED', 'PREPARING', 'COMPLETE'].includes(String(v.trainingState))
    || typeof v.poseValid !== 'boolean' || !(v.score === null || bounded(v.score, 0, 100))
    || (v.poseReliability !== undefined && !bounded(v.poseReliability, 0, 1))
    || !Array.isArray(v.errors) || v.errors.length > ERROR_CODES.length
    || !bounded(v.consecutiveErrors, 0, 1000) || !Number.isInteger(v.consecutiveErrors)
    || !['unknown', 'not_corrected', 'corrected'].includes(String(v.feedbackResponse))
    || !bounded(v.elapsedSeconds, 0, 86400) || !bounded(v.completion, 0, 1)
    || !(h.averageScore === null || bounded(h.averageScore, 0, 100))
    || !bounded(h.stableSeconds, 0, 86400) || !bounded(h.completedReps, 0, 100000)) {
    throw new Error('Invalid training summary')
  }
  if (h.activeSeconds !== undefined && !bounded(h.activeSeconds, 0, 86400)) throw new Error('Invalid active duration')
  const errors = v.errors.map((item: unknown) => {
    const e = record(item)
    if (!e || !ERROR_CODES.includes(e.code as ErrorCode) || !bounded(e.severity, 0, 1)) throw new Error('Invalid error summary')
    return { code: e.code as ErrorCode, severity: e.severity }
  })
  return {
    exerciseId: v.exerciseId as TrainingDecisionInput['exerciseId'], phase: v.phase as TrainingDecisionInput['phase'],
    trainingState: v.trainingState as TrainingDecisionInput['trainingState'], poseValid: v.poseValid,
    ...(v.poseReliability === undefined ? {} : { poseReliability: v.poseReliability as number }),
    score: v.score as number | null, errors, consecutiveErrors: v.consecutiveErrors,
    feedbackResponse: v.feedbackResponse as TrainingDecisionInput['feedbackResponse'],
    elapsedSeconds: v.elapsedSeconds, completion: v.completion,
    history: { averageScore: h.averageScore as number | null, stableSeconds: h.stableSeconds, completedReps: h.completedReps,
      ...(h.activeSeconds === undefined ? {} : { activeSeconds: h.activeSeconds as number }) },
  }
}

export function parseChoice(value: unknown): JevChoiceAnswer {
  const a = record(value)
  const p = record(a?.probabilities)
  if (!a || a.type !== 'choice' || !isStrategy(a.choice) || !bounded(a.confidence, 0, 1) || !p
    || Object.keys(p).length !== STRATEGIES.length || !STRATEGIES.every(s => bounded(p[s], 0, 1))) {
    throw new Error('Invalid choice answer')
  }
  const probabilities = Object.fromEntries(STRATEGIES.map(s => [s, p[s]])) as Record<InterventionStrategy, number>
  if (Math.abs(Object.values(probabilities).reduce((sum, n) => sum + n, 0) - 1) > .02
    || STRATEGIES.some(s => probabilities[s] > probabilities[a.choice as InterventionStrategy] + .0001)) {
    throw new Error('Invalid probability distribution')
  }
  return { type: 'choice', choice: a.choice, probabilities, confidence: a.confidence }
}
