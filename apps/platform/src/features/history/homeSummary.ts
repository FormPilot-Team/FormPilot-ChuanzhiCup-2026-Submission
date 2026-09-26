import { historyEntryHeadline, historyEntryTitle, type HistoryEntry } from './historyEntries'

export interface HomeTrainingDay {
  /** Local calendar date, YYYY-MM-DD. */
  key: string
  /** 一 … 日 */
  label: string
  count: number
  today: boolean
  future: boolean
}

export interface HomeLatestTraining {
  id: string
  title: string
  headline: string
  startedAt: number
}

/** "我的训练" on Home: the latest finished training and this week's rhythm. Only finished trainings count. */
export interface HomeTrainingSummary {
  latest?: HomeLatestTraining
  weekCount: number
  previousWeekCount: number
  week: HomeTrainingDay[]
  finishedCount: number
}

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Local Monday 00:00 of the week containing `timestamp`. */
export function startOfLocalWeek(timestamp: number): Date {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return date
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function buildHomeTrainingSummary(entries: readonly HistoryEntry[], now: number): HomeTrainingSummary {
  const finished = entries.filter((entry) => !entry.incomplete)
  const latestEntry = finished[0]
  const weekStart = startOfLocalWeek(now)
  const nextWeekStart = addDays(weekStart, 7)
  const previousWeekStart = addDays(weekStart, -7)
  const todayKey = dayKey(new Date(now))
  const counts = new Map<string, number>()
  let weekCount = 0
  let previousWeekCount = 0
  for (const entry of finished) {
    if (entry.startedAt >= weekStart.getTime() && entry.startedAt < nextWeekStart.getTime()) {
      weekCount += 1
      const key = dayKey(new Date(entry.startedAt))
      counts.set(key, (counts.get(key) ?? 0) + 1)
    } else if (entry.startedAt >= previousWeekStart.getTime() && entry.startedAt < weekStart.getTime()) {
      previousWeekCount += 1
    }
  }
  const week = DAY_LABELS.map((label, index) => {
    const date = addDays(weekStart, index)
    const key = dayKey(date)
    return { key, label, count: counts.get(key) ?? 0, today: key === todayKey, future: date.getTime() > now && key !== todayKey }
  })
  return {
    latest: latestEntry ? {
      id: latestEntry.id,
      title: historyEntryTitle(latestEntry),
      headline: historyEntryHeadline(latestEntry),
      startedAt: latestEntry.startedAt,
    } : undefined,
    weekCount,
    previousWeekCount,
    week,
    finishedCount: finished.length,
  }
}

/** Week-over-week change in plain words; nothing when neither week has a finished training. */
export function weekChangeText(summary: Pick<HomeTrainingSummary, 'weekCount' | 'previousWeekCount'>): string | null {
  const { weekCount, previousWeekCount } = summary
  if (weekCount === 0 && previousWeekCount === 0) return null
  if (previousWeekCount === 0) return '上周没有完成的训练'
  const delta = weekCount - previousWeekCount
  if (delta === 0) return '与上周持平'
  return delta > 0 ? `比上周多 ${delta} 次` : `比上周少 ${Math.abs(delta)} 次`
}
