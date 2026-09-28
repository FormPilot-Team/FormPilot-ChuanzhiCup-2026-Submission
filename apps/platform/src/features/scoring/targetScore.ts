import type { CriterionTarget, WindowAggregation } from './types'

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** 0–100 for a value against a criterion target (full marks on the right side, linear to 0 at the tolerance). */
export function targetScore(value: number, target: CriterionTarget): number {
  if (!Number.isFinite(value)) return 0
  if (target.kind === 'atLeast') {
    if (value >= target.value) return 100
    return 100 * clamp01((value - target.zeroAt) / (target.value - target.zeroAt))
  }
  if (target.kind === 'atMost') {
    if (value <= target.value) return 100
    return 100 * clamp01((target.zeroAt - value) / (target.zeroAt - target.value))
  }
  if (value < target.min) return 100 * clamp01(1 - (target.min - value) / target.tolerance)
  if (value > target.max) return 100 * clamp01(1 - (value - target.max) / target.tolerance)
  return 100
}

export function meetsTarget(value: number, target: CriterionTarget): boolean {
  return targetScore(value, target) >= 100
}

function formatNumber(value: number): string {
  const abs = Math.abs(value)
  const digits = abs >= 20 ? 0 : abs >= 2 ? 1 : 2
  return Number(value.toFixed(digits)).toString()
}

/** Unit suffix without a space for degrees, with one for words (躯干长, 秒). */
export function withUnit(value: number, unit: string): string {
  const number = formatNumber(value)
  if (!unit) return number
  return unit === '°' || unit === '%' ? `${number}${unit}` : `${number} ${unit}`
}

/** “≥ 150°”, “≤ 0.3”, “2–4 秒”. */
export function targetText(target: CriterionTarget): string {
  if (target.kind === 'atLeast') return `≥ ${withUnit(target.value, target.unit)}`
  if (target.kind === 'atMost') return `≤ ${withUnit(target.value, target.unit)}`
  return `${formatNumber(target.min)}–${withUnit(target.max, target.unit)}`
}

function percentile(sorted: readonly number[], q: number): number {
  const index = (sorted.length - 1) * q
  const low = Math.floor(index)
  const high = Math.ceil(index)
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low)
}

/** One observation from a window's samples; null when there are none. */
export function aggregateSamples(values: readonly number[], aggregation: WindowAggregation): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  switch (aggregation) {
    case 'high': return percentile(sorted, 0.75)
    case 'low': return percentile(sorted, 0.25)
    case 'typical': return percentile(sorted, 0.5)
    case 'spread': return percentile(sorted, 0.9) - percentile(sorted, 0.1)
  }
}
