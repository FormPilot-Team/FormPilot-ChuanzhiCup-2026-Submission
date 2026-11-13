import type { HistoryEntry } from '../../features/history/historyEntries'
import {
  entryDurationMs, entryReportPath, entrySource, formatDuration, formatEntryDate, historyEntryHeadline, historyEntryTitle,
} from '../../features/web/webHistory'

const SYMBOL = { training: '✦', routine: '◒' } as const
const SYMBOL_BACKGROUND = { training: undefined, routine: 'rgba(167,139,250,.14)' } as const
const SCORE_COLOR = { training: '#4f8fdf', routine: '#8b70df' } as const

/** One design `.history-item` for a real saved session; the result text is the report's own headline. */
export function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const source = entrySource(entry)
  const title = historyEntryTitle(entry)
  return (
    <div className="history-item" data-testid={`web-history-${entry.id}`}>
      <div className="history-symbol" style={{ background: SYMBOL_BACKGROUND[source] }} aria-hidden="true">{SYMBOL[source]}</div>
      <div className="history-main"><strong>{title}</strong><span>{formatEntryDate(entry.startedAt)} · {formatDuration(entryDurationMs(entry))}{entry.incomplete ? ' · 未完整结束' : ''}</span></div>
      <span className="history-score" style={{ color: SCORE_COLOR[source] }}>{historyEntryHeadline(entry)}</span>
      <a className="icon-btn" href={entryReportPath(entry)} aria-label={`查看报告：${title}`}>→</a>
    </div>
  )
}
