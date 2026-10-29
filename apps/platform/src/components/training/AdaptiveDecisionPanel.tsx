import { useMemo, useState } from 'react'
import type { ExerciseDefinition } from '../../features/exercises/contract'
import type { TrainingDecision, TrainingDecisionInput } from '../../features/adaptiveTraining/protocol'
import { ACTION_STEPS, ISSUE_LABELS, STRATEGY_LABELS, switchedCue } from '../../features/adaptiveTraining/localGuidance'
import { DECISION_SCENARIOS } from '../../features/adaptiveTraining/scenarios'
import { replayLocalScenario } from '../../features/adaptiveTraining/localScenarioReplay'
import { STRATEGIES } from '../../features/adaptiveTraining/protocol'

interface Props {
  decision: TrainingDecision
  input?: TrainingDecisionInput
  definition: ExerciseDefinition
  onPause: () => void
  canPause: boolean
}
const TREND_COPY = { improving: '正在改善', steady: '近期平稳', worsening: '质量下降', insufficient: '样本尚不足' }

export function AdaptiveDecisionPanel({ decision, input, definition, onPause, canPause }: Props) {
  const params = new URLSearchParams(window.location.search)
  const demoEnabled = import.meta.env.DEV && (params.get('adaptiveDemo') === '1' || params.get('jevDemo') === '1')
  const [demoId, setDemoId] = useState('')
  const replay = useMemo(() => demoEnabled && demoId ? replayLocalScenario(demoId) : undefined, [demoEnabled, demoId])
  const shown = replay?.decision ?? decision
  const shownInput = replay?.input ?? input
  const issue = shownInput?.errors[0]?.code
  const strategy = shown.strategy
  const sourceLabel = replay ? '本地引擎 · 构造情境' : '本地自适应 · 离线'
  const demoOptions = DECISION_SCENARIOS.filter(s => ['normal', 'switch', 'decomposition', 'pause', 'pose-missing'].includes(s.id))
  const steps = ACTION_STEPS[shownInput?.exerciseId ?? definition.id]

  return (
    <section className="border-b border-slate-200 pb-3" aria-labelledby="adaptive-decision-title" data-testid="adaptive-decision" data-strategy={strategy} data-source={shown.source}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="adaptive-decision-title" className="text-balance text-sm font-bold text-slate-900">智能训练决策</h3>
        <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800" data-testid="decision-source">{sourceLabel}</span>
      </div>
      {demoEnabled ? (
        <div className="mt-2">
          <label htmlFor="adaptive-demo-scenario" className="text-xs font-semibold text-slate-700">策略对比（人工构造情境）</label>
          <select id="adaptive-demo-scenario" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900" value={demoId} onChange={e => setDemoId(e.target.value)}>
            <option value="">当前训练 · 实际决策</option>
            {demoOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      ) : null}
      <div className="mt-2" role="status" aria-live="polite" aria-atomic="true">
        <p className="text-pretty text-base font-semibold text-slate-900" data-testid="decision-strategy">{STRATEGY_LABELS[strategy]}</p>
        <p className="mt-1 text-pretty text-sm text-slate-700">主要问题：{shownInput?.poseValid === false ? '等待有效姿态检测' : issue ? ISSUE_LABELS[issue] : '暂无已确认问题'}</p>
        <p className="mt-1 text-pretty text-sm leading-6 text-slate-800" data-testid="decision-advice">
          {strategy === 'SWITCH_CUE' ? switchedCue(issue)
            : strategy === 'SHOW_DECOMPOSITION' ? '先看下面的动作步骤，每次只关注一处调整。'
            : strategy === 'SUGGEST_PAUSE' ? '可以先短暂休息，准备好后再继续。点击暂停会沿用当前训练的暂停控制。'
            : '继续跟随现有示范和实时纠错；姿态不完整时先调整站位。'}
        </p>
      </div>
      <p className="mt-2 text-pretty text-xs leading-5 text-slate-700" data-testid="decision-reason">{shown.local?.reasons[0] ?? '等待近期可靠训练状态。'}</p>
      {shown.local ? <p className="mt-1 text-xs text-slate-700" data-testid="decision-trend">近期趋势：{TREND_COPY[shown.local.features.trend]}{shown.safetyFallback ? ' · 保留原有反馈' : ''}</p> : null}
      {strategy === 'SHOW_DECOMPOSITION' ? (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-pretty text-sm leading-6 text-slate-800" data-testid="decision-steps">
          {steps.map(step => <li key={step}>{step}</li>)}
        </ol>
      ) : null}
      {strategy === 'SUGGEST_PAUSE' ? (
        <button type="button" className="secondary-button mt-2 disabled:cursor-not-allowed disabled:opacity-50" onClick={onPause} disabled={!canPause} data-testid="decision-pause">暂停当前训练</button>
      ) : null}
      {shown.local ? (
        <>
          <details className="mt-2 text-xs text-slate-700">
            <summary className="cursor-pointer font-semibold">查看决策依据与策略分</summary>
            <p className="mt-1 text-pretty">策略分用于比较候选，不是概率或模型置信度。</p>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums" data-testid="decision-scores">
              {STRATEGIES.map(s => <div key={s} className="contents"><dt>{STRATEGY_LABELS[s]}</dt><dd>{shown.local!.strategyScores[s].toFixed(1)}{shown.local!.eligibleStrategies.includes(s) ? '' : ' · 当前不执行'}</dd></div>)}
            </dl>
            <p className="mt-2 text-pretty">{shown.local.reasons.slice(1).join(' ')}</p>
          </details>
        </>
      ) : null}
      {replay ? <p className="mt-2 text-pretty text-xs leading-5 text-slate-700" data-testid="decision-comparison">同状态固定规则：常规反馈。人工构造状态由本地引擎真实计算，不计入训练评分或报告，不代表真人实验。</p> : null}
    </section>
  )
}
