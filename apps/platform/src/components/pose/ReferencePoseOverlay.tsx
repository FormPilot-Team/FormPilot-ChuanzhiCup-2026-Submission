import type { CanonicalPose, PoseAnchorLandmarks, ReferencePose } from '../../features/referencePose/types'
import { LANDMARK_INDEX } from '../../features/pose/types'

const CONNECTIONS = [
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'], ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'],
] as const

interface ReferencePoseOverlayProps {
  detectedPose: ReferencePose
  canonicalPose?: CanonicalPose
}

interface SkeletonLayerProps {
  landmarks: PoseAnchorLandmarks
  width: number
  height: number
  kind: 'detected' | 'canonical'
}

function SkeletonLayer({ landmarks, width, height, kind }: SkeletonLayerProps) {
  const at = (name: keyof typeof LANDMARK_INDEX) => {
    const point = landmarks[name]
    return { x: point.x * width, y: point.y * height }
  }
  const canonical = kind === 'canonical'
  return (
    <g data-testid={canonical ? 'canonical-reference-skeleton' : 'detected-coach-skeleton'}>
      {CONNECTIONS.map(([from, to]) => {
        const start = at(from)
        const end = at(to)
        return <line key={`${from}-${to}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={canonical ? '#f97316' : '#38bdf8'} strokeWidth={Math.max(width, height) * (canonical ? 0.004 : 0.0035)} strokeDasharray={canonical ? '10 7' : undefined} strokeLinecap="round" />
      })}
      {Array.from(new Set(CONNECTIONS.flat())).map((name) => {
        const point = at(name)
        return <circle key={name} cx={point.x} cy={point.y} r={Math.max(width, height) * 0.006} fill={canonical ? '#fff' : '#e0f2fe'} stroke={canonical ? '#ea580c' : '#0284c7'} strokeWidth={Math.max(width, height) * 0.0025} />
      })}
    </g>
  )
}

export function ReferencePoseOverlay({ detectedPose, canonicalPose }: ReferencePoseOverlayProps) {
  const { width, height } = detectedPose.image
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      data-testid="coach-reference-skeleton"
    >
      <SkeletonLayer landmarks={detectedPose.landmarks} width={width} height={height} kind="detected" />
      {canonicalPose?.landmarks ? <SkeletonLayer landmarks={canonicalPose.landmarks} width={width} height={height} kind="canonical" /> : null}
    </svg>
  )
}
