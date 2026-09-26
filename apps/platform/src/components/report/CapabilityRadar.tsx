import type { CapabilityDimensionAnalysis } from '../../features/analysis'

interface CapabilityRadarProps {
  dimensions: readonly CapabilityDimensionAnalysis[]
}

const CENTER_X = 180
const CENTER_Y = 150
const RADIUS = 104

function point(index: number, value: number) {
  const angle = -Math.PI / 2 + index * (Math.PI * 2 / 5)
  const radius = RADIUS * Math.max(0, Math.min(100, value)) / 100
  return { x: CENTER_X + Math.cos(angle) * radius, y: CENTER_Y + Math.sin(angle) * radius }
}

function polygon(values: readonly number[]): string {
  return values.map((value, index) => {
    const item = point(index, value)
    return `${item.x.toFixed(1)},${item.y.toFixed(1)}`
  }).join(' ')
}

export function CapabilityRadar({ dimensions }: CapabilityRadarProps) {
  const comparable = dimensions.length === 5 && dimensions.every((item) => item.comparison !== null)
  const current = dimensions.map((item) => comparable ? item.comparison?.current ?? 0 : item.value ?? 0)
  const previous = comparable ? dimensions.map((item) => item.comparison?.previous ?? 0) : null
  const description = comparable
    ? `五项能力共同动作范围对比。本次为 ${dimensions.map((item, index) => `${item.label} ${current[index]} 分`).join('、')}；上次为 ${dimensions.map((item, index) => `${item.label} ${previous?.[index] ?? 0} 分`).join('、')}。`
    : `本次五项训练能力分布：${dimensions.map((item, index) => `${item.label} ${current[index]} 分`).join('、')}。`

  return (
    <svg className="mx-auto block h-auto w-full max-w-[400px]" viewBox="-20 -15 400 350" role="img" aria-labelledby="radar-title radar-description" data-testid="capability-radar">
      <title id="radar-title">五项训练能力分布</title>
      <desc id="radar-description">{description}</desc>
      {[20, 40, 60, 80, 100].map((level) => (
        <polygon key={level} points={polygon(Array(5).fill(level))} fill="none" stroke="#dbe3ed" strokeWidth="1" />
      ))}
      {dimensions.map((_, index) => {
        const outer = point(index, 100)
        return <line key={index} x1={CENTER_X} y1={CENTER_Y} x2={outer.x} y2={outer.y} stroke="#e2e8f0" strokeWidth="1" />
      })}
      {previous ? <polygon points={polygon(previous)} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 5" strokeLinejoin="round" /> : null}
      <polygon points={polygon(current)} fill="rgb(37 99 235 / 0.13)" stroke="#2563eb" strokeWidth="3" strokeLinejoin="round" />
      {current.map((value, index) => {
        const item = point(index, value)
        return <circle key={dimensions[index].dimension} cx={item.x} cy={item.y} r="4" fill="#fff" stroke="#2563eb" strokeWidth="3" />
      })}
      {dimensions.map((dimension, index) => {
        const labelPoint = point(index, 132)
        return (
          <g key={dimension.dimension} className="max-sm:hidden">
            <text x={labelPoint.x} y={labelPoint.y} textAnchor="middle" dominantBaseline="middle" fill="#475569" fontSize="11" fontWeight="600">{dimension.label}</text>
            <text x={labelPoint.x} y={labelPoint.y + 16} textAnchor="middle" dominantBaseline="middle" fill="#1d4ed8" fontSize="11" fontWeight="700">{current[index]}</text>
          </g>
        )
      })}
    </svg>
  )
}
