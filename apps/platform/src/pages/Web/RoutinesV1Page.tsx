import { useMemo, useState, type CSSProperties } from 'react'
import { reportPath, routinePath, routineTrainingPath } from '../../app/routes'
import { StatusPill, WebEmpty, WebShell } from '../../components/web/WebShell'
import { loadRoutineHistory, type RoutineHistoryItem } from '../../features/history/routineHistory'
import { ROUTINE_PROGRAMS } from '../../features/routines/programs'
import { chapterDisplayName, formatClock, formCount, scopeTitle } from '../../features/routines/scope'
import { LocalStorageRoutineSessionRepository, type RoutineSessionRepository } from '../../features/routines/session/RoutineSessionRepository'
import type { RoutineId, RoutineProgram } from '../../features/routines/types'
import { formatEntryDate } from '../../features/web/webHistory'

type RoutineFilter = 'all' | 'stretch' | 'focus' | 'strength'

/**
 * Card look from the #52 design, keyed by the platform's own routine ids (the prototype used `badanjin`, `taichi`
 * and `wuxinqi`; routes and data always use ROUTINE_PROGRAMS ids). Facts (forms, length) come from the programs.
 */
const ROUTINE_LOOK: Readonly<Record<RoutineId, { image: string; desc: string; people: string; a: string; b: string; badge: string; filter: Exclude<RoutineFilter, 'all'> }>> = {
  baduanjin: { image: '/web-v1/assets/badanjin.jpg', desc: '舒展全身，放松肩颈与脊柱。', people: '适合晨间唤醒', a: '#d3e9ff', b: '#e7dcff', badge: '课程', filter: 'stretch' },
  taijiquan: { image: '/web-v1/assets/taichi.jpg', desc: '以呼吸和重心流动，练习稳定与协调。', people: '适合专注练习', a: '#d4f1e4', b: '#d6e9ff', badge: '课程', filter: 'focus' },
  wuqinxi: { image: '/web-v1/assets/wuxinqi.jpg', desc: '模仿五禽动作，激活灵活度和节奏感。', people: '适合轻量运动', a: '#ffe5d8', b: '#ffeec9', badge: '轻量', filter: 'stretch' },
  yijinjing: { image: '/web-v1/assets/yijinjing.jpg', desc: '循序渐进地建立力量、幅度与控制。', people: '适合晚间舒缓', a: '#e8dcff', b: '#d7e1ff', badge: '课程', filter: 'strength' },
}

const FILTERS: ReadonlyArray<[RoutineFilter, string]> = [['all', '全部'], ['stretch', '舒展'], ['focus', '专注'], ['strength', '力量']]

/** Same completion rule as the decision engine's history reader: a chapter counts once ≥ 80 % of it was followed. */
const CHAPTER_DONE_SHARE = 0.8

export interface RoutineProgress {
  program: RoutineProgram
  practicedForms: Set<string>
  latest: RoutineHistoryItem | null
}

export function routineProgress(items: readonly RoutineHistoryItem[]): Map<RoutineId, RoutineProgress> {
  const progress = new Map<RoutineId, RoutineProgress>()
  for (const program of ROUTINE_PROGRAMS) progress.set(program.id, { program, practicedForms: new Set(), latest: null })
  for (const item of items) {
    const entry = progress.get(item.record.programId)
    if (!entry) continue
    if (!entry.latest) entry.latest = item
    for (const chapter of item.record.chapters) {
      const definition = entry.program.chapters.find((candidate) => candidate.id === chapter.chapterId)
      if (definition?.kind === 'form' && chapter.totalSeconds > 0 && chapter.coveredSeconds / chapter.totalSeconds >= CHAPTER_DONE_SHARE) entry.practicedForms.add(chapter.chapterId)
    }
  }
  return progress
}

function nextForm(progress: RoutineProgress) {
  return progress.program.chapters.find((chapter) => chapter.kind === 'form' && !progress.practicedForms.has(chapter.id))
}

const localRepository = new LocalStorageRoutineSessionRepository()

/** 功法训练: four routines with the design's posters; every link goes to the real course and training routes. */
export function RoutinesV1Page({ repository = localRepository, unknownRoutine = false }: { repository?: RoutineSessionRepository; unknownRoutine?: boolean }) {
  const [filter, setFilter] = useState<RoutineFilter>('all')
  const history = useMemo(() => loadRoutineHistory(repository), [repository])
  const items = useMemo(() => (history.status === 'ready' ? history.items : []), [history])
  const progress = useMemo(() => routineProgress(items), [items])
  const latest = items[0]
  const latestProgress = latest ? progress.get(latest.record.programId) : undefined
  const shown = ROUTINE_PROGRAMS.filter((program) => filter === 'all' || ROUTINE_LOOK[program.id].filter === filter)

  return (
    <WebShell active="routines" testId="web-routines">
      <div className="page-head"><div><div className="eyebrow">ROUTINE PRACTICE</div><h1 style={{ marginTop: 10 }}>功法选择</h1><p>跟随标准视频，练习幅度、稳定、协调和节奏。</p></div>
        <div className="filter-row" role="group" aria-label="筛选功法">{FILTERS.map(([id, label]) => <button key={id} type="button" className={`filter${filter === id ? ' active' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
      </div>
      {unknownRoutine ? <div className="notice" role="status" data-testid="routine-not-found" style={{ marginBottom: 18 }}>没有找到这个课程，请从下面选择一套开始。</div> : null}
      <section className="course-grid" data-testid="routines-index">
        {shown.map((program) => {
          const look = ROUTINE_LOOK[program.id]
          const done = progress.get(program.id)?.practicedForms.size ?? 0
          return (
            <article key={program.id} className="course-card glass card" data-testid={`routine-card-${program.id}`}>
              <div className="course-poster" style={{ '--poster-a': look.a, '--poster-b': look.b } as CSSProperties}><img className="course-image" src={look.image} alt={`${program.title}训练封面`} loading="lazy" /><span className="image-badge">{program.subtitle}</span></div>
              <div className="course-body">
                <h3>{program.title}<span className="course-badge">{look.badge}</span></h3>
                <p>{look.desc}</p>
                <div className="course-meta"><span>◷ {formCount(program)} {program.formUnit} · 全套 {formatClock(program.video.durationSeconds)}</span><span>⌁ {look.people}</span></div>
                <div className="course-foot"><span className="tiny">{done ? `已练 ${done} / ${formCount(program)} ${program.formUnit}` : `从第 1 ${program.formUnit}开始`}</span><a className="btn btn-secondary" href={routinePath(program.id)} data-testid={`routine-open-${program.id}`}>智能跟练 →</a></div>
              </div>
            </article>
          )
        })}
      </section>

      <div className="section-head"><div><h2>你的课程进度</h2><p>完成一节后，可以继续下一式或查看本节报告。</p></div>{history.status === 'error' ? <StatusPill tone="coral">记录读取失败</StatusPill> : null}</div>
      {latest && latestProgress ? (() => {
        const forms = formCount(latestProgress.program)
        const next = nextForm(latestProgress)
        const share = forms ? latestProgress.practicedForms.size / forms : 0
        return (
          <section className="panel glass card" data-testid="routine-progress">
            <div className="panel-title"><div><h3>{latestProgress.program.title} · 最近练习</h3><p>最近一次：{scopeTitle(latestProgress.program, latest.record.scope).replace(`${latestProgress.program.title} · `, '')} · {formatEntryDate(latest.record.startedAt)} · {latest.report.headline}{latest.incomplete ? ' · 未完整结束' : ''}</p></div>
              <div className="report-actions" style={{ marginTop: 0 }}>
                <a className="btn btn-primary" href={next ? routineTrainingPath(latestProgress.program.id, next.id) : routineTrainingPath(latestProgress.program.id)} data-testid="routine-continue">{next ? `继续：${chapterDisplayName(next)}` : '再练整套'}</a>
                <a className="btn btn-secondary" href={reportPath(latest.record.id)} data-testid="routine-latest-report">查看本节报告</a>
              </div>
            </div>
            <div className="progress-line"><span style={{ width: `${Math.round(share * 100)}%`, background: 'linear-gradient(90deg,var(--violet),var(--blue))' }} /></div>
            <div className="continue-meta"><span>已练 {latestProgress.practicedForms.size} / {forms} {latestProgress.program.formUnit}</span><span>{next ? `下一${latestProgress.program.formUnit}：${chapterDisplayName(next)}` : '各式均已练过'}</span></div>
          </section>
        )
      })() : (
        <section className="panel glass card"><WebEmpty mark="◒" title="还没有功法跟练记录" testId="routine-progress-empty">选择一套功法，先观看标准示范，再进入跟练。完成一节后这里会显示真实进度。</WebEmpty></section>
      )}
    </WebShell>
  )
}
