import { ANALYSIS_CONFIG_V1 } from './config'
import type { AnalyzedRep } from './issueEvidence'
import { tempoBandMs } from './issueTaxonomy'
import type { ScoredExerciseId, TempoAnalysis } from './types'

const TEMPO = ANALYSIS_CONFIG_V1.tempo

/**
 * 8F-1A §14 tempo direction. Only states whether single-rep durations were fast, slow or inside the recommended
 * band; it never claims the rhythm was "steady".
 */
export function analyzeTempo(exerciseId: ScoredExerciseId, analyzed: readonly AnalyzedRep[], enabled = true): TempoAnalysis {
  const bandMs = tempoBandMs(exerciseId)
  if (!enabled) return { direction: null, fast: 0, slow: 0, inBand: 0, bandMs }
  let fast = 0
  let slow = 0
  let inBand = 0
  for (const item of analyzed) {
    const duration = item.result.rep.durationMs
    if (duration < bandMs[0]) fast += 1
    else if (duration > bandMs[1]) slow += 1
    else inBand += 1
  }
  const n = fast + slow + inBand
  const leaning = (count: number, other: number) => count >= TEMPO.directionMinCount
    && count * TEMPO.directionMinRate.den >= n * TEMPO.directionMinRate.num
    && count > other
  let direction: TempoAnalysis['direction'] = null
  if (n >= TEMPO.directionMinReps) {
    if (leaning(fast, slow)) direction = 'TOO_FAST'
    else if (leaning(slow, fast)) direction = 'TOO_SLOW'
    else if (inBand * TEMPO.appropriateMinRate.den >= n * TEMPO.appropriateMinRate.num) direction = 'APPROPRIATE'
  }
  return { direction, fast, slow, inBand, bandMs }
}
