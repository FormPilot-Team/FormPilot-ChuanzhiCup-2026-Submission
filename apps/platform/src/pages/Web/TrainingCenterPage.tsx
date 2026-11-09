import { useMemo, type CSSProperties } from 'react'
import { SMART_TRAINING_PATH, WORKSHOP_NEW_PATH, WORKSHOP_PATH, customTrainingPath } from '../../app/routes'
import { StatusPill, WebEmpty, WebShell } from '../../components/web/WebShell'
import { BODY_AREAS } from '../../features/workshop/catalog'
import { goalText } from '../../features/workshop/definition'
import type { CustomActionBodyArea } from '../../features/workshop/types'
import { loadWebHistory, relativeDayText, type WebHistoryRepositories } from '../../features/web/webHistory'
import { FREE_TRAINING_OPTIONS } from '../SmartTraining/freeTrainingOptions'

const AREA_LOOK: Readonly<Record<CustomActionBodyArea, { icon: string; color: string }>> = {
  upper: { icon: '↥', color: '121,184,255' },
  core: { icon: '↔', color: '167,139,250' },
  lower: { icon: '◠', color: '255,143,134' },
  full: { icon: '✦', color: '145,230,210' },
}

const FREE_ICONS = ['◌', '↥', '↔', '✦', '◠', '⇡'] as const

/**
 * 训练中心: the start of every camera training. Cards only navigate; the camera is requested on the training
 * preparation page, never here.
 */
export function TrainingCenterPage({ repositories, now }: { repositories?: WebHistoryRepositories; now?: number }) {
  const history = useMemo(() => loadWebHistory(repositories, now ?? Date.now()), [repositories, now])
  const shown = history.actions.slice(0, 3)
  return (
    <WebShell active="training" testId="web-training-center">
      <div className="page-head"><div><div className="eyebrow">TRAINING CENTER</div><h1 style={{ marginTop: 10 }}>选择今天的训练方式</h1><p>从实时识别开始，或用一个动作快速热身。</p></div><a className="btn btn-secondary" href={WORKSHOP_PATH} data-testid="training-manage-actions">管理我的动作 →</a></div>
      <section className="training-grid">
        <article className="training-card glass card" style={{ '--accent': 'rgba(121,184,255,.8)' } as CSSProperties}><div className="card-glow" /><div className="mini-icon" aria-hidden="true">✦</div><span className="recommend" style={{ position: 'absolute', right: 23, top: 24 }}>推荐</span><h3>智能训练</h3><p>6 个热身动作 · 实时姿态识别 · 语音提示 · 训练报告</p><div className="card-foot"><span>完整或单项练习</span><a className="btn btn-dark" href={SMART_TRAINING_PATH} data-testid="training-start-smart">开始 →</a></div></article>
        <article className="training-card glass card" style={{ '--accent': 'rgba(167,139,250,.8)' } as CSSProperties}><div className="card-glow" /><div className="mini-icon" aria-hidden="true">◌</div><h3>自由训练</h3><p>选择一个标准动作或自定义动作，按次数或时间练习。</p><div className="card-foot"><span>随时开始</span><a className="btn btn-secondary" href="#free-training" data-testid="training-start-free">选择动作 →</a></div></article>
        <article className="training-card glass card" style={{ '--accent': 'rgba(255,143,134,.84)' } as CSSProperties}><div className="card-glow" /><div className="mini-icon" aria-hidden="true">＋</div><h3>动作工坊</h3><p>创建你的动作，记录识别要求，测试通过后立即训练。</p><div className="card-foot"><span>创建 · 测试 · 保存</span><a className="btn btn-secondary" href={WORKSHOP_PATH} data-testid="training-open-workshop">打开动作工坊 →</a></div></article>
      </section>

      <div className="section-head" id="free-training"><div><h2>标准动作</h2><p>自由训练 · 选择一个动作，在准备页开启摄像头后开始。</p></div></div>
      <section className="action-grid" aria-label="标准动作" data-testid="training-free-options">
        {FREE_TRAINING_OPTIONS.map((option, index) => (
          <article key={option.exerciseId} className="action-card glass card">
            <div className="action-top"><div className="action-avatar" aria-hidden="true">{FREE_ICONS[index] ?? '✦'}</div><span className="tiny">{option.target}</span></div>
            <h3 style={{ marginTop: 15 }}>{option.name}</h3><p>{option.focus}</p>
            <div className="action-foot"><span>实时识别 · 训练报告</span><a className="btn btn-ghost" href={option.href} data-testid={`training-free-${option.exerciseId}`}>开始 →</a></div>
          </article>
        ))}
      </section>

      <div className="section-head"><div><h2>我的动作</h2><p>{history.actions.length ? `最近使用的 ${shown.length} 个自定义动作` : '在动作工坊创建的动作会出现在这里'}</p></div><a className="btn btn-ghost" href={WORKSHOP_PATH}>查看全部 →</a></div>
      {shown.length ? (
        <section className="action-grid" data-testid="training-my-actions">
          {shown.map(({ action, lastTrainedAt }) => {
            const look = AREA_LOOK[action.bodyArea]
            return (
              <article key={action.id} className="action-card glass card" data-testid={`training-action-${action.id}`}>
                <div className="action-top"><div className="action-avatar" style={{ background: `rgba(${look.color},.2)` }} aria-hidden="true">{look.icon}</div>{lastTrainedAt === null ? <span className="tiny">新动作</span> : <StatusPill tone="mint">可继续</StatusPill>}</div>
                <h3 style={{ marginTop: 15 }}>{action.name}</h3><p>{BODY_AREAS[action.bodyArea].label} · 目标 {goalText(action.goal)}</p>
                <div className="action-foot"><span>{relativeDayText(lastTrainedAt, now)}</span><a className="btn btn-ghost" href={customTrainingPath(action.id)} aria-label={`开始训练 · ${action.name}`}>开始 →</a></div>
              </article>
            )
          })}
        </section>
      ) : (
        <section className="panel glass card"><WebEmpty mark="＋" title="还没有自定义动作" testId="training-actions-empty" action={<a className="btn btn-primary" href={WORKSHOP_NEW_PATH}>在动作工坊新建动作</a>}>记录开始姿势和完成姿势，测试通过后就能在这里直接训练。</WebEmpty></section>
      )}

      <div className="section-head"><div><h2>训练前的小提示</h2></div></div>
      <div className="notice">摄像头训练会在浏览器本地完成识别，画面不会上传。摄像头只在训练准备页开启；也可以先在功法详情页观看标准示范视频，不授权摄像头。</div>
    </WebShell>
  )
}
