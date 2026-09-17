import type { CapabilitySummaryItem } from '../../features/report/types'

interface CapabilityRadarProps {
  capabilities: ReadonlyArray<CapabilitySummaryItem>
}

const CENTER_X = 180
const CENTER_Y = 150
const RADIUS = 104

function point(index: number, value: number) {
  const angle = -Math.PI / 2 + index * (Math.PI * 2 / 5)
  const radius = RADIUS * Math.max(0, Math.min(100, value)) / 100
  return { x: CENTER_X + Math.cos(angle) * radius, y: CENTER_Y + Math.sin(angle) * radius }
}

function polygon(values: number[]): string {
  return values.map((value, index) => {
    const item = point(index, value)
    return `${item.x.toFixed(1)},${item.y.toFixed(1)}`
  }).join(' ')
}

export function CapabilityRadar({ capabilities }: CapabilityRadarProps) {
  const values = capabilities.map((item) => item.value ?? 0)
  return (
    <svg className="mx-auto block h-auto w-full max-w-[420px]" viewBox="-20 -15 400 350" role="img" aria-labelledby="radar-title radar-description" data-testid="capability-radar">
      <title id="radar-title">五项训练能力分布</title>
      <desc id="radar-description">0 到 100 分，包括动作幅度、稳定性、协调与对称、节奏和完整控制。下方同时提供文字数值。</desc>
      {[20, 40, 60, 80, 100].map((level) => (
        <polygon key={level} points={polygon(Array(5).fill(level))} fill="none" stroke="#dbeafe" strokeWidth="1" />
      ))}
      {capabilities.map((_, index) => {
        const outer = point(index, 100)
        return <line key={index} x1={CENTER_X} y1={CENTER_Y} x2={outer.x} y2={outer.y} stroke="#e2e8f0" strokeWidth="1" />
      })}
      <polygon points={polygon(values)} fill="rgb(59 130 246 / 0.16)" stroke="#3b82f6" strokeWidth="3" strokeLinejoin="round" />
      {values.map((value, index) => {
        const item = point(index, value)
        return <circle key={index} cx={item.x} cy={item.y} r="4" fill="#fff" stroke="#2563eb" strokeWidth="3" />
      })}
      {capabilities.map((capability, index) => {
        const labelPoint = point(index, 135)
        return (
          <g key={capability.dimension} className="max-sm:hidden">
            <text x={labelPoint.x} y={labelPoint.y} textAnchor="middle" dominantBaseline="middle" fill="#475569" fontSize="11" fontWeight="600">{capability.label}</text>
            <text x={labelPoint.x} y={labelPoint.y + 16} textAnchor="middle" dominantBaseline="middle" fill="#2563eb" fontSize="11" fontWeight="700">{capability.value ?? '—'}</text>
          </g>
        )
      })}
    </svg>
  )
}
