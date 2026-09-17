import { FeedbackPolicy } from '../feedback/FeedbackPolicy'
import type { BaseMotionFeatures } from '../motion/types'
import type { ExerciseEngine, ExerciseEngineOutput } from './contract'
import type { ExerciseState, RuleResult } from './types'

export interface ResettableMachine<TFeatures, TState> {
  update(features: TFeatures): TState
  reset(): void
}

export function createExerciseEngine<TFeatures extends BaseMotionFeatures, TState extends ExerciseState>(
  machine: ResettableMachine<TFeatures, TState>,
  evaluate: (features: TFeatures, state: TState) => RuleResult,
  feedback = new FeedbackPolicy(),
): ExerciseEngine<TFeatures, TState> {
  return {
    reset() {
      machine.reset()
      feedback.reset()
    },
    process(features: TFeatures): ExerciseEngineOutput<TState> {
      const state = machine.update(features)
      const result = evaluate(features, state)
      const speechFeedback = feedback.update(result, features.timestamp)
      const snapshot = feedback.getSnapshot()
      return {
        result,
        state,
        feedback: speechFeedback,
        confirmedPrimaryFeedback: snapshot.confirmedPrimaryFeedback,
        recoveredFeedback: snapshot.recoveredFeedback,
      }
    },
  }
}
