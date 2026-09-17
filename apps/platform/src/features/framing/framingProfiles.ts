import type { ExerciseId } from '../exercises/types'
import { FULL_BODY_BOUNDS, UPPER_BODY_WITH_HIPS_BOUNDS, type LandmarkName } from '../pose/types'

export type FramingProfileId = 'UPPER_BODY_WITH_HIPS' | 'FULL_BODY'

export interface FramingProfile {
  id: FramingProfileId
  bounds: ReadonlyArray<LandmarkName>
  preparation: string
  notInFrame: string
  poseLost: string
}

export const FRAMING_PROFILES: Record<FramingProfileId, FramingProfile> = {
  UPPER_BODY_WITH_HIPS: {
    id: 'UPPER_BODY_WITH_HIPS',
    bounds: UPPER_BODY_WITH_HIPS_BOUNDS,
    preparation: '请确保上半身和髋部完整入镜',
    notInFrame: '请确保上半身和髋部完整入镜',
    poseLost: '请回到画面中，确保上半身和髋部完整入镜',
  },
  FULL_BODY: {
    id: 'FULL_BODY',
    bounds: FULL_BODY_BOUNDS,
    preparation: '请后退一些，确保全身完整入镜',
    notInFrame: '请后退一些，确保全身完整入镜',
    poseLost: '请回到画面中，确保全身完整入镜',
  },
}

export const EXERCISE_FRAMING: Record<ExerciseId, FramingProfileId> = {
  shoulder_rotation: 'UPPER_BODY_WITH_HIPS',
  overhead_raise: 'UPPER_BODY_WITH_HIPS',
  lateral_raise: 'UPPER_BODY_WITH_HIPS',
  step_jack: 'FULL_BODY',
  squat: 'FULL_BODY',
  knee_raise: 'FULL_BODY',
}

export function getFramingProfile(exerciseId: ExerciseId): FramingProfile {
  return FRAMING_PROFILES[EXERCISE_FRAMING[exerciseId]]
}
