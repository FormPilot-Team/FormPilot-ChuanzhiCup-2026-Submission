import type { BaseMotionFeatures, ExerciseFeatureExtractor } from '../motion/types'
import type { NormalizedPoseFrame } from '../pose/PoseNormalizer'
import type { ExerciseDefinition, ExerciseEngine, ExerciseEngineOutput } from './contract'
import type { ExerciseState } from './types'

export interface ExerciseRuntime<
  TFeatures extends BaseMotionFeatures = BaseMotionFeatures,
  TState extends ExerciseState = ExerciseState,
> {
  readonly definition: ExerciseDefinition<TFeatures, TState>
  reset(): void
  resetEngine(): void
  extract(frame: NormalizedPoseFrame): TFeatures
  processFeatures(features: TFeatures): ExerciseEngineOutput<TState>
  process(frame: NormalizedPoseFrame): ExerciseEngineOutput<TState> & { features: TFeatures }
}

export function createExerciseRuntime<TFeatures extends BaseMotionFeatures, TState extends ExerciseState>(
  definition: ExerciseDefinition<TFeatures, TState>,
): ExerciseRuntime<TFeatures, TState> {
  const extractor: ExerciseFeatureExtractor<TFeatures> = definition.createFeatureExtractor()
  const engine: ExerciseEngine<TFeatures, TState> = definition.createEngine()
  return {
    definition,
    reset() {
      extractor.reset()
      engine.reset()
    },
    resetEngine() { engine.reset() },
    extract(frame) { return extractor.extract(frame) },
    processFeatures(features) { return engine.process(features) },
    process(frame: NormalizedPoseFrame) {
      const features = extractor.extract(frame)
      return { features, ...engine.process(features) }
    },
  }
}
