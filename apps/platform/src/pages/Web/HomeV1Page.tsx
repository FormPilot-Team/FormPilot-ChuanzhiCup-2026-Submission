import { useMemo } from 'react'
import { COACH_PATH, GAMES_PATH, HISTORY_PATH, ROUTINES_PATH, SMART_TRAINING_PATH, TRAINING_CENTER_PATH } from '../../app/routes'
import { StatusPill, WebEmpty, WebShell } from '../../components/web/WebShell'
import { ROUTINE_PROGRAMS } from '../../features/routines/programs'
import { WEB_GAMES } from '../../features/web/games'
import {
  entryDurationMs, entryReportPath, entryRetrainPath, formatDuration, formatEntryDate, historyEntryHeadline, historyEntryTitle,
  loadWebHistory, type WebHistoryRepositories,
} from '../../features/web/webHistory'
import { FREE_TRAINING_OPTIONS } from '../SmartTraining/freeTrainingOptions'
import { HistoryRow } from './webParts'

interface HomeV1PageProps {
  repositories?: WebHistoryRepositories
  now?: number
}

function percent(value: number, total: number): string {
  return `${total > 0 ? Math.round(Math.min(1, value / total) * 100) : 0}%`
}

/**
 * 首页 of Web V1: the #52 hero, unchanged in layout. The floating cards that carried demo health numbers in the
 * prototype (sleep, heart rate, steps, user count) now show the user's own local training facts or catalogue
 * facts; with no history they show 0 and the first-use line, never invented values.
 */
export function HomeV1Page({ repositories, now }: HomeV1PageProps) {
  const clock = now ?? Date.now()
  const history = useMemo(() => loadWebHistory(repositories, clock), [repositories, clock])
  const { summary, finished } = history
  const latest = finished[0]
  const daysThisWeek = summary.week.filter((day) => day.count > 0).length
  const weekPeak = Math.max(1, ...summary.week.map((day) => day.count))
  const latestDuration = latest ? entryDurationMs(latest) : null

  return (
    <WebShell active="home" bare autoOpenGuide testId="web-home">
      <div className="fh-home fh-page fh-landing" id="fh-landing">
        <section className="fh-hero" aria-label="FormPilot 首页">
          <div className="fh-float-card fh-ref-card fh-ref-a" data-testid="home-card-today"><small>今日状态</small><strong>今日训练</strong><div className="fh-metric"><b>{history.todayCount}</b><small>次</small></div></div>
          <div className="fh-float-card fh-ref-card fh-ref-b" data-testid="home-card-week"><small>本周记录</small><strong><span className="fh-mini-icon">♥</span>本周完成</strong><div className="fh-metric"><b>{summary.weekCount}</b><small>次</small></div><div className="fh-mini-progress"><i style={{ width: percent(daysThisWeek, 7) }} /></div></div>
          <div className="fh-float-card fh-ref-card fh-ref-c" data-testid="home-card-latest"><small>最近训练</small><strong>{latest ? historyEntryTitle(latest) : '还没有训练记录'}</strong><div className="fh-metric"><b>{latestDuration === null ? '—' : Math.max(1, Math.round(latestDuration / 60000))}</b><small>分钟</small></div><div className="fh-mini-progress"><i style={{ width: latest ? '100%' : '0%' }} /></div><div className="fh-support-copy">Regular exercise brings countless benefits. It improves cardiovascular health, builds muscle strength and enhances physical endurance.</div></div>
          <div className="fh-float-card fh-ref-card fh-ref-d" data-testid="home-card-days"><small>训练记录</small><strong>本周训练天数</strong><div className="fh-metric"><b>{daysThisWeek} / 7</b><small>天</small></div><div className="fh-mini-progress"><i style={{ width: percent(daysThisWeek, 7) }} /></div>
            <svg className="fh-training-wave" viewBox="0 0 100 50" role="img" aria-label={`本周每天完成次数：${summary.week.map((day) => `周${day.label} ${day.count}`).join('，')}`}>
              {summary.week.map((day, index) => { const x = 6 + index * 14.5; const half = day.count ? 4 + (day.count / weekPeak) * 20 : 0.5; return <line key={day.key} x1={x} y1={25 - half} x2={x} y2={25 + half} /> })}
            </svg>
          </div>
          <div className="fh-float-card fh-ref-card fh-ref-e" data-testid="home-card-streak"><small>坚持记录</small><strong>连续训练</strong><div className="fh-metric"><b>{history.streakDays}</b><small>天</small></div><div className="fh-mini-progress"><i style={{ width: percent(history.streakDays, 7) }} /></div></div>
          <div className="fh-float-card fh-ref-card fh-ref-f" data-testid="home-card-total"><small>累计完成</small><strong>已完成训练</strong><div className="fh-metric"><b>{summary.finishedCount}</b><small>次</small></div><div className="fh-mini-progress"><i style={{ width: summary.finishedCount ? '100%' : '0%' }} /></div><div className="fh-motion-copy">Motion quality is smooth and seamless. Movements are gentle and organic, free of flickering, stuttering or unnatural breaks in the loop.</div></div>
          <div className="fh-float-card fh-ref-card fh-ref-h"><small>功法课程</small><strong>传统功法</strong><div className="fh-metric"><b>{ROUTINE_PROGRAMS.length}</b><small>套</small></div></div>
          <div className="fh-float-card fh-ref-card fh-ref-i"><small>热身训练</small><strong>实时识别动作</strong><div className="fh-metric"><b>{FREE_TRAINING_OPTIONS.length}</b><small>个</small></div></div>
          <div className="fh-float-card fh-ref-card fh-ref-j" data-testid="home-card-actions"><small>动作工坊</small><strong>我的动作</strong><div className="fh-metric"><b>{history.actions.length}</b><small>个</small></div></div>
          <div className="fh-float-card fh-ref-card fh-ref-k" data-testid="home-card-report"><small>最近报告</small><strong>{latest ? historyEntryHeadline(latest) : '完成训练后生成'}</strong></div>
          <div className="fh-float-card fh-ref-card fh-ref-l"><small>识别方式</small><strong>浏览器本地识别</strong><div className="fh-metric"><b>本地</b><small>画面不上传</small></div></div>
          <div className="fh-float-card fh-ref-card fh-ref-m"><small>体感游戏</small><strong>游戏中心</strong><div className="fh-metric"><b>{WEB_GAMES.length}</b><small>款</small></div></div>
          <div className="fh-float-card fh-ref-card fh-ref-n" data-testid="home-card-last-week"><small>上周记录</small><strong>上周完成</strong><div className="fh-metric"><b>{summary.previousWeekCount}</b><small>次</small></div></div>
          <div className="fh-float-card fh-ref-card fh-ref-o"><small>数据保存</small><strong>仅保存在本机</strong></div>
          <div className="fh-hero-copy">
            <div className="fh-eyebrow">Personal training, guided by intelligence</div>
            <h1><strong>FormPilot</strong><span className="fh-subline"><em>AI Coach</em> 伴随训练</span></h1>
            <p>把每一次训练变成可坚持的进步。FormPilot 用 AI Coach 陪你完成热身、功法与恢复，让训练更专注、更有趣。</p>
            <a className="fh-primary" href={TRAINING_CENTER_PATH} data-testid="home-get-started">Get started <span style={{ marginLeft: 8 }}>→</span></a>
          </div>
          <div className="fh-trust" data-testid="home-trust">{summary.finishedCount > 0 ? <>本机已完成 <b>{summary.finishedCount} 次训练</b> · 每天坚持一点，身体就会回应</> : <>完成第一次训练后，这里会出现你的变化 · 每天坚持一点，身体就会回应</>}</div>
        </section>
      </div>

      <div className="page fpw-home-below">
        <div className="section-head"><div><h2>今天练什么</h2><p>从四个板块里选一个开始。</p></div></div>
        <section className="quick-grid" aria-label="快捷入口">
          <a className="quick-card glass card accent-blue" href={TRAINING_CENTER_PATH} data-testid="home-quick-training"><div className="mini-icon" aria-hidden="true">✦</div><h3>训练中心</h3><p>智能训练、自由训练和我的动作。</p><span className="arrow" aria-hidden="true">→</span></a>
          <a className="quick-card glass card accent-violet" href={ROUTINES_PATH} data-testid="home-quick-routines"><div className="mini-icon" aria-hidden="true">◒</div><h3>功法训练</h3><p>八段锦、太极拳、五禽戏、易筋经。</p><span className="arrow" aria-hidden="true">→</span></a>
          <a className="quick-card glass card accent-coral" href={GAMES_PATH} data-testid="home-quick-games"><div className="mini-icon" aria-hidden="true">◈</div><h3>游戏中心</h3><p>摘苹果、林间划船、林间射箭。</p><span className="arrow" aria-hidden="true">→</span></a>
          <a className="quick-card glass card accent-lime" href={COACH_PATH} data-testid="home-quick-coach"><div className="mini-icon" aria-hidden="true">✧</div><h3>AI Coach</h3><p>填写画像，获得功法、章节和游戏建议。</p><span className="arrow" aria-hidden="true">→</span></a>
        </section>

        <div className="section-head"><div><h2>今日训练摘要</h2><p>只统计本机已完成的训练。</p></div>{history.unavailable ? <StatusPill tone="coral">部分记录读取失败</StatusPill> : null}</div>
        <section className="metrics" aria-label="今日训练摘要" data-testid="home-metrics">
          <div className="metric glass card"><div className="metric-top"><span>本周训练次数</span><span className="metric-icon" aria-hidden="true">✦</span></div><div className="metric-value">{summary.weekCount}</div><div className="metric-trend">上周 {summary.previousWeekCount} 次</div></div>
          <div className="metric glass card"><div className="metric-top"><span>连续训练天数</span><span className="metric-icon" aria-hidden="true">◷</span></div><div className="metric-value">{history.streakDays}</div><div className="metric-trend">今天 {history.todayCount} 次</div></div>
          <div className="metric glass card"><div className="metric-top"><span>累计完成</span><span className="metric-icon" aria-hidden="true">◒</span></div><div className="metric-value">{summary.finishedCount}</div><div className="metric-trend">含热身、功法与我的动作</div></div>
          <div className="metric glass card"><div className="metric-top"><span>最近一次时长</span><span className="metric-icon" aria-hidden="true">⌁</span></div><div className="metric-value" style={{ fontSize: 22 }}>{latest ? formatDuration(latestDuration) : '—'}</div><div className="metric-trend">{latest ? formatEntryDate(latest.startedAt) : '暂无记录'}</div></div>
        </section>

        <section className="two-col" style={{ marginTop: 15 }}>
          <div className="continue-card glass card" data-testid="home-continue">
            <div className="panel-title" style={{ marginBottom: 0 }}><div><h3>继续训练</h3><p>{latest ? '带着上次的重点再练一次。' : '完成第一次训练后，这里会出现你的变化。'}</p></div>{latest ? <StatusPill tone="mint">可继续</StatusPill> : null}</div>
            {latest ? (
              <>
                <div className="continue-inner"><div className="continue-copy"><h3>{historyEntryTitle(latest)}</h3><p className="tiny">{formatEntryDate(latest.startedAt)} · {formatDuration(latestDuration)} · {historyEntryHeadline(latest)}</p></div></div>
                <div className="report-actions"><a className="btn btn-primary" href={entryRetrainPath(latest)} data-testid="home-continue-retrain">带着重点再练一次</a><a className="btn btn-secondary" href={entryReportPath(latest)} data-testid="home-continue-report">查看报告</a></div>
              </>
            ) : (
              <div className="report-actions"><a className="btn btn-primary" href={SMART_TRAINING_PATH} data-testid="home-first-training">开始智能训练</a><a className="btn btn-secondary" href={ROUTINES_PATH}>浏览功法</a></div>
            )}
          </div>
          <div className="tip-card glass card" data-testid="home-recommend">
            <div className="tip-mark" aria-hidden="true">✧</div>
            <strong>今日推荐</strong>
            <p>{latest ? `上次完成「${historyEntryTitle(latest)}」。在 AI Coach 填写画像，获取下一步的功法章节与游戏建议。` : '还没有训练记录。在 AI Coach 填写目标与关注部位，先获得一份规则推荐。'}</p>
            <a className="btn btn-dark" style={{ marginTop: 16 }} href={COACH_PATH} data-testid="home-recommend-coach">打开 AI Coach →</a>
            <div className="tip-source"><span className="pulse-dot" aria-hidden="true" />依据：{latest ? '本机最近一次训练记录 · 画像需在 AI Coach 中填写' : '尚无训练记录，仅可按画像推荐'}</div>
          </div>
        </section>

        <div className="section-head"><div><h2>最近训练记录</h2><p>按时间倒序，点击查看报告。</p></div><a className="btn btn-ghost" href={HISTORY_PATH} data-testid="home-history-all">查看全部 →</a></div>
        <section className="panel glass card" data-testid="home-recent">
          {history.entries.length ? (
            <div className="history-list">{history.entries.slice(0, 3).map((entry) => <HistoryRow key={entry.id} entry={entry} />)}</div>
          ) : (
            <WebEmpty mark="◒" title="还没有训练记录" testId="home-recent-empty" action={<a className="btn btn-primary" href={TRAINING_CENTER_PATH}>去训练中心</a>}>完成第一次训练后，这里会出现你的报告与变化。FormPilot 不会显示演示趋势。</WebEmpty>
          )}
        </section>
      </div>
    </WebShell>
  )
}
