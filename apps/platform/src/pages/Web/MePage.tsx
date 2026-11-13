import { useMemo, useState } from 'react'
import { GAMES_PATH, HISTORY_PATH, ME_SETTINGS_PATH, TRAINING_CENTER_PATH, WORKSHOP_PATH } from '../../app/routes'
import { StatusPill, WebEmpty, WebShell } from '../../components/web/WebShell'
import { isReliableFullCourse } from '../../features/history/TrainingHistory'
import type { HistoryEntry } from '../../features/history/historyEntries'
import { entrySource, loadWebHistory, type WebHistoryRepositories } from '../../features/web/webHistory'
import { HistoryRow } from './webParts'

type MeFilter = 'all' | 'training' | 'routine' | 'game'
const FILTERS: ReadonlyArray<[MeFilter, string]> = [['all', '全部'], ['training', '训练中心'], ['routine', '功法'], ['game', '游戏']]

interface TrendPoint { id: string; startedAt: number; score: number }

/**
 * Formal trend = the reliable full warm-up course score (the same rule History uses for its overview).
 * Shown only with at least two such sessions; game scores never enter it.
 */
export function formalTrend(entries: readonly HistoryEntry[]): TrendPoint[] {
  return entries
    .filter((entry): entry is Extract<HistoryEntry, { kind: 'smart' }> => entry.kind === 'smart' && !entry.incomplete && isReliableFullCourse(entry.smart.analysis))
    .slice(0, 7)
    .map((entry) => ({ id: entry.id, startedAt: entry.startedAt, score: entry.smart.analysis.overall.score ?? 0 }))
    .reverse()
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  const width = 420
  const step = points.length > 1 ? (width - 24) / (points.length - 1) : 0
  const y = (score: number) => 132 - (Math.max(0, Math.min(100, score)) / 100) * 114
  const coords = points.map((point, index) => ({ x: 12 + index * step, y: y(point.score) }))
  const line = coords.map(({ x, y: py }) => `${x.toFixed(1)},${py.toFixed(1)}`).join(' ')
  const area = `12,132 ${line} ${(12 + (points.length - 1) * step).toFixed(1)},132`
  return (
    <div className="trend-chart" data-testid="me-trend">
      <svg viewBox="0 0 420 152" role="img" aria-label={`热身完整训练综合评分：${points.map((point) => point.score).join('、')}`}>
        <defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#79b8ff" stopOpacity=".55" /><stop offset="100%" stopColor="#79b8ff" stopOpacity="0" /></linearGradient></defs>
        <g className="trend-grid"><line x1="0" y1="18" x2="420" y2="18" /><line x1="0" y1="56" x2="420" y2="56" /><line x1="0" y1="94" x2="420" y2="94" /><line x1="0" y1="132" x2="420" y2="132" /></g>
        <polygon className="trend-area" points={area} />
        <polyline className="trend-line" points={line} />
        <g className="trend-value">{coords.map(({ x, y: py }, index) => <text key={points[index].id} x={x} y={py - 10} textAnchor="middle">{points[index].score}</text>)}</g>
        <g>{coords.map(({ x, y: py }, index) => <circle key={points[index].id} className="trend-point" cx={x} cy={py} r="4" />)}</g>
      </svg>
      <div className="trend-labels" style={{ gridTemplateColumns: `repeat(${points.length},1fr)` }}>{points.map((point) => { const date = new Date(point.startedAt); return <span key={point.id}>{date.getMonth() + 1}/{date.getDate()}</span> })}</div>
    </div>
  )
}

/** 我的: personal data assets. Everything shown is read from this browser's local records. */
export function MePage({ repositories, now }: { repositories?: WebHistoryRepositories; now?: number }) {
  const [filter, setFilter] = useState<MeFilter>('all')
  const history = useMemo(() => loadWebHistory(repositories, now ?? Date.now()), [repositories, now])
  const filtered = filter === 'game' ? [] : history.entries.filter((entry) => filter === 'all' || entrySource(entry) === filter)
  const trend = useMemo(() => formalTrend(history.entries), [history.entries])

  return (
    <WebShell active="me" testId="web-me">
      <div className="me-head glass card">
        <div className="profile-block">
          <div className="profile-avatar" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2" /><path d="M5.5 19.2a6.8 6.8 0 0 1 13 0" /></svg></div>
          <div><div className="eyebrow">MY SPACE · 本机数据</div><h1 className="profile-title">我的训练空间</h1><p className="tiny" style={{ marginTop: 6 }}>连续训练 {history.streakDays} 天 · 数据只保存在此浏览器，不上传</p></div>
        </div>
        <div className="profile-stats" data-testid="me-stats">
          <div className="profile-stat"><strong>{history.summary.finishedCount}</strong><span>累计训练</span></div>
          <div className="profile-stat"><strong>{history.summary.weekCount}</strong><span>本周训练</span></div>
          <div className="profile-stat"><strong>{history.actions.length}</strong><span>我的动作</span></div>
        </div>
      </div>

      <div className="section-head"><div><h2>训练历史</h2><p>按时间倒序查看报告，游戏分数单独记录。</p></div>
        <div className="filter-row" role="group" aria-label="按来源筛选">{FILTERS.map(([id, label]) => <button key={id} type="button" className={`filter${filter === id ? ' active' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)} data-testid={`me-filter-${id}`}>{label}</button>)}</div>
      </div>
      <section className="me-grid">
        <div className="panel glass card" data-testid="me-history">
          <div className="panel-title"><div><h3>最近记录</h3><p>{filter === 'game' ? '游戏记录' : `共 ${filtered.length} 条本机记录`}</p></div><a className="btn btn-ghost" href={HISTORY_PATH} data-testid="me-history-all">查看全部 →</a></div>
          {filter === 'game' ? (
            <WebEmpty mark="◈" title="游戏成绩不进入训练记录" testId="me-games-empty" action={<a className="btn btn-secondary" href={GAMES_PATH}>去游戏中心</a>}>体感游戏在独立的游戏应用中运行，成绩只在游戏内显示，不与正式训练的完成度和五维能力混合。</WebEmpty>
          ) : filtered.length ? (
            <div className="history-list">{filtered.slice(0, 5).map((entry) => <HistoryRow key={entry.id} entry={entry} />)}</div>
          ) : (
            <WebEmpty mark="✦" title="还没有记录" testId="me-history-empty" action={<a className="btn btn-primary" href={TRAINING_CENTER_PATH}>开始第一次训练</a>}>完成训练后，这里会出现报告入口。</WebEmpty>
          )}
          {history.unavailable ? <p className="tiny" style={{ marginTop: 10 }}>部分本机记录读取失败，已显示可读取的部分。</p> : null}
        </div>
        <div className="panel glass card">
          <div className="panel-title"><div><h3>训练变化</h3><p>满足 2 次可靠的热身完整训练后生成趋势</p></div>{trend.length >= 2 ? <StatusPill tone="blue">可比较</StatusPill> : <StatusPill tone="coral">暂不比较</StatusPill>}</div>
          {trend.length >= 2 ? <TrendChart points={trend} /> : <WebEmpty mark="↗" title="暂无可比较的趋势" testId="me-trend-empty">目前有 {trend.length} 次可靠的热身完整训练。只有完整、正常模式、规则支持的训练才参与趋势；功法、我的动作和游戏不并入这条线。</WebEmpty>}
        </div>
      </section>

      <div className="section-head"><div><h2>我的工具</h2><p>管理动作、设备和隐私。</p></div></div>
      <section className="me-grid">
        <div className="panel glass card">
          <div className="panel-title"><div><h3>动作工坊</h3><p>创建、测试并复用你的动作</p></div><span className="workshop-icon" aria-hidden="true"><img src="/web-v1/assets/workshop-pose-transparent.png" alt="" /></span></div>
          <a className="btn btn-primary" href={WORKSHOP_PATH} data-testid="me-open-workshop">打开动作工坊 →</a>
        </div>
        <div className="panel glass card">
          <div className="panel-title"><div><h3>设备与设置</h3><p>摄像头、语音、数据和隐私</p></div><span style={{ fontSize: 30 }} aria-hidden="true">⚙</span></div>
          <div className="menu-list">
            <a className="menu-item" href={`${ME_SETTINGS_PATH}#camera`} data-testid="me-settings-camera"><span className="menu-item-left"><span className="menu-icon-wrap"><svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5h-5l-1.3 2H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.2L14.5 5Z" /><circle cx="12" cy="12.5" r="3.2" /></svg></span>摄像头与语音</span><span className="chevron">›</span></a>
            <a className="menu-item" href={`${ME_SETTINGS_PATH}#privacy`} data-testid="me-settings-privacy"><span className="menu-item-left"><span className="menu-icon-wrap"><svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.2-2.8 7.9-7 9.5C7.8 18.9 5 15.2 5 11V6l7-3Z" /><path d="m9.2 12 1.8 1.8 3.8-4" /></svg></span>数据与隐私</span><span className="chevron">›</span></a>
          </div>
        </div>
      </section>
    </WebShell>
  )
}
