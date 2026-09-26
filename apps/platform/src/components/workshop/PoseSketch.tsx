import type { LandmarkName } from '../../features/pose/types'
import { bodyCoords, buildPoseMatch } from '../../features/workshop/recognition/poseMatch'
import type { CapturedPose } from '../../features/workshop/types'

const BONES: ReadonlyArray<readonly [LandmarkName, LandmarkName]> = [
  ['leftShoulder', 'rightShoulder'], ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'], ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'], ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'], ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'], ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'],
]

type Coords = NonNullable<ReturnType<typeof bodyCoords>>

/** Body coordinates (hip-centred, torso = 1) → sketch space: viewBox 0 0 120 140, mirrored like the camera preview. */
function project(coords: Coords, name: LandmarkName, scale: number): { x: number; y: number } | undefined {
  const point = coords[name]
  return point ? { x: 60 - point.x * scale, y: 84 + point.y * scale } : undefined
}

function Skeleton({ coords, scale, className }: { coords: Coords; scale: number; className: string }) {
  return (
    <g className={className}>
      {BONES.map(([from, to]) => {
        const a = project(coords, from, scale)
        const b = project(coords, to, scale)
        return a && b ? <line key={`${from}-${to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth="3.2" strokeLinecap="round" /> : null
      })}
    </g>
  )
}

/**
 * What FormPilot learned from the demonstration: the recorded start pose (grey) and finish pose (blue), with the moving
 * joints marked and their path. Only landmark positions are shown; the camera picture is never stored.
 */
export function PoseSketch({ start, finish, className }: { start?: CapturedPose; finish?: CapturedPose; className?: string }) {
  const from = start ? bodyCoords(start.landmarks, start.aspect) : undefined
  const to = finish ? bodyCoords(finish.landmarks, finish.aspect) : undefined
  const model = start && finish ? buildPoseMatch(start, finish).model : undefined
  const all = [from, to].flatMap((coords) => coords ? Object.values(coords) : [])
  const reach = Math.max(1.6, ...all.flatMap((point) => point ? [Math.abs(point.x), Math.abs(point.y)] : []))
  const scale = 52 / reach
  const label = from && to ? '开始姿势与完成姿势对比示意' : from ? '已记录的开始姿势示意' : to ? '已记录的完成姿势示意' : '尚未记录姿势'
  return (
    <svg viewBox="0 0 120 140" className={className} role="img" aria-label={label} data-testid="pose-sketch" data-moving-joints={model?.joints.length ?? 0}>
      <rect x="1" y="1" width="118" height="138" rx="14" className="fill-slate-50 stroke-slate-200" strokeWidth="1" />
      {from ? <Skeleton coords={from} scale={scale} className="stroke-slate-300" /> : null}
      {to ? <Skeleton coords={to} scale={scale} className="stroke-blue-500" /> : null}
      {from && to && model ? model.joints.map((joint) => {
        const a = project(from, joint.name, scale)
        const b = project(to, joint.name, scale)
        return a && b ? (
          <g key={joint.name}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-cyan-500" strokeWidth="1.6" strokeDasharray="2.5 3" strokeLinecap="round" />
            <circle cx={b.x} cy={b.y} r="3.4" className="fill-white stroke-cyan-600" strokeWidth="2" />
          </g>
        ) : null
      }) : null}
      {!from && !to ? <text x="60" y="74" textAnchor="middle" className="fill-slate-400" fontSize="9">尚未记录</text> : null}
    </svg>
  )
}
