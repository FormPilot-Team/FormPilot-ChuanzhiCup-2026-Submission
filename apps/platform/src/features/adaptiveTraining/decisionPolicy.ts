import { EXERCISE_NAMES, type TrainingDecisionInput, type TrainingDecision, type InterventionStrategy, type DecisionReason, type JevChoiceAnswer } from './protocol.ts'

export function ruleBaseline(reason: DecisionReason = 'waiting', latencyMs = 0): TrainingDecision {
  return { strategy: 'CONTINUE_STANDARD', baseline: 'CONTINUE_STANDARD', source: 'rules', reason, latencyMs, safetyFallback: reason !== 'waiting' }
}

export function eligibleForModel(input: TrainingDecisionInput): boolean {
  return input.trainingState === 'ACTIVE' && input.poseValid && input.completion < 1
    && !input.errors.some(e => ['POSE_LOW_CONFIDENCE', 'BODY_OUT_OF_FRAME'].includes(e.code))
}

// This layer never modifies detector thresholds, scoring, course state or the existing correction/voice pipeline.
export function guardStrategy(input: TrainingDecisionInput, requested: InterventionStrategy): InterventionStrategy {
  if (requested === 'CONTINUE_STANDARD') return requested
  if (!eligibleForModel(input) || input.errors.length === 0 || input.feedbackResponse === 'corrected') return 'CONTINUE_STANDARD'
  // Preserve the original priority correction for high severity or knee alignment issues.
  if (input.errors.some(e => e.severity >= .8 || e.code === 'KNEE_VALGUS')) return 'CONTINUE_STANDARD'
  if (requested === 'SWITCH_CUE' && input.consecutiveErrors < 2) return 'CONTINUE_STANDARD'
  if (requested === 'SHOW_DECOMPOSITION' && input.consecutiveErrors < 3) return 'CONTINUE_STANDARD'
  // A pause remains a suggestion, accepted only through the existing pause control at a resting phase.
  if (requested === 'SUGGEST_PAUSE' && (input.elapsedSeconds < 180 || input.consecutiveErrors < 6
    || !['START', 'CENTER', 'STANDING', 'READY', 'COMPLETE'].includes(input.phase))) return 'CONTINUE_STANDARD'
  return requested
}

export function executeChoice(input: TrainingDecisionInput, answer: JevChoiceAnswer, latencyMs: number, model: string, source: 'jev' | 'mock' = 'jev'): TrainingDecision {
  const strategy = guardStrategy(input, answer.choice)
  const safetyFallback = strategy !== answer.choice
  return { strategy, baseline: 'CONTINUE_STANDARD', source, reason: safetyFallback ? 'safety_guard' : source === 'mock' ? 'mock' : 'model', latencyMs, safetyFallback, model, modelAnswer: answer }
}

export function buildJevRequest(input: TrainingDecisionInput) {
  return {
    model: 'jev-latest',
    state: { ...input, exerciseName: EXERCISE_NAMES[input.exerciseId] },
    questions: {
      intervention: {
        type: 'choice',
        instructions: 'Choose one training feedback intervention from the structured summary. Do not infer pose, medical risk or new safety thresholds. ConsecutiveErrors counts confirmed correction prompts for the same issue without recovery, not frames. Unknown response is not failure. Never change scores or stop training. Invalid detection, inactive/completed training, corrected issues, severity >= 0.8 or KNEE_VALGUS require CONTINUE_STANDARD. Only suggest rest after 180 seconds, 6 uncorrected prompts, and a resting phase (START, CENTER, STANDING, READY, COMPLETE).',
        criteria: {
          CONTINUE_STANDARD: 'Normal or occasional errors, recovery or stable completion. Keep current local feedback.',
          SWITCH_CUE: 'At least 2 repeated confirmed prompts for the same issue. Change to a local concrete cue.',
          SHOW_DECOMPOSITION: 'At least 3 repeated prompts with no correction. Show existing local action steps; do not invent video.',
          SUGGEST_PAUSE: 'At least 6 repeated prompts after 180 seconds and at a resting phase. Suggest voluntary short rest.',
        },
      },
    },
  }
}

// Cyclic movement phases and individual frames do not constitute a new decision event.
export function decisionFingerprint(input: TrainingDecisionInput): string {
  const quality = input.score === null ? 'unknown' : input.score >= 85 ? 'good' : input.score >= 60 ? 'fair' : 'low'
  return JSON.stringify([
    input.exerciseId, input.trainingState, input.poseValid, quality,
    input.errors.map(e => [e.code, e.severity >= .8]).sort(), Math.min(input.consecutiveErrors, 6),
    input.feedbackResponse, input.elapsedSeconds >= 180,
    input.completion >= 1 ? 'complete' : input.completion >= .5 ? 'half' : 'early',
    input.history.stableSeconds >= 10,
    // Rest eligibility changes matter only when a rest intervention is possible.
    input.consecutiveErrors >= 6 && input.elapsedSeconds >= 180 && ['START', 'CENTER', 'STANDING', 'READY', 'COMPLETE'].includes(input.phase),
  ])
}
