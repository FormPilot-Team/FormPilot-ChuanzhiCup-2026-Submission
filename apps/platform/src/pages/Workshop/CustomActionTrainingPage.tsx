import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { AlertTriangle, ArrowLeft, Pause, PencilLine, Play, Square, Volume2, VolumeX } from 'lucide-react'
import { useState } from 'react'
import { WORKSHOP_PATH, customTrainingPath, reportPath, workshopActionPath } from '../../app/routes'
import { CameraPanel } from '../../components/camera/CameraPanel'
import { CoachAvatar } from '../../components/coach/CoachAvatar'
import { AICoach } from '../../components/aiCoach/AICoach'
import { AppHeader } from '../../components/layout/AppHeader'
import { buildCustomCoachContext, customGuide } from '../../features/coachContext/liveCoachContexts'
import { PoseSketch } from '../../components/workshop/PoseSketch'
import { ProgressMeter, RequirementResults } from '../../components/workshop/RecognitionReadout'
import { BODY_AREAS } from '../../features/workshop/catalog'
import { goalText } from '../../features/workshop/definition'
import { LocalStorageCustomActionRepository, type CustomActionRepository } from '../../features/workshop/store'
import type { CustomActionDefinition } from '../../features/workshop/types'
import { cn } from '../../lib/cn'
import { useCustomActionRuntime, type CustomActionRuntime } from './useCustomActionRuntime'

const localRepository = new LocalStorageCustomActionRepository()

/** DEV synthetic camera (`?fixture=synthetic`): the warm-up's own camera demo picture behind the synthetic skeleton. */
const SYNTHETIC_BACKDROP = { portraitSrc: '/assets/camera-lateral-raise-demo.png', landscapeSrc: '/assets/camera-lateral-raise-demo.png', alt: '合成测试画面', fit: 'contain' as const }

function stateText(runtime: CustomActionRuntime): string {
  if (runtime.sessionStatus === 'paused') return '已暂停'
  switch (runtime.courseSnapshot.state) {
    case 'PAUSED': return '等待回到画面'
    case 'COUNTDOWN': return `${runtime.courseSnapshot.countdown} · 准备开始`
    case 'ACTIVE': return '训练中'
    case 'TRANSITION':
    case 'COURSE_COMPLETE': return '训练完成 ✓'
    case 'COURSE_INCOMPLETE': return '训练已结束'
    default: return runtime.camera.capturing ? '请进入准备姿势' : '启用摄像头后开始'
  }
}

function coachLine(runtime: CustomActionRuntime): { message: string; tone: 'neutral' | 'info' | 'success' | 'warning' } {
  const state = runtime.courseSnapshot.state
  if (runtime.sessionStatus === 'completed' || state === 'COURSE_COMPLETE' || state === 'TRANSITION') return { message: '本次训练完成，可以查看训练报告。', tone: 'success' }
  if (!runtime.setup.ready) return { message: runtime.setup.issue ?? '这个动作还不能训练。', tone: 'warning' }
  if (runtime.sessionStatus === 'paused') return { message: '已暂停。双手在胸前合拢并保持，可以继续训练。', tone: 'neutral' }
  if (state === 'PAUSED') return { message: '请回到画面中，识别到你后会自动继续。', tone: 'warning' }
  if (state === 'COUNTDOWN') return { message: `准备开始：${runtime.action.startPose.description || '做好开始姿势'}。`, tone: 'info' }
  if (state === 'ACTIVE') {
    const feedback = runtime.snapshot?.feedback
    if (feedback) return { message: feedback.message, tone: feedback.tone }
    return { message: '从开始姿势出发，做到完成姿势。', tone: 'info' }
  }
  if (!runtime.camera.capturing) return { message: `启用摄像头，让${runtime.setup.framingLabel}完整入镜。`, tone: 'neutral' }
  if (!runtime.framing.valid) return { message: runtime.framing.hint ?? `请让${runtime.setup.framingLabel}完整入镜。`, tone: 'info' }
  return { message: '站好了！双手在胸前合拢并保持，开始训练。', tone: 'info' }
}

const TONE: Readonly<Record<'neutral' | 'info' | 'success' | 'warning', string>> = {
  neutral: 'border-slate-200 bg-white',
  info: 'border-blue-100 bg-blue-50/60',
  success: 'border-emerald-200 bg-emerald-50/70',
  warning: 'border-coral-500/40 bg-coral-50',
}

function CompleteDialog({ runtime }: { runtime: CustomActionRuntime }) {
  const { completion, action } = runtime
  if (!completion) return null
  const started = completion.recordId !== null
  const title = !started ? '本次训练还没有开始' : completion.saved ? '本次训练已保存' : '本次训练未能保存'
  const status = !started ? '还没有开始训练，因此没有生成记录。' : completion.outcome === 'completed' ? `${action.name}已完成 ${goalText(action.goal)}` : '训练提前结束，已保存已完成的部分'
  return (
    <AlertDialog.Root open>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-30 bg-slate-900/20" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-40 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-8 text-center shadow-xl" data-testid="custom-complete-dialog" data-outcome={completion.outcome}>
          <AlertDialog.Title className="text-balance text-2xl font-bold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-3 space-y-1 text-pretty text-sm text-slate-500">
            <span className="block font-semibold text-slate-800">{status}</span>
            {started ? <span className="mt-2 block">训练报告已准备好，可以查看完成情况和每个识别重点。</span> : null}
            {started && !completion.saved ? <span className="mt-2 block text-coral-600">本地保存失败，结果仅在本页有效。</span> : null}
          </AlertDialog.Description>
          {started && completion.saved && completion.recordId ? (
            <AlertDialog.Action asChild>
              <button type="button" onClick={() => window.location.assign(reportPath(completion.recordId as string))} className="primary-button mt-6">查看训练报告</button>
            </AlertDialog.Action>
          ) : null}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" onClick={() => window.location.assign(customTrainingPath(action.id))} className="secondary-button">再练一次</button>
            <button type="button" onClick={() => window.location.assign(WORKSHOP_PATH)} className="secondary-button">返回动作工坊</button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

function Footer({ runtime }: { runtime: CustomActionRuntime }) {
  const { step, count, sessionStatus } = runtime
  const progress = step.target > 0 ? Math.min(1, count / step.target) : 0
  const canControl = sessionStatus === 'active' || sessionStatus === 'paused'
  const paused = sessionStatus === 'paused'
  return (
    <section className="panel grid min-w-0 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center" aria-label="训练控制" data-testid="custom-footer">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-semibold text-slate-800">训练进度 · {runtime.action.name}</p>
          <p className="shrink-0 text-xs tabular-nums text-slate-500">完成 {count} / {step.target} {step.unit}</p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="训练进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className="fp-energy-gradient h-full rounded-full" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <div className="flex items-center justify-center gap-4">
        <button type="button" onClick={runtime.toggleVoice} disabled={!runtime.voiceAvailable} aria-pressed={!runtime.voiceEnabled} aria-label={runtime.voiceAvailable ? runtime.voiceEnabled ? '静音' : '开启语音' : '语音不可用'} className="inline-flex h-12 items-center gap-2 rounded-full bg-slate-100 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50">
          {runtime.voiceEnabled && runtime.voiceAvailable ? <Volume2 size={19} aria-hidden="true" /> : <VolumeX size={19} aria-hidden="true" />}
          {runtime.voiceAvailable ? runtime.voiceEnabled ? '语音' : '静音' : '语音不可用'}
        </button>
        <button type="button" onClick={runtime.togglePause} disabled={!canControl} aria-label={paused ? '继续训练' : '暂停训练'} className="grid size-14 place-items-center rounded-full bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
          {paused ? <Play size={22} fill="currentColor" aria-hidden="true" /> : <Pause size={22} fill="currentColor" aria-hidden="true" />}
        </button>
        <AlertDialog.Root>
          <AlertDialog.Trigger asChild><button type="button" disabled={!canControl} aria-label="结束训练" className="grid size-14 place-items-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"><Square size={18} fill="currentColor" aria-hidden="true" /></button></AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30" />
            <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-6 shadow-xl">
              <AlertDialog.Title className="text-balance text-lg font-bold text-slate-900">确认结束本次训练？</AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-pretty text-sm leading-6 text-slate-500">已完成 {count} / {step.target} {step.unit}。结束后会保存已完成的部分，并标记为未完成。</AlertDialog.Description>
              <div className="mt-6 flex justify-end gap-3"><AlertDialog.Cancel asChild><button type="button" className="secondary-button">继续训练</button></AlertDialog.Cancel><AlertDialog.Action asChild><button type="button" onClick={runtime.finish} className="danger-button">结束并保存</button></AlertDialog.Action></div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
    </section>
  )
}

function CustomTrainingView({ action }: { action: CustomActionDefinition }) {
  const runtime = useCustomActionRuntime(action)
  const coach = coachLine(runtime)
  const { courseSnapshot, snapshot, setup, step } = runtime
  const capturing = runtime.camera.capturing
  const outOfFrame = capturing && courseSnapshot.state === 'ACTIVE' && !runtime.framing.valid && !runtime.poseUnavailable
  return (
    <div className="fp-page min-h-dvh min-w-0 overflow-x-clip text-slate-900" data-custom-action={action.id}>
      <AppHeader immersive />
      <main className="mx-auto min-w-0 max-w-[1500px] px-4 py-5 lg:px-7">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <a href={WORKSHOP_PATH} className="mb-1 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-sm font-semibold text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ArrowLeft size={15} aria-hidden="true" />动作工坊</a>
            <h1 className="text-balance text-2xl font-bold text-slate-950 lg:text-3xl">{action.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-pretty text-sm text-slate-500">
              <span className="rounded-md bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">我的动作</span>
              <span>{BODY_AREAS[action.bodyArea].label}</span><span aria-hidden="true">·</span><span>目标 {goalText(action.goal)}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AICoach context={{ page: 'training', live: buildCustomCoachContext({ action, setup, courseState: courseSnapshot.state, count: runtime.count, target: step.target, snapshot }), guide: customGuide(action, setup) }} variant="inline" />
            <p className="rounded-2xl bg-blue-50 px-5 py-3 text-sm font-semibold text-blue-700" data-testid="custom-state" data-course-state={courseSnapshot.state} data-session-status={runtime.sessionStatus}>{stateText(runtime)}</p>
          </div>
        </div>

        {!setup.ready ? (
          <p className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="alert" data-testid="custom-not-ready">
            <AlertTriangle size={17} aria-hidden="true" />{setup.issue}
            <a href={workshopActionPath(action.id)} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"><PencilLine size={15} aria-hidden="true" />去编辑</a>
          </p>
        ) : action.test.status !== 'passed' ? (
          <p className="mb-4 rounded-2xl bg-slate-100 px-4 py-2.5 text-sm text-slate-700" role="status">这个动作还没有通过测试，识别可能不够准；可以先在动作工坊里测试一下。</p>
        ) : null}

        <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]" data-testid="custom-training-layout">
          <CameraPanel
            videoRef={runtime.camera.videoRef}
            demoImageRef={runtime.camera.demoImageRef}
            overlayRef={runtime.camera.overlayRef}
            mode={runtime.camera.mode}
            failure={runtime.camera.failure}
            errors={outOfFrame ? [{ code: 'BODY_OUT_OF_FRAME', severity: 1, message: runtime.framing.hint ?? '' }] : []}
            demoAsset={SYNTHETIC_BACKDROP}
            preparationMessage={runtime.preparationMessage}
            gesturePrompt={runtime.gesturePrompt}
            gestureProgress={runtime.gestureProgress}
            gestureHolding={runtime.gestureHolding}
            outOfFrameMessage={runtime.framing.hint ?? `请让${setup.framingLabel}完整入镜`}
            showPoseOverlay={courseSnapshot.state === 'PREPARING' || courseSnapshot.state === 'COUNTDOWN'}
            course={courseSnapshot}
            onStart={() => void runtime.start()}
          />
          <section className="panel flex min-w-0 flex-col gap-3 p-4" aria-labelledby="custom-feedback-title" data-testid="custom-feedback">
            <h2 id="custom-feedback-title" className="font-bold text-slate-900">实时反馈</h2>
            <div className={cn('flex min-w-0 items-start gap-3 rounded-2xl border p-3', TONE[coach.tone])} data-testid="custom-coach-entry" data-coach-tone={coach.tone}>
              <CoachAvatar className="size-10" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-blue-700">AI 教练</p>
                <p className="mt-0.5 text-pretty text-sm font-semibold leading-6 text-slate-900" role="status" aria-live="polite" aria-atomic="true" data-testid="custom-coach-message">{coach.message}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-3">
              <p className="text-xs text-slate-500">{step.unit === '秒' ? '已保持' : '已完成'}</p>
              <p className="mt-0.5 flex items-baseline gap-1.5"><strong className="text-4xl font-bold tabular-nums text-slate-950" data-testid="custom-count">{runtime.count}</strong><span className="text-base font-semibold text-slate-500">/ {step.target} {step.unit}</span></p>
              <p className="mt-1 text-xs tabular-nums text-slate-500">识别重点都达标：{snapshot?.passedReps ?? 0} {step.unit}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-3">
              <ProgressMeter progress={courseSnapshot.state === 'ACTIVE' ? snapshot?.progress ?? null : null} phase={snapshot?.phase ?? 'READY'} thresholds={setup.thresholds} />
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-3">
              <h3 className="text-sm font-bold text-slate-900">上一次的识别重点</h3>
              <div className="mt-2"><RequirementResults results={snapshot?.lastRep?.requirements} emptyText="完成一次动作后显示" /></div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
              <PoseSketch start={action.startPose.capture} finish={action.finishPose.capture} className="h-20 w-16 shrink-0" />
              <p className="min-w-0 text-pretty text-sm leading-6 text-slate-700"><span className="font-semibold">开始：</span>{action.startPose.description || '开始姿势'}<br /><span className="font-semibold">完成：</span>{action.finishPose.description || '完成姿势'}</p>
            </div>
          </section>
        </div>

        <div className="mt-3"><Footer runtime={runtime} /></div>

        {runtime.debug ? (
          <section className="panel mt-3 p-4" aria-label="调试信息" data-testid="custom-debug">
            <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {runtime.debugData.map((item) => <div key={item.label} className="flex min-w-0 justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"><dt className="text-slate-500">{item.label}</dt><dd className="truncate font-mono text-slate-800">{item.value}</dd></div>)}
            </dl>
          </section>
        ) : null}
      </main>
      <CompleteDialog runtime={runtime} />
    </div>
  )
}

/** /workshop/:id/train — a saved custom action as a training, like every other mode. */
export function CustomActionTrainingPage({ actionId, repository = localRepository }: { actionId: string; repository?: CustomActionRepository }) {
  const [action] = useState(() => repository.get(actionId))
  if (!action) {
    return (
      <div className="fp-page min-h-dvh text-slate-900">
        <AppHeader immersive />
        <main className="mx-auto grid min-h-[60dvh] max-w-3xl place-items-center px-4 py-12">
          <section className="fp-card w-full p-8 text-center" data-testid="custom-training-not-found">
            <AlertTriangle className="mx-auto text-amber-600" size={28} aria-hidden="true" />
            <h1 className="mt-3 text-balance text-2xl font-bold">没有找到这个动作</h1>
            <p className="mt-2 text-pretty text-sm text-slate-600">它可能已经被删除。可以回到动作工坊重新创建。</p>
            <a href={WORKSHOP_PATH} className="primary-button mt-6 inline-flex items-center gap-2"><ArrowLeft size={16} aria-hidden="true" />回到动作工坊</a>
          </section>
        </main>
      </div>
    )
  }
  return <CustomTrainingView action={action} />
}
