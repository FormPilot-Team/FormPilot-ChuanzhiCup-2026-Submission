import type { LandmarkName } from '../../features/pose/types'
import { buildPoseMatch } from '../../features/workshop/recognition/poseMatch'
import type { CapturedPose } from '../../features/workshop/types'
import { SKETCH_VIEWBOX, layoutSketch, neutralFigure, sketchFigure, sketchMovers, type SketchFigure, type SketchLayout, type SketchLimb } from './poseSketchFigure'

type Point = LandmarkName | 'neck' | 'pelvis'

const LIMB_BONES: Readonly<Record<SketchLimb, ReadonlyArray<readonly [Point, Point]>>> = {
  leftArm: [['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist']],
  rightArm: [['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist']],
  leftLeg: [['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle']],
  rightLeg: [['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle']],
}

type Tone = 'ghost' | 'start' | 'finish' | 'neutral'

const TONES: Readonly<Record<Tone, { stroke: string; torso: string; head: string; width: number }>> = {
  ghost: { stroke: 'stroke-slate-300', torso: 'fill-slate-100 stroke-slate-300', head: 'fill-slate-100 stroke-slate-300', width: 5 },
  start: { stroke: 'stroke-slate-400', torso: 'fill-slate-100 stroke-slate-400', head: 'fill-slate-100 stroke-slate-400', width: 5.5 },
  finish: { stroke: 'stroke-blue-500', torso: 'fill-blue-100 stroke-blue-500', head: 'fill-blue-100 stroke-blue-500', width: 5.5 },
  neutral: { stroke: 'stroke-slate-300', torso: 'fill-slate-50 stroke-slate-300', head: 'fill-slate-50 stroke-slate-300', width: 5 },
}

function Figure({ figure, layout, tone, testId }: { figure: SketchFigure; layout: SketchLayout; tone: Tone; testId: string }) {
  const style = TONES[tone]
  const at = (name: Point) => layout.project(figure.joints[name])
  const torso = (['leftShoulder', 'rightShoulder', 'rightHip', 'leftHip'] as const).map((name) => at(name)).map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const head = layout.project(figure.head.center)
  return (
    <g data-testid={testId} strokeLinecap="round" strokeLinejoin="round">
      {(Object.keys(LIMB_BONES) as SketchLimb[]).map((limb) => (
        <g key={limb} data-limb={limb} data-estimated={figure.estimated.includes(limb) ? 'true' : undefined} opacity={figure.estimated.includes(limb) ? 0.45 : undefined}>
          {LIMB_BONES[limb].map(([from, to]) => {
            const a = at(from)
            const b = at(to)
            return <line key={`${from}-${to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={style.stroke} strokeWidth={style.width} strokeDasharray={figure.estimated.includes(limb) ? '1 7' : undefined} />
          })}
        </g>
      ))}
      <polygon points={torso} className={style.torso} strokeWidth={style.width * 0.7} />
      <circle cx={head.x} cy={head.y} r={figure.head.radius * layout.scale} className={style.head} strokeWidth={style.width * 0.6} data-part="head" />
    </g>
  )
}

/**
 * What FormPilot learned from the demonstration, as a small figure: the recorded start pose (grey) and finish pose
 * (blue), with the main moving joints marked and their path. Limb directions come from the recorded landmarks and are
 * drawn on standard body proportions (see poseSketchFigure.ts); the camera picture is never stored. A pose that cannot be
 * drawn faithfully is shown as a neutral standard figure instead of a distorted one.
 */
export function PoseSketch({ start, finish, className }: { start?: CapturedPose; finish?: CapturedPose; className?: string }) {
  const from = start ? sketchFigure(start) : undefined
  const to = finish ? sketchFigure(finish) : undefined
  const fromFigure = from?.kind === 'pose' ? from.figure : undefined
  const toFigure = to?.kind === 'pose' ? to.figure : undefined
  const model = start && finish ? buildPoseMatch(start, finish).model : undefined
  const recorded = Boolean(start || finish)
  const placeholder = recorded && !fromFigure && !toFigure
  const figures = placeholder ? [neutralFigure()] : [fromFigure, toFigure].filter((figure): figure is SketchFigure => Boolean(figure))
  const layout = layoutSketch(figures.length ? figures : [neutralFigure()])
  const movers = fromFigure && toFigure ? sketchMovers(fromFigure, toFigure) : []
  const variant = placeholder ? 'placeholder' : fromFigure && toFigure ? 'comparison' : fromFigure || toFigure ? 'single' : 'empty'
  const label = placeholder ? '示范姿势记录不完整，显示标准人形示意'
    : fromFigure && toFigure ? '开始姿势与完成姿势对比示意'
      : fromFigure ? '已记录的开始姿势示意'
        : toFigure ? '已记录的完成姿势示意' : '尚未记录姿势'
  const { width, height } = SKETCH_VIEWBOX
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={label} data-testid="pose-sketch" data-sketch={variant} data-moving-joints={model?.joints.length ?? 0}>
      <rect x="1" y="1" width={width - 2} height={height - 2} rx="14" className="fill-slate-50 stroke-slate-200" strokeWidth="1" />
      {placeholder ? <Figure figure={figures[0]} layout={layout} tone="neutral" testId="pose-sketch-neutral" /> : null}
      {fromFigure ? <Figure figure={fromFigure} layout={layout} tone={toFigure ? 'ghost' : 'start'} testId="pose-sketch-start" /> : null}
      {toFigure ? <Figure figure={toFigure} layout={layout} tone="finish" testId="pose-sketch-finish" /> : null}
      {fromFigure && toFigure ? movers.map((name) => {
        const a = layout.project(fromFigure.joints[name])
        const b = layout.project(toFigure.joints[name])
        return (
          <g key={name} data-mover={name}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-cyan-500" strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" />
            <circle cx={b.x} cy={b.y} r="4.2" className="fill-white stroke-cyan-600" strokeWidth="2.4" />
          </g>
        )
      }) : null}
      {!recorded ? <text x={width / 2} y={height / 2 + 4} textAnchor="middle" className="fill-slate-400" fontSize="11">尚未记录</text> : null}
    </svg>
  )
}
