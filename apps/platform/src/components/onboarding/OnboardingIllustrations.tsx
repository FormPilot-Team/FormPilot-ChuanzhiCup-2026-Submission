import type { JSX } from 'react'
import type { OnboardingStepId } from '../../features/onboarding/onboarding'

const INK = '#334155'
const BODY = '#e2e8f0'
const BLUE = '#2563eb'
const BLUE_SOFT = '#dbeafe'
const AMBER = '#d97706'
const AMBER_SOFT = '#fef3c7'

type Point = readonly [number, number]

/** Front-facing full-body key points shared by the "in frame" illustrations. */
const SKELETON: Record<string, Point> = {
  leftShoulder: [102, 60], rightShoulder: [138, 60],
  leftElbow: [94, 86], rightElbow: [146, 86],
  leftWrist: [90, 110], rightWrist: [150, 110],
  leftHip: [108, 106], rightHip: [132, 106],
  leftKnee: [106, 134], rightKnee: [134, 134],
  leftAnkle: [104, 158], rightAnkle: [136, 158],
}

const BONES: ReadonlyArray<readonly [string, string]> = [
  ['leftShoulder', 'rightShoulder'], ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'], ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'], ['leftHip', 'rightHip'], ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'],
]

function Skeleton() {
  return (
    <g>
      <circle cx="120" cy="36" r="11" fill="#fff" stroke={INK} strokeWidth="4" />
      {BONES.map(([from, to]) => (
        <line key={`${from}-${to}`} x1={SKELETON[from][0]} y1={SKELETON[from][1]} x2={SKELETON[to][0]} y2={SKELETON[to][1]} stroke={INK} strokeWidth="5" strokeLinecap="round" />
      ))}
      {Object.entries(SKELETON).map(([name, [x, y]]) => <circle key={name} cx={x} cy={y} r="4.5" fill={BLUE} stroke="#fff" strokeWidth="2" />)}
    </g>
  )
}

/** Upper body used by the two gesture illustrations; the arms are drawn by each gesture. */
function UpperBody({ halo }: { halo: string }) {
  return (
    <g>
      <circle cx="120" cy="98" r="78" fill={halo} />
      <path d="M86 82 C86 74 154 74 154 82 L147 158 Q120 164 93 158 Z" fill={BODY} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M120 60 V72" stroke={INK} strokeWidth="8" strokeLinecap="round" />
      <circle cx="120" cy="42" r="18" fill="#fff" stroke={INK} strokeWidth="4" />
    </g>
  )
}

function WelcomeIllustration() {
  return (
    <svg viewBox="0 0 240 180" className="h-auto w-full" role="img" aria-label="示意图：摄像头识别身体关键点，提供语音指导和训练报告">
      <rect x="58" y="12" width="124" height="156" rx="18" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="2" />
      <Skeleton />
      <rect x="186" y="40" width="44" height="32" rx="10" fill={BLUE_SOFT} />
      <path d="M194 72 L190 82 L202 72 Z" fill={BLUE_SOFT} />
      {[0, 1, 2].map((index) => <line key={index} x1={198 + index * 10} x2={198 + index * 10} y1={index === 1 ? 49 : 52} y2={index === 1 ? 63 : 60} stroke={BLUE} strokeWidth="3.5" strokeLinecap="round" />)}
      <rect x="10" y="104" width="44" height="54" rx="9" fill="#fff" stroke="#cbd5e1" strokeWidth="2" />
      {[[20, 136], [30, 126], [40, 118]].map(([x, top]) => <line key={x} x1={x} x2={x} y1={148} y2={top} stroke={BLUE} strokeWidth="5" strokeLinecap="round" />)}
    </svg>
  )
}

function StartGestureIllustration() {
  return (
    <svg viewBox="0 0 240 180" className="h-auto w-full" role="img" aria-label="示意图：双手在胸前合拢">
      <UpperBody halo="#eff6ff" />
      <circle cx="120" cy="100" r="26" fill="none" stroke="#93c5fd" strokeWidth="2.5" strokeDasharray="5 5" />
      <path d="M88 86 L72 128 L112 110" fill="none" stroke={BLUE} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M152 86 L168 128 L128 110" fill="none" stroke={BLUE} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M120 80 C112 84 110 98 113 110 L120 113 L127 110 C130 98 128 84 120 80 Z" fill={BLUE_SOFT} stroke={BLUE} strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M120 83 V111" stroke={BLUE} strokeWidth="2" />
    </svg>
  )
}

function PauseGestureIllustration() {
  return (
    <svg viewBox="0 0 240 180" className="h-auto w-full" role="img" aria-label="示意图：双臂在胸前交叉成 X">
      <UpperBody halo="#fffbeb" />
      <circle cx="120" cy="105" r="24" fill={AMBER_SOFT} />
      <path d="M88 86 L74 130 L148 90" fill="none" stroke={AMBER} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M152 86 L166 130" fill="none" stroke={AMBER} strokeWidth="10" strokeLinecap="round" />
      <path d="M132.3 111.7 L107.7 98.3" stroke="#fff" strokeWidth="17" strokeLinecap="round" />
      <path d="M166 130 L92 90" fill="none" stroke={AMBER} strokeWidth="10" strokeLinecap="round" />
      <circle cx="148" cy="90" r="6.5" fill={AMBER_SOFT} stroke={AMBER} strokeWidth="3" />
      <circle cx="92" cy="90" r="6.5" fill={AMBER_SOFT} stroke={AMBER} strokeWidth="3" />
    </svg>
  )
}

function FramingIllustration() {
  const corner = { fill: 'none', stroke: BLUE, strokeWidth: 4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 240 180" className="h-auto w-full" role="img" aria-label="示意图：身体完整进入摄像头画面">
      <rect x="44" y="8" width="152" height="164" rx="18" fill="#f8fafc" />
      <path d="M52 36 V24 Q52 16 60 16 H72" {...corner} />
      <path d="M168 16 H180 Q188 16 188 24 V36" {...corner} />
      <path d="M188 144 V156 Q188 164 180 164 H168" {...corner} />
      <path d="M72 164 H60 Q52 164 52 156 V144" {...corner} />
      <Skeleton />
      <circle cx="196" cy="22" r="13" fill="#10b981" />
      <path d="M190 22 L194.5 26.5 L202.5 17.5" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const ILLUSTRATIONS: Record<OnboardingStepId, () => JSX.Element> = {
  welcome: WelcomeIllustration,
  'start-gesture': StartGestureIllustration,
  'pause-gesture': PauseGestureIllustration,
  framing: FramingIllustration,
}

export function OnboardingIllustration({ stepId }: { stepId: OnboardingStepId }) {
  const Illustration = ILLUSTRATIONS[stepId]
  return <Illustration />
}

/** The pose-in-frame mark reused on the Home smart-training card. */
export function PoseRecognitionIllustration() {
  return <WelcomeIllustration />
}
