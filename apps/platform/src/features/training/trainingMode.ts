import type { TrainingMode } from './types'

export function resolveTrainingMode(requestedFast: boolean, development = import.meta.env.DEV): TrainingMode {
  return requestedFast && development ? 'fast' : 'normal'
}
