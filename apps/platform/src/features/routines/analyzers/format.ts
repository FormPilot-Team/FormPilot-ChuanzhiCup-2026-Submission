import type { AnalyzerFeedbackItem, MetricResult } from './types'

/** Shared wording helpers: every analyzer quotes measured values the same way. */

export function percentText(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

export function secondsText(value: number): string {
  return `${Math.abs(value).toFixed(1)} 秒`
}

/** Feedback for the weakest scored metric first; information-only items last, in their original order. */
export function orderFeedback(entries: ReadonlyArray<{ metric: MetricResult; item: AnalyzerFeedbackItem | null }>): AnalyzerFeedbackItem[] {
  return entries
    .map((entry, index) => ({ ...entry, index, order: entry.metric.evaluated && entry.metric.score !== null ? entry.metric.score : 101 }))
    .filter((entry): entry is typeof entry & { item: AnalyzerFeedbackItem } => entry.item !== null)
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((entry) => entry.item)
}
