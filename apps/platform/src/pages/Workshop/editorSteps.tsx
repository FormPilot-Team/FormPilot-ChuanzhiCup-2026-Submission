import { AlertTriangle, Camera, Check, CircleDashed, Download, Info, RotateCcw, ScanLine, X } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { PoseSketch } from '../../components/workshop/PoseSketch'
import { VideoDemonstrationInput } from '../../components/workshop/VideoDemonstrationInput'
import type { ContinuousSuggestion } from '../../features/workshop/recognition/continuous'
import { ProgressMeter, RequirementResults } from '../../components/workshop/RecognitionReadout'
import {
  BODY_AREAS, BODY_AREA_ORDER, GOAL_LIMITS, JOINT_LABEL, PROFILE_OPTIONS, PROFILE_ORDER, REQUIREMENTS, REQUIREMENT_ORDER, SIGNAL_SOURCE_OPTIONS,
  SIGNAL_SOURCE_ORDER,
} from '../../features/workshop/catalog'
import { DESCRIPTION_MAX, NAME_MAX, POSE_DESCRIPTION_MAX, goalText } from '../../features/workshop/definition'
import type { CaptureProgress } from '../../features/workshop/recognition/capture'
import { activeJointNames, buildPoseMatch } from '../../features/workshop/recognition/poseMatch'
import type { RecognitionSetup, RecognizerSnapshot } from '../../features/workshop/recognition/recognizer'
import { suggestRequirement } from '../../features/workshop/recognition/requirements'
import type { CustomActionBodyArea, CustomActionDefinition, PhaseThresholds, RequirementId, SignalSource } from '../../features/workshop/types'
import { cn } from '../../lib/cn'

export function StepHeading({ id, title, description, headingRef }: { id: string; title: string; description: string; headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <div>
      <h2 id={id} ref={headingRef} tabIndex={-1} className="text-balance text-xl font-bold text-slate-950 focus:outline-none sm:text-2xl">{title}</h2>
      <p className="mt-1 max-w-2xl text-pretty text-sm leading-6 text-slate-600">{description}</p>
    </div>
  )
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return <p id={id} className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-coral-600"><AlertTriangle size={15} aria-hidden="true" />{message}</p>
}

// ---- 1 · 创建动作 ------------------------------------------------------------------------------------------------------

export function BasicsStep({ draft, errors, onChange }: {
  draft: CustomActionDefinition
  errors: { name?: string }
  onChange: (patch: Partial<Pick<CustomActionDefinition, 'name' | 'description' | 'goal'>> & { bodyArea?: CustomActionBodyArea }) => void
}) {
  const repsGoal = draft.goal.type === 'reps'
  return (
    <div className="grid gap-5">
      <div>
        <label htmlFor="action-name" className="text-sm font-bold text-slate-900">动作名称 <span className="font-normal text-coral-600">（必填）</span></label>
        <input
          id="action-name"
          value={draft.name}
          maxLength={NAME_MAX}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="例如：侧平举、弹力带划船"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'action-name-error' : 'action-name-hint'}
          className={cn('mt-1.5 w-full rounded-xl border bg-white px-3.5 py-2.5 text-base text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', errors.name ? 'border-coral-500' : 'border-slate-300')}
        />
        {errors.name ? <FieldError id="action-name-error" message={errors.name} /> : <p id="action-name-hint" className="mt-1 text-xs text-slate-500">{draft.name.length} / {NAME_MAX}</p>}
      </div>
      <div>
        <label htmlFor="action-description" className="text-sm font-bold text-slate-900">简单描述</label>
        <textarea
          id="action-description"
          value={draft.description}
          maxLength={DESCRIPTION_MAX}
          rows={2}
          onChange={(event) => onChange({ description: event.target.value })}
          placeholder="这个动作练什么、怎么做"
          aria-describedby="action-description-hint"
          className="mt-1.5 w-full resize-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
        <p id="action-description-hint" className="mt-1 text-xs text-slate-500">{draft.description.length} / {DESCRIPTION_MAX}</p>
      </div>
      <fieldset>
        <legend className="text-sm font-bold text-slate-900">训练部位</legend>
        <p className="mt-0.5 text-xs text-slate-500">决定取景范围和推荐的识别重点。</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {BODY_AREA_ORDER.map((area) => (
            <label key={area} className={cn('flex cursor-pointer flex-col rounded-xl border px-3 py-2.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500', draft.bodyArea === area ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300')}>
              <input type="radio" name="body-area" value={area} checked={draft.bodyArea === area} onChange={() => onChange({ bodyArea: area })} className="sr-only" />
              <span className="font-bold">{BODY_AREAS[area].label}</span>
              <span className="mt-0.5 text-xs opacity-80">{BODY_AREAS[area].hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-bold text-slate-900">计数方式</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {([
            { type: 'reps', title: '按次数', hint: '从开始姿势到完成姿势再回来，算一次' },
            { type: 'duration', title: '按时间', hint: '在完成姿势保持住，累计计时（如平板支撑）' },
          ] as const).map((option) => (
            <label key={option.type} className={cn('flex cursor-pointer flex-col rounded-xl border px-3 py-2.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500', draft.goal.type === option.type ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300')}>
              <input
                type="radio"
                name="goal-type"
                value={option.type}
                checked={draft.goal.type === option.type}
                onChange={() => onChange({ goal: option.type === 'reps' ? { type: 'reps', target: GOAL_LIMITS.reps.defaultValue } : { type: 'duration', seconds: GOAL_LIMITS.duration.defaultValue } })}
                className="sr-only"
              />
              <span className="font-bold">{option.title}</span>
              <span className="mt-0.5 text-xs opacity-80">{option.hint}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <label htmlFor="goal-value" className="text-sm font-semibold text-slate-700">{repsGoal ? '目标次数' : '目标时间（秒）'}</label>
          <input
            id="goal-value"
            type="number"
            inputMode="numeric"
            min={repsGoal ? GOAL_LIMITS.reps.min : GOAL_LIMITS.duration.min}
            max={repsGoal ? GOAL_LIMITS.reps.max : GOAL_LIMITS.duration.max}
            value={repsGoal ? (draft.goal as { target: number }).target : (draft.goal as { seconds: number }).seconds}
            onChange={(event) => {
              const limits = repsGoal ? GOAL_LIMITS.reps : GOAL_LIMITS.duration
              const value = Math.round(Number(event.target.value))
              if (!Number.isFinite(value)) return
              const bounded = Math.min(limits.max, Math.max(limits.min, value))
              onChange({ goal: repsGoal ? { type: 'reps', target: bounded } : { type: 'duration', seconds: bounded } })
            }}
            className="w-24 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base tabular-nums shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
          <span className="text-sm text-slate-500">{repsGoal ? `${GOAL_LIMITS.reps.min}–${GOAL_LIMITS.reps.max} 次` : `${GOAL_LIMITS.duration.min}–${GOAL_LIMITS.duration.max} 秒`}</span>
        </div>
      </fieldset>
    </div>
  )
}

// ---- 2 · 设置识别要求 ----------------------------------------------------------------------------------------------------

export type CaptureTarget = 'start' | 'finish'
export type DemonstrationMethod = 'camera' | 'video'

function PoseCard({ target, draft, capture, method, onDescription, onRecord, onCancel }: {
  target: CaptureTarget
  draft: CustomActionDefinition
  capture: { target: CaptureTarget; progress: CaptureProgress | null } | null
  method: DemonstrationMethod
  onDescription: (value: string) => void
  onRecord: () => void
  onCancel: () => void
}) {
  const step = target === 'start' ? draft.startPose : draft.finishPose
  const title = target === 'start' ? '开始姿势' : '完成姿势'
  const active = capture?.target === target
  const progress = active ? capture?.progress : null
  const inputId = `${target}-pose-description`
  return (
    <div className={cn('rounded-2xl border p-4', active ? 'border-blue-400 bg-blue-50/60' : 'border-slate-200 bg-white')} data-testid={`pose-card-${target}`} data-recorded={step.capture ? 'true' : 'false'}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-slate-950">{title}</h3>
        {step.capture
          ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800"><Check size={13} aria-hidden="true" />已记录</span>
          : <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600"><CircleDashed size={13} aria-hidden="true" />未记录</span>}
      </div>
      <label htmlFor={inputId} className="mt-3 block text-xs font-semibold text-slate-600">怎么做（给自己看的提示）</label>
      <input
        id={inputId}
        value={step.description}
        maxLength={POSE_DESCRIPTION_MAX}
        onChange={(event) => onDescription(event.target.value)}
        placeholder={target === 'start' ? '例如：站直，双臂自然下垂' : '例如：双臂侧平举到肩高'}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      />
      {active ? (
        <div className="mt-3" role="status" aria-live="polite">
          <p className="text-sm font-semibold text-blue-800">
            {progress?.status === 'waiting-body'
              ? `请站到摄像头前，做出${title}${progress.missing.length ? `（还看不到：${progress.missing.map((name) => JOINT_LABEL[name]).join('、')}）` : ''}`
              : `做出${title}并保持不动… ${Math.round((progress?.progress ?? 0) * 100)}%`}
          </p>
          <progress className="mt-2 h-2 w-full accent-blue-600" max={1} value={progress?.progress ?? 0} aria-label={`${title}记录进度`} />
          <button type="button" onClick={onCancel} className="mt-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-slate-600 hover:bg-white"><X size={14} aria-hidden="true" />取消记录</button>
        </div>
      ) : method === 'camera' ? (
        <button type="button" onClick={onRecord} disabled={Boolean(capture)} className={cn('mt-3 inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50', step.capture ? 'secondary-button' : 'primary-button')} data-testid={`record-${target}`}>
          {step.capture ? <RotateCcw size={16} aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />}{step.capture ? '重新记录' : `记录${title}`}
        </button>
      ) : <p className="mt-3 text-xs leading-5 text-slate-500">在下方视频中找到这个画面，再点“记录为{title}”。</p>}
    </div>
  )
}

function percentInput(value: number): number {
  return Math.round(value * 100)
}

export function RequirementsStep({ draft, setup, capture, method, onMethodChange, onPoseDescription, onRecord, onCancelCapture, onVideoCapture, onSuggestion, onToggleRequirement, onRequirementThreshold, onSource, onProfile, onThresholds, onTiming, onExport }: {
  draft: CustomActionDefinition
  setup: RecognitionSetup
  capture: { target: CaptureTarget; progress: CaptureProgress | null } | null
  method: DemonstrationMethod
  onMethodChange: (method: DemonstrationMethod) => void
  onPoseDescription: (target: CaptureTarget, value: string) => void
  onRecord: (target: CaptureTarget) => void
  onCancelCapture: () => void
  onVideoCapture: (target: CaptureTarget, pose: NonNullable<CustomActionDefinition['startPose']['capture']>) => void
  onSuggestion: (suggestion: ContinuousSuggestion) => void
  onToggleRequirement: (id: RequirementId, enabled: boolean) => void
  onRequirementThreshold: (id: RequirementId, value: number | undefined) => void
  onSource: (source: SignalSource) => void
  onProfile: (profile: CustomActionDefinition['recognition']['profile']) => void
  onThresholds: (thresholds: PhaseThresholds) => void
  onTiming: (patch: Partial<Pick<CustomActionDefinition['recognition'], 'minRepMs' | 'holdSeconds'>>) => void
  onExport: () => void
}) {
  const poseMatch = buildPoseMatch(draft.startPose.capture, draft.finishPose.capture)
  const joints = poseMatch.model ? activeJointNames(poseMatch.model) : []
  const bothRecorded = Boolean(draft.startPose.capture && draft.finishPose.capture)
  const durationGoal = draft.goal.type === 'duration'
  const thresholds = draft.recognition.thresholds
  const thresholdError = !(thresholds.returnThreshold <= thresholds.moving && thresholds.moving < thresholds.peak)
  return (
    <div className="grid gap-6">
      <section aria-labelledby="poses-title">
        <h3 id="poses-title" className="font-bold text-slate-950">1. 示范开始姿势和完成姿势</h3>
        <p className="mt-1 text-pretty text-sm leading-6 text-slate-600">选一种示范方式，分别记录动作开始和完成时的姿势。让{PROFILE_OPTIONS[draft.recognition.profile].framing}完整入镜；只保存身体关键点，不保存画面。</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2" role="group" aria-label="选择示范方式">
          <button type="button" onClick={() => onMethodChange('camera')} aria-pressed={method === 'camera'} className={cn('rounded-xl border px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', method === 'camera' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white')} data-testid="method-camera">
            <span className="block font-bold text-slate-950">现在用摄像头示范</span><span className="mt-1 block text-xs text-slate-600">做出姿势并保持约 1 秒</span>
          </button>
          <button type="button" onClick={() => onMethodChange('video')} aria-pressed={method === 'video'} className={cn('rounded-xl border px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', method === 'video' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white')} data-testid="method-video">
            <span className="block font-bold text-slate-950">使用已有视频</span><span className="mt-1 block text-xs text-slate-600">选本机文件，暂停在两个姿势</span>
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <PoseCard target="start" draft={draft} capture={capture} method={method} onDescription={(value) => onPoseDescription('start', value)} onRecord={() => onRecord('start')} onCancel={onCancelCapture} />
          <PoseCard target="finish" draft={draft} capture={capture} method={method} onDescription={(value) => onPoseDescription('finish', value)} onRecord={() => onRecord('finish')} onCancel={onCancelCapture} />
        </div>
        {method === 'video' ? <VideoDemonstrationInput profile={draft.recognition.profile} onCapture={onVideoCapture} onSuggestion={onSuggestion} onUseCamera={() => onMethodChange('camera')} /> : null}
        {bothRecorded ? (
          <div className="mt-3 flex flex-col gap-4 rounded-2xl bg-slate-50 p-4 sm:flex-row sm:items-center" data-testid="calibration-summary">
            <PoseSketch start={draft.startPose.capture} finish={draft.finishPose.capture} className="h-32 w-28 shrink-0" />
            {poseMatch.model ? (
              <div className="min-w-0 text-sm leading-6 text-slate-700">
                <p className="font-bold text-slate-950">已记录开始和完成姿势</p>
                <p className="mt-1 text-pretty">会重点看：<span className="font-semibold text-blue-800" data-testid="active-joints">{joints.map((name) => JOINT_LABEL[name]).join('、')}</span>。</p>
                <p className="mt-1 text-pretty text-slate-500">灰色是开始姿势，蓝色是完成姿势。下一步请实际测试，确认能否识别完整动作。</p>
              </div>
            ) : (
              <p className="flex items-start gap-2 text-sm font-semibold text-coral-600" role="alert"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{setup.issue}</p>
            )}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="requirements-title">
        <h3 id="requirements-title" className="font-bold text-slate-950">2. 选择识别重点</h3>
        <p className="mt-1 text-pretty text-sm leading-6 text-slate-600">每做完一次，FormPilot 会检查这些要求，没做到时提醒你。阈值会参考你示范的完成姿势。</p>
        <ul className="mt-3 grid gap-2" data-testid="requirement-options">
          {REQUIREMENT_ORDER.filter((id) => !(durationGoal && id === 'full-return')).map((id) => {
            const option = REQUIREMENTS[id]
            const setting = draft.requirements.find((item) => item.id === id)
            const locked = id === 'full-return'
            const suggestion = suggestRequirement(id, draft)
            const inputId = `requirement-${id}`
            return (
              <li key={id} className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                <div className="flex items-start gap-3">
                  <input id={inputId} type="checkbox" checked={Boolean(setting?.enabled)} disabled={locked} onChange={(event) => onToggleRequirement(id, event.target.checked)} className="mt-1 size-4 shrink-0 accent-blue-600" aria-describedby={`${inputId}-description`} />
                  <div className="min-w-0 flex-1">
                    <label htmlFor={inputId} className="font-semibold text-slate-900">{option.label}{locked ? <span className="ml-2 text-xs font-semibold text-slate-500">计次条件（必选）</span> : null}</label>
                    <p id={`${inputId}-description`} className="mt-0.5 text-pretty text-xs leading-5 text-slate-500">{option.description}</p>
                    {setting?.enabled && suggestion.conflict ? <p className="mt-1.5 flex items-start gap-1.5 text-pretty text-xs font-semibold leading-5 text-amber-800"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{suggestion.conflict}可以关闭这一项，或在高级设置里调整。</p> : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <details className="group rounded-2xl border border-slate-200 bg-white" data-testid="workshop-advanced">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4 marker:content-none">
          <span className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-700" aria-hidden="true"><ScanLine size={18} /></span>
          <span className="min-w-0 flex-1"><span className="block font-bold text-slate-950">高级设置</span><span className="block text-xs text-slate-500">识别方式、身体区域、阶段阈值、计次规则和动作文件</span></span>
        </summary>
        <div className="grid gap-5 border-t border-slate-100 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="signal-source" className="text-sm font-semibold text-slate-900">识别方式</label>
              <select id="signal-source" value={draft.recognition.source} onChange={(event) => onSource(event.target.value as SignalSource)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                {SIGNAL_SOURCE_ORDER.map((source) => <option key={source} value={source}>{SIGNAL_SOURCE_OPTIONS[source].label}</option>)}
              </select>
              <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">{SIGNAL_SOURCE_OPTIONS[draft.recognition.source].description}</p>
            </div>
            <div>
              <label htmlFor="recognition-profile" className="text-sm font-semibold text-slate-900">身体区域（取景）</label>
              <select id="recognition-profile" value={draft.recognition.profile} onChange={(event) => onProfile(event.target.value as CustomActionDefinition['recognition']['profile'])} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                {PROFILE_ORDER.map((profile) => <option key={profile} value={profile}>{PROFILE_OPTIONS[profile].label}</option>)}
              </select>
            </div>
          </div>
          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">阶段阈值（{setup.mode === 'template' ? '100% = 模板的到位值' : '100% = 你示范的完成姿势'}）</legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {([
                ['returnThreshold', '回到起始 ≤'],
                ['moving', '开始动作 ≥'],
                ['peak', '到位 ≥'],
              ] as const).map(([key, label]) => (
                <label key={key} className="text-xs font-semibold text-slate-600">
                  {label}
                  <span className="mt-1 flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={200}
                      step={5}
                      value={percentInput(thresholds[key])}
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        if (Number.isFinite(value)) onThresholds({ ...thresholds, [key]: Math.max(0, Math.min(2, value / 100)) })
                      }}
                      aria-invalid={thresholdError ? true : undefined}
                      aria-describedby="threshold-help"
                      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    />%
                  </span>
                </label>
              ))}
            </div>
            <p id="threshold-help" className={cn('mt-1.5 text-xs leading-5', thresholdError ? 'font-semibold text-coral-600' : 'text-slate-500')}>{thresholdError ? '需要满足：回到起始 ≤ 开始动作 < 到位。' : '动作超过“开始动作”进入识别，超过“到位”算做到了，回到“回到起始”以下才完成一次。'}</p>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-900">
              单次最短时间（毫秒）
              <input type="number" min={0} max={5000} step={100} value={draft.recognition.minRepMs} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) onTiming({ minRepMs: Math.max(0, Math.min(5000, Math.round(value))) }) }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
              <span className="mt-1 block text-xs font-normal text-slate-500">比这更快的往返视为抖动，不计次。</span>
            </label>
            <label className="text-sm font-semibold text-slate-900">
              到位后保持（秒）
              <input type="number" min={0.5} max={30} step={0.5} value={draft.recognition.holdSeconds} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) onTiming({ holdSeconds: Math.max(0.5, Math.min(30, value)) }) }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
              <span className="mt-1 block text-xs font-normal text-slate-500">用于“拉伸保持”模板：保持这么久才算一次。</span>
            </label>
          </div>
          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">识别重点的阈值</legend>
            <p className="mt-0.5 text-xs text-slate-500">留空表示跟随你的示范自动设定。</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {REQUIREMENT_ORDER.filter((id) => REQUIREMENTS[id].threshold).map((id) => {
                const limits = REQUIREMENTS[id].threshold!
                const setting = draft.requirements.find((item) => item.id === id)
                const suggestion = suggestRequirement(id, draft)
                return (
                  <label key={id} className="text-xs font-semibold text-slate-600">
                    {REQUIREMENTS[id].label} · {limits.label}
                    <span className="mt-1 flex items-center gap-1">
                      <input
                        type="number"
                        min={limits.min}
                        max={limits.max}
                        step={limits.step}
                        value={setting?.threshold ?? ''}
                        placeholder={String(suggestion.threshold)}
                        onChange={(event) => {
                          const raw = event.target.value
                          if (raw === '') return onRequirementThreshold(id, undefined)
                          const value = Number(raw)
                          if (Number.isFinite(value)) onRequirementThreshold(id, Math.max(limits.min, Math.min(limits.max, value)))
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      />{limits.unit}
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            <p className="flex items-center gap-1.5 font-semibold text-slate-800"><Info size={14} aria-hidden="true" />阶段与计次</p>
            <p className="mt-1">{durationGoal ? '准备 → 到位后开始保持 → 离开完成姿势时暂停计时；每保持 1 秒检查一次识别重点。' : setup.counting === 'orbit' ? '手臂绕满一圈计 1 次。' : setup.counting === 'alternate' ? '左右交替：换到另一侧计 1 次。' : '准备 → 动作中 → 到位 → 回到起始 → 计 1 次。识别中断会重新开始这一次。'}</p>
            <p className="mt-1">当前：{setup.mode === 'pose-match' ? '按示范姿势比对' : setup.mode === 'template-calibrated' ? '模板信号，按你的示范校准' : '模板信号，使用模板默认阈值'}。</p>
          </div>
          <div>
            <button type="button" onClick={onExport} className="secondary-button inline-flex items-center gap-2"><Download size={16} aria-hidden="true" />导出这个动作（JSON 文件）</button>
          </div>
        </div>
      </details>
    </div>
  )
}

// ---- 3 · 测试 ----------------------------------------------------------------------------------------------------------

export function TestStep({ draft, setup, snapshot, testing, passed, onStart, cameraReady }: {
  draft: CustomActionDefinition
  setup: RecognitionSetup
  snapshot: RecognizerSnapshot | null
  testing: boolean
  passed: boolean
  cameraReady: boolean
  onStart: () => void
}) {
  const durationGoal = draft.goal.type === 'duration'
  const needed = durationGoal ? 3 : Math.min(3, (draft.goal as { target: number }).target)
  return (
    <div className="grid gap-5">
      <div className="rounded-2xl bg-blue-50/70 p-4 text-pretty text-sm leading-6 text-blue-950">
        {durationGoal
          ? '做到完成姿势并保持住。FormPilot 累计识别到 3 秒保持，就算测试通过。'
          : `按平时的节奏完整做几次。识别到 ${needed} 次完整动作，且识别重点都达标，测试才算通过。`}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onStart} disabled={!setup.ready} className="primary-button inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50" data-testid="test-start">
          {testing ? <RotateCcw size={16} aria-hidden="true" /> : <ScanLine size={16} aria-hidden="true" />}{testing ? '重新开始测试' : cameraReady ? '开始测试' : '启用摄像头并开始测试'}
        </button>
        {!setup.ready ? <p className="text-sm font-semibold text-coral-600" role="alert">{setup.issue}</p> : null}
      </div>
      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4" data-testid="test-readout" data-reps={snapshot?.reps ?? 0} data-testing={testing ? 'true' : 'false'}>
        <ProgressMeter progress={testing ? snapshot?.progress ?? null : null} phase={snapshot?.phase ?? 'READY'} thresholds={setup.thresholds} />
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-xs text-slate-500">{durationGoal ? '已保持' : '已识别'}</dt>
            <dd className="text-2xl font-bold tabular-nums text-slate-950" data-testid="test-count">{durationGoal ? `${Math.floor((snapshot?.holdMs ?? 0) / 1000)} 秒` : `${snapshot?.reps ?? 0} 次`}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-xs text-slate-500">{durationGoal ? '达标的秒数' : '识别重点都达标'}</dt>
            <dd className="text-2xl font-bold tabular-nums text-slate-950">{snapshot?.passedReps ?? 0} {durationGoal ? '秒' : '次'}</dd>
          </div>
        </dl>
        <p className={cn('rounded-xl px-3 py-2 text-sm font-semibold', snapshot?.feedback?.tone === 'warning' ? 'bg-coral-50 text-coral-600' : snapshot?.feedback?.tone === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-700')} role="status" aria-live="polite" data-testid="test-feedback">
          {testing ? snapshot?.feedback?.message ?? '准备好后开始动作' : '点击“开始测试”后开始识别'}
        </p>
        <div>
          <h3 className="text-sm font-bold text-slate-900">上一次的识别重点</h3>
          <div className="mt-2"><RequirementResults results={snapshot?.lastRep?.requirements} /></div>
        </div>
      </div>
      {passed ? (
        <p className="flex items-start gap-2 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-900" role="status" data-testid="test-passed"><Check size={17} className="mt-0.5 shrink-0" aria-hidden="true" />测试通过：FormPilot 已经能识别「{draft.name || '这个动作'}」。可以继续练习，或进入下一步保存。</p>
      ) : (
        <p className="text-pretty text-xs leading-5 text-slate-500">识别不准？回到上一步重新记录开始和完成姿势，或在高级设置里调整阈值。</p>
      )}
    </div>
  )
}

// ---- 4 · 保存 ----------------------------------------------------------------------------------------------------------

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid gap-1 py-2.5 sm:grid-cols-[120px_minmax(0,1fr)]"><dt className="text-sm text-slate-500">{label}</dt><dd className="min-w-0 text-sm font-semibold text-slate-900">{children}</dd></div>
}

export function SaveStep({ draft, problems }: { draft: CustomActionDefinition; problems: string[] }) {
  const enabled = draft.requirements.filter((item) => item.enabled && !(draft.goal.type === 'duration' && item.id === 'full-return'))
  return (
    <div className="grid gap-5">
      <dl className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white px-4" data-testid="save-summary">
        <SummaryRow label="动作名称">{draft.name || <span className="text-coral-600">未填写</span>}</SummaryRow>
        {draft.description ? <SummaryRow label="简单描述">{draft.description}</SummaryRow> : null}
        <SummaryRow label="训练部位">{BODY_AREAS[draft.bodyArea].label}</SummaryRow>
        <SummaryRow label="计数方式">{draft.goal.type === 'reps' ? '按次数' : '按时间'} · 目标 {goalText(draft.goal)}</SummaryRow>
        <SummaryRow label="开始 / 完成姿势">
          <span className="flex items-center gap-3">
            <PoseSketch start={draft.startPose.capture} finish={draft.finishPose.capture} className="h-20 w-16 shrink-0" />
            <span>{draft.startPose.description || '开始姿势'} → {draft.finishPose.description || '完成姿势'}{draft.startPose.capture && draft.finishPose.capture ? '（已记录）' : '（未记录）'}</span>
          </span>
        </SummaryRow>
        <SummaryRow label="识别重点">{enabled.map((item) => REQUIREMENTS[item.id].label).join('、') || '—'}</SummaryRow>
        <SummaryRow label="识别方式">{SIGNAL_SOURCE_OPTIONS[draft.recognition.source].label}</SummaryRow>
        <SummaryRow label="测试">{draft.test.status === 'passed' ? `已通过（识别到 ${draft.test.repsDetected ?? 0} 次）` : '未测试，建议先测试再保存'}</SummaryRow>
      </dl>
      {problems.length ? (
        <ul className="grid gap-1.5 rounded-2xl bg-coral-50 p-4 text-sm font-semibold text-coral-600" role="alert" data-testid="save-problems">
          {problems.map((problem) => <li key={problem} className="flex items-start gap-1.5"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />{problem}</li>)}
        </ul>
      ) : null}
    </div>
  )
}
