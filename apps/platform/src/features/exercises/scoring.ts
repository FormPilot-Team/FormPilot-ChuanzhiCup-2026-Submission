import { clamp } from '../motion/geometry'
import type { MetricScore } from './types'

export function metricScore(value: number, score: number, unit: string, valid = true): MetricScore {
  return { value, score: Math.round(clamp(score, 0, 100)), unit, valid }
}

export function bandScore(value: number, min: number, max: number, falloff: number): number {
  if (value >= min && value <= max) return 100
  if (value < min) return 100 * clamp((value - (min - falloff)) / falloff)
  return 100 * clamp(((max + falloff) - value) / falloff)
}

export function lowerIsBetterScore(value: number, idealMax: number, zeroAt: number): number {
  if (value <= idealMax) return 100
  return 100 * clamp((zeroAt - value) / (zeroAt - idealMax))
}

export function thresholdScore(value: number, threshold: number, zeroAt: number): number {
  if (value >= threshold) return 100
  return 100 * clamp((value - zeroAt) / (threshold - zeroAt))
}
