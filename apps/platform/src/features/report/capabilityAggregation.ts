import type { ExerciseId } from '../exercises/types'
import { CAPABILITY_LABELS } from './presentation'
import type { CapabilitySummaryItem, ExerciseReportSummary, ReportCapabilityDimension } from './types'

interface CapabilitySource {
  exerciseId: ExerciseId
  metricKeys: string[]
}

export const CAPABILITY_MAPPING: Record<ReportCapabilityDimension, ReadonlyArray<CapabilitySource>> = {
  AMPLITUDE: [
    { exerciseId: 'overhead_raise', metricKeys: ['amplitude'] }, { exerciseId: 'lateral_raise', metricKeys: ['amplitude'] },
    { exerciseId: 'step_jack', metricKeys: ['amplitude'] }, { exerciseId: 'squat', metricKeys: ['amplitude'] },
    { exerciseId: 'knee_raise', metricKeys: ['amplitude'] },
  ],
  STABILITY: [
    { exerciseId: 'overhead_raise', metricKeys: ['stability'] }, { exerciseId: 'lateral_raise', metricKeys: ['stability'] },
    { exerciseId: 'step_jack', metricKeys: ['stability'] }, { exerciseId: 'squat', metricKeys: ['stability'] },
    { exerciseId: 'knee_raise', metricKeys: ['stability'] },
  ],
  COORDINATION: [
    { exerciseId: 'overhead_raise', metricKeys: ['synchronization'] }, { exerciseId: 'lateral_raise', metricKeys: ['symmetry'] },
    { exerciseId: 'step_jack', metricKeys: ['coordination'] }, { exerciseId: 'squat', metricKeys: ['symmetry'] },
    { exerciseId: 'knee_raise', metricKeys: ['alternation', 'symmetry'] },
  ],
  TEMPO: [
    { exerciseId: 'overhead_raise', metricKeys: ['tempo'] }, { exerciseId: 'lateral_raise', metricKeys: ['tempo'] },
    { exerciseId: 'step_jack', metricKeys: ['tempo'] }, { exerciseId: 'squat', metricKeys: ['tempo'] },
    { exerciseId: 'knee_raise', metricKeys: ['tempo'] },
  ],
  CONTROL: [
    { exerciseId: 'overhead_raise', metricKeys: ['completion'] }, { exerciseId: 'lateral_raise', metricKeys: ['completion'] },
    { exerciseId: 'step_jack', metricKeys: ['completion'] }, { exerciseId: 'squat', metricKeys: ['completion'] },
    { exerciseId: 'knee_raise', metricKeys: ['completion'] },
  ],
}

function mean(values: number[]): number | null {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null
}

export function aggregateCapabilities(summaries: ReadonlyArray<ExerciseReportSummary>): CapabilitySummaryItem[] {
  const byId = new Map(summaries.map((summary) => [summary.exerciseId, summary]))
  return (Object.keys(CAPABILITY_MAPPING) as ReportCapabilityDimension[]).map((dimension) => {
    const sources = CAPABILITY_MAPPING[dimension]
    const contributions = sources.flatMap((source) => {
      const summary = byId.get(source.exerciseId)
      if (!summary || summary.completion !== 'completed') return []
      const values = source.metricKeys
        .map((key) => summary.metrics.find((metric) => metric.key === key)?.value)
        .filter((value): value is number => value !== null && value !== undefined)
      const value = mean(values)
      return value === null ? [] : [{ exerciseId: source.exerciseId, metricKeys: source.metricKeys, value }]
    })
    return {
      dimension,
      label: CAPABILITY_LABELS[dimension],
      value: mean(contributions.map((item) => item.value)),
      sampleCount: contributions.length,
      availableExerciseCount: contributions.length,
      totalExerciseCount: sources.length,
      contributions,
    }
  })
}
