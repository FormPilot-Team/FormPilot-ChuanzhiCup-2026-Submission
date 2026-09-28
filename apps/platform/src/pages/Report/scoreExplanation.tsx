import { ChevronDown, Scale, ShieldCheck } from 'lucide-react'
import type { ExerciseId } from '../../features/exercises/types'
import type { RoutineReport } from '../../features/routines/report/routineReport'
import { chapterDisplayName } from '../../features/routines/scope'
import {
  criterionBasisText, evidenceSentence, explainWarmUpSession, repEvidenceSentence, targetText,
  type EvaluationCriterion, type TechniqueCriterionResult, type WarmUpExerciseExplanation,
} from '../../features/scoring'
import type { TrainingSessionState } from '../../features/training/types'
import type { TrainingScope } from '../../features/training/trainingScope'
import { cn } from '../../lib/cn'
import { scoreTone } from './reportPresentation'
import { MiniBar, SectionHeading } from './reportShell'

/**
 * Scoring v2 report additions: “为什么是这个分数”. Every deduction names the phase and the measured value, then the
 * two-part basis — where the movement requirement comes from, and that the number is FormPilot's own calibration.
 */

function BasisLines({ criterion, className }: { criterion: EvaluationCriterion; className?: string }) {
  const basis = criterionBasisText(criterion)
  return (
    <div className={cn('space-y-0.5 text-xs leading-5 text-slate-500', className)} data-testid="score-basis">
      <p><span className="font-semibold text-slate-600">评价依据：</span>{basis.requirement}。</p>
      {basis.threshold ? <p>{basis.threshold}。</p> : null}
    </div>
  )
}

function percentWeight(weight: number): string {
  return `${Math.round(weight * 100)}%`
}

function ReferenceList({ items }: { items: readonly EvaluationCriterion[] }) {
  if (!items.length) return null
  return (
    <div className="mt-3" data-testid="score-references">
      <h5 className="text-xs font-bold text-slate-700">规范参考（目前不进入视觉评分）</h5>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item.id} className="text-pretty text-xs leading-5 text-slate-500">
            <span className="font-semibold text-slate-600">{item.name}</span>：{item.observable === 'NOT_OBSERVABLE' ? '本项需要人工观察，目前不计入自动评分。' : '动作规范参考，目前不进入视觉评分。'}{item.limitations[0] ?? ''}
          </li>
        ))}
      </ul>
    </div>
  )
}

function WarmUpExerciseBlock({ item, score }: { item: WarmUpExerciseExplanation; score: number | null }) {
  const guidance = item.evaluationMode === 'guidance'
  return (
    <article className="rounded-xl border border-slate-100 bg-slate-50/60 p-4" data-testid={`score-explanation-${item.exerciseId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-bold text-slate-950">{item.name}</h4>
        <p className="text-sm font-bold tabular-nums text-slate-950">{guidance ? '热身引导 · 不计分' : score === null ? '暂不评分' : `${score} 分`}</p>
      </div>
      {guidance ? (
        <>
          <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">肩部环绕用于热身引导，以下为本次环绕过程中各检查项的平均表现，不计入综合评分。</p>
          {item.guidanceSamples > 0 ? (
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              {item.guidance.map((check) => (
                <div key={check.criterion.id} className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-100">
                  <dt className="text-xs text-slate-500">{check.criterion.name}</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-slate-900">{check.valueText ?? '—'}{check.meets === null ? '' : check.meets ? ' · 达到提示线' : ' · 未达提示线'}</dd>
                </div>
              ))}
            </dl>
          ) : <p className="mt-2 text-xs text-slate-500">本次没有保存肩部环绕的过程数据（旧记录或未开始）。</p>}
        </>
      ) : score === null ? (
        <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">有效动作少于 3 次，本动作暂不给出分数与分项。</p>
      ) : (
        <>
          <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">本动作分数 = 各分项得分 × 权重之和（按 {item.analyzedReps} 次有效动作平均）{item.weightedSum !== null && item.weightedSum !== score ? `；分项加权为 ${item.weightedSum}，与 ${score} 分的差来自逐次取整` : ''}。</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label={`${item.name}分项`}>
            {item.components.map((component) => (
              <li key={component.criterion.id} className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-100" data-testid={`score-component-${component.criterion.id}`}>
                <div className="flex items-baseline justify-between gap-2 text-sm"><span className="font-semibold text-slate-800">{component.criterion.name}</span><span className="font-bold tabular-nums text-slate-950">{component.score ?? '—'}</span></div>
                <div className="mt-1.5"><MiniBar value={component.score} tone={scoreTone(component.score)} /></div>
                <p className="mt-1 text-xs tabular-nums text-slate-500">权重 {percentWeight(component.weight)} · {component.fullMarkReps}/{component.evaluatedReps} 次满分</p>
              </li>
            ))}
          </ul>
          {item.deductions.length ? (
            <div className="mt-3">
              <h5 className="text-xs font-bold text-slate-700">主要扣分原因</h5>
              <ul className="mt-1 space-y-2">
                {item.deductions.map((component) => (
                  <li key={component.criterion.id} className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-100" data-testid="score-deduction">
                    <p className="text-pretty text-sm text-slate-800"><span className="font-semibold">{component.criterion.feedback.issue}</span>：{component.criterion.name} {component.score} 分，扣 {component.lostPoints} 分。</p>
                    {component.worst.map((evidence) => <p key={evidence.repNumber} className="mt-0.5 text-pretty text-xs tabular-nums leading-5 text-slate-600">{repEvidenceSentence(component.criterion, evidence)}</p>)}
                    <p className="mt-0.5 text-pretty text-xs leading-5 text-blue-800">纠正：{component.criterion.feedback.cue}。</p>
                    <BasisLines criterion={component.criterion} className="mt-1" />
                  </li>
                ))}
              </ul>
            </div>
          ) : <p className="mt-3 text-xs text-slate-500">各分项接近满分，没有明显扣分。</p>}
          {item.advisory.filter((check) => check.evaluatedReps > 0).map((check) => (
            <p key={check.criterion.id} className="mt-2 text-pretty text-xs leading-5 text-slate-500">
              <span className="font-semibold text-slate-600">检查但不计分 · {check.criterion.name}</span>：{check.evaluatedReps} 次中 {check.affectedReps} 次未达到{check.criterion.target ? `提示线（${targetText(check.criterion.target)}）` : ''}；只用于实时提示和报告问题，不计入本动作分数。
            </p>
          ))}
        </>
      )}
      <ReferenceList items={item.references} />
    </article>
  )
}

/** 热身训练: collapsed by default so the redesigned report keeps its layout. */
export function WarmUpScoreExplanationSection({ session, scope, scores }: {
  session: TrainingSessionState
  scope?: TrainingScope
  /** The exercise scores the report shows (analysis-v1), keyed by exercise. */
  scores: Partial<Record<ExerciseId, number | null>>
}) {
  const explanation = explainWarmUpSession(session)
  const freeExerciseId = scope?.kind === 'free_training' ? scope.exerciseId : null
  const exercises = explanation.exercises.filter((item) => !freeExerciseId || item.exerciseId === freeExerciseId)
  if (!exercises.length) return null
  return (
    <section aria-labelledby="score-explanation-title" data-testid="report-score-explanation">
      <details className="group report-panel overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4 marker:content-none sm:p-5">
          <span className="grid size-9 place-items-center rounded-xl bg-blue-50 text-blue-700" aria-hidden="true"><Scale size={18} /></span>
          <div className="min-w-0 flex-1"><h2 id="score-explanation-title" className="text-balance font-bold text-slate-950">评分说明 · 为什么是这个分数</h2><p className="mt-0.5 text-pretty text-sm text-slate-500">每个动作的分项、主要扣分原因与评价依据</p></div>
          <ChevronDown size={18} className="text-slate-400 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        <div className="space-y-3 border-t border-slate-100 px-4 pb-5 pt-4 sm:px-5">
          <p className="text-pretty text-sm leading-6 text-slate-600">热身训练没有统一的“国家六动作评分标准”。动作规范参考国家体育总局公开的科学健身指导和运动学原则，机器指标结合姿态评估研究与 FormPilot 标准示范进行量化；所有数值阈值都是 FormPilot 标定，不是国家标准。</p>
          {exercises.map((item) => <WarmUpExerciseBlock key={item.exerciseId} item={item} score={scores[item.exerciseId] ?? item.score} />)}
        </div>
      </details>
    </section>
  )
}

function techniqueFailureText(result: TechniqueCriterionResult): string | null {
  const worst = result.failures[0]
  return worst ? evidenceSentence(result, worst) : null
}

function CriterionRow({ result }: { result: TechniqueCriterionResult }) {
  const advisory = result.criterion.scoring === 'ADVISORY'
  return (
    <li className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-100" data-testid={`technique-criterion-${result.criterion.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-slate-800">{result.criterion.name}{advisory ? <span className="ml-1.5 text-xs font-medium text-slate-500">只作提示</span> : null}</span>
        <span className="font-bold tabular-nums text-slate-950">{result.score === null ? '未观察到' : `${result.score}`}</span>
      </div>
      <p className="mt-0.5 text-xs tabular-nums text-slate-500">{result.windowsObserved ? `${result.windowsObserved} 次中 ${result.passed} 次达标` : `${result.windowsTotal} 次动作阶段均未能可靠识别`}</p>
      {techniqueFailureText(result) ? <p className="mt-0.5 text-pretty text-xs tabular-nums leading-5 text-slate-600">{techniqueFailureText(result)}</p> : null}
    </li>
  )
}

/** 跟练课程: 动作规范评价, shown next to (never merged with) 跟练相似度. */
export function RoutineTechniqueSection({ report }: { report: RoutineReport }) {
  const technique = report.technique
  const measuredChapters = technique.chapters.filter((item) => item.measured.length > 0)
  return (
    <section className="report-panel p-5 sm:p-6" aria-labelledby="routine-technique-title" data-testid="routine-report-technique">
      <SectionHeading id="routine-technique-title" icon={ShieldCheck} title="动作规范评价" description="按官方动作要求检查关键阶段的关节角度与位置；与“跟练相似度”分开计算，两者不合成一个分数。" />
      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-3.5">
          <dt className="text-xs text-slate-500">动作规范评价</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums text-slate-950" data-testid="routine-technique-score">{technique.score ?? '—'}</dd>
          <div className="mt-2"><MiniBar value={technique.score} tone={scoreTone(technique.score)} /></div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3.5">
          <dt className="text-xs text-slate-500">跟练相似度（另计）</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums text-slate-950">{report.similarity === null ? '—' : `${report.similarity}%`}</dd>
          <p className="mt-1 text-xs text-slate-500">与标准视频的视觉接近程度</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3.5">
          <dt className="text-xs text-slate-500">已自动检查</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums text-slate-950">{technique.measuredChapterCount} / {technique.chapters.length}</dd>
          <p className="mt-1 text-xs text-slate-500">段；其余段落的要点仅作规范参考</p>
        </div>
      </dl>
      {!technique.available ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-pretty text-sm text-slate-600">{technique.reason}</p> : null}
      {technique.available && technique.deductions.length ? (
        <div className="mt-4">
          <h3 className="font-bold text-slate-950">主要扣分原因</h3>
          <ol className="mt-2 space-y-2">
            {technique.deductions.map(({ result, chapter }) => (
              <li key={`${result.criterion.id}@${chapter.id}`} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5" data-testid="technique-deduction">
                <p className="text-pretty text-sm text-slate-800"><span className="font-semibold">{chapterDisplayName(chapter)} · {result.criterion.feedback.issue}</span>（{result.criterion.name} {result.score} 分）</p>
                {result.failures.slice(0, 2).map((evidence) => <p key={evidence.start} className="mt-0.5 text-pretty text-xs tabular-nums leading-5 text-slate-600">{evidenceSentence(result, evidence)}</p>)}
                <p className="mt-0.5 text-pretty text-xs leading-5 text-blue-800">纠正：{result.criterion.feedback.cue}。</p>
                <BasisLines criterion={result.criterion} className="mt-1" />
              </li>
            ))}
          </ol>
        </div>
      ) : technique.available && technique.score !== null ? <p className="mt-4 text-sm text-slate-600">已检查的动作要求全部达标。</p> : null}
      <details className="group mt-4 rounded-xl border border-slate-100" data-testid="routine-technique-details">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-slate-800 marker:content-none">
          评分说明 · 逐段检查项
          <ChevronDown size={16} className="text-slate-400 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3">
          <p className="text-pretty text-xs leading-5 text-slate-500">跟练相似度：你与标准视频同一时刻的整体姿态接近程度。动作规范评价：在示范的关键阶段（例如托举顶点）检查具体技术要求，如肘角、手臂高度、身体中正。阶段由标准视频的姿态数据划分，所有数值阈值由 FormPilot 按示范实测值标定。</p>
          {measuredChapters.map((item) => (
            <div key={item.chapter.id} data-testid={`technique-chapter-${item.chapter.id}`}>
              <div className="flex items-baseline justify-between gap-2"><h4 className="text-sm font-bold text-slate-900">{chapterDisplayName(item.chapter)}</h4><span className="text-sm font-bold tabular-nums text-slate-950">{item.score ?? '—'}</span></div>
              <ul className="mt-1.5 grid gap-2 md:grid-cols-2">{item.measured.map((result) => <CriterionRow key={result.criterion.id} result={result} />)}</ul>
              <ReferenceList items={item.references} />
            </div>
          ))}
          {technique.chapters.filter((item) => item.measured.length === 0 && item.references.length > 0).map((item) => (
            <div key={item.chapter.id}>
              <h4 className="text-sm font-bold text-slate-900">{chapterDisplayName(item.chapter)}</h4>
              <ReferenceList items={item.references} />
            </div>
          ))}
          {technique.routineNotObservable.length ? (
            <div data-testid="technique-not-observable">
              <h4 className="text-sm font-bold text-slate-900">全套通用 · 需要人工观察</h4>
              <ul className="mt-1 space-y-1">{technique.routineNotObservable.map((item) => <li key={item.id} className="text-pretty text-xs leading-5 text-slate-500"><span className="font-semibold text-slate-600">{item.name}</span>：本项需要人工观察，目前不计入自动评分。</li>)}</ul>
            </div>
          ) : null}
        </div>
      </details>
    </section>
  )
}
