import type { LandmarkName } from '../pose/types'
import type { ReferencePose } from './types'

const PAIRS = [
  ['leftShoulder', 'rightShoulder'], ['leftElbow', 'rightElbow'], ['leftWrist', 'rightWrist'],
  ['leftHip', 'rightHip'], ['leftKnee', 'rightKnee'], ['leftAnkle', 'rightAnkle'],
] as const satisfies ReadonlyArray<readonly [LandmarkName, LandmarkName]>

export function mirrorReferencePose(source: ReferencePose, canonicalPoseId: string): ReferencePose {
  const landmarks = Object.fromEntries(Object.entries(source.landmarks).map(([name, point]) => [
    name,
    { ...point, x: 1 - point.x },
  ])) as ReferencePose['landmarks']
  for (const [left, right] of PAIRS) {
    const mirroredLeft = landmarks[right]
    landmarks[right] = landmarks[left]
    landmarks[left] = mirroredLeft
  }
  return { ...source, canonicalPoseId, landmarks }
}
