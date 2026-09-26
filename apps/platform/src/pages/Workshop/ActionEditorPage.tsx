import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Save } from 'lucide-react'
import { WORKSHOP_PATH } from '../../app/routes'
import { CameraPanel } from '../../components/camera/CameraPanel'
import { AppHeader } from '../../components/layout/AppHeader'
import { JOINT_LABEL } from '../../features/workshop/catalog'
import {
  createDraftAction, validateForSave, withBodyArea, withSignalSource,
} from '../../features/workshop/definition'
import { downloadJson } from '../../features/workshop/download'
import { PoseCaptureSession, type CaptureProgress } from '../../features/workshop/recognition/capture'
import { CustomActionRecognizer, resolveRecognition, type RecognizerSnapshot } from '../../features/workshop/recognition/recognizer'
import { PROFILE_BOUNDS } from '../../features/workshop/recognition/templates'
import { LocalStorageCustomActionRepository, type CustomActionRepository } from '../../features/workshop/store'
import { buildExport, exportFileName } from '../../features/workshop/transfer'
import type { CustomActionDefinition, RequirementId } from '../../features/workshop/types'
import { cn } from '../../lib/cn'
import { BasicsStep, RequirementsStep, SaveStep, StepHeading, TestStep, type CaptureTarget } from './editorSteps'
import { useWorkshopCamera, type WorkshopFrame } from './useWorkshopCamera'

const localRepository = new LocalStorageCustomActionRepository()

/** DEV synthetic camera (`?fixture=synthetic`): the warm-up's own camera demo picture behind the synthetic skeleton. */
const SYNTHETIC_BACKDROP = { portraitSrc: '/assets/camera-lateral-raise-demo.png', landscapeSrc: '/assets/camera-lateral-raise-demo.png', alt: '合成测试画面', fit: 'contain' as const }

type EditorStep = 'basics' | 'requirements' | 'test' | 'save'

const STEPS: ReadonlyArray<{ id: EditorStep; label: string; title: string; description: string }> = [
  { id: 'basics', label: '创建动作', title: '1 · 创建动作', description: '给动作起个名字，选好训练部位和计数方式。' },
  { id: 'requirements', label: '设置识别要求', title: '2 · 设置识别要求', description: '示范开始姿势和完成姿势，再选出这个动作最重要的要求。' },
  { id: 'test', label: '测试', title: '3 · 测试', description: '实际做几次，看看 FormPilot 能不能准确识别。' },
  { id: 'save', label: '保存', title: '4 · 保存', description: '确认信息后保存，之后可以在“开始训练 · 我的动作”里直接练。' },
]

const stepIndex = (step: EditorStep) => STEPS.findIndex((item) => item.id === step)

function testPasses(snapshot: RecognizerSnapshot, action: CustomActionDefinition): boolean {
  if (action.goal.type === 'duration') return snapshot.holdMs >= 3000
  return snapshot.reps >= Math.min(3, action.goal.target)
}

function captureMessage(capture: { target: CaptureTarget; progress: CaptureProgress | null } | null): string | undefined {
  if (!capture) return undefined
  const title = capture.target === 'start' ? '开始姿势' : '完成姿势'
  const progress = capture.progress
  if (!progress || progress.status === 'waiting-body') {
    const missing = progress?.missing.length ? `（还看不到：${progress.missing.slice(0, 4).map((name) => JOINT_LABEL[name]).join('、')}）` : ''
    return `请做出${title}${missing}`
  }
  return `保持${title}不动 · ${Math.round(progress.progress * 100)}%`
}

export function ActionEditorPage({ actionId, repository = localRepository }: { actionId?: string; repository?: CustomActionRepository }) {
  const synthetic = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fixture') === 'synthetic'
  const [existing] = useState(() => (actionId ? repository.get(actionId) : undefined))
  const [readOnly] = useState(() => repository.load().readOnly)
  const [draft, setDraft] = useState<CustomActionDefinition>(() => existing ?? createDraftAction())
  const [step, setStep] = useState<EditorStep>('basics')
  const [errors, setErrors] = useState<{ name?: string }>({})
  const [stepNotice, setStepNotice] = useState<string>()
  const [saveProblems, setSaveProblems] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [capture, setCapture] = useState<{ target: CaptureTarget; progress: CaptureProgress | null } | null>(null)
  const [testing, setTesting] = useState(false)
  const [snapshot, setSnapshot] = useState<RecognizerSnapshot | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const captureRef = useRef<{ target: CaptureTarget; session?: PoseCaptureSession } | null>(null)
  const testingRef = useRef(false)
  const recognizerRef = useRef<CustomActionRecognizer | null>(null)
  const passedRef = useRef(false)
  const lastUiRef = useRef(0)
  const setup = useMemo(() => resolveRecognition(draft), [draft])

  const change = useCallback((next: CustomActionDefinition | ((previous: CustomActionDefinition) => CustomActionDefinition)) => {
    setDraft(next)
    setDirty(true)
  }, [])

  /** Any change to how the action is recognised invalidates an earlier test. */
  const changeRecognition = useCallback((next: (previous: CustomActionDefinition) => CustomActionDefinition) => {
    change((previous) => ({ ...next(previous), test: { status: 'not-tested' } }))
    passedRef.current = false
  }, [change])

  const onFrame = useCallback((frame: WorkshopFrame) => {
    const pending = captureRef.current
    if (pending) {
      pending.session ??= new PoseCaptureSession(PROFILE_BOUNDS[draftRef.current.recognition.profile], frame.aspect)
      const progress = pending.session.push(frame.raw?.landmarks ?? null, frame.timestamp)
      if (progress.status === 'captured' && progress.pose) {
        const pose = progress.pose
        const target = pending.target
        captureRef.current = null
        setCapture(null)
        setDraft((previous) => ({
          ...previous,
          ...(target === 'start' ? { startPose: { ...previous.startPose, capture: pose } } : { finishPose: { ...previous.finishPose, capture: pose } }),
          test: { status: 'not-tested' },
        }))
        setDirty(true)
        passedRef.current = false
        setAnnouncement(target === 'start' ? '已记录开始姿势' : '已记录完成姿势')
      } else if (frame.timestamp - lastUiRef.current >= 100) {
        lastUiRef.current = frame.timestamp
        setCapture({ target: pending.target, progress })
      }
      return
    }
    const recognizer = recognizerRef.current
    if (!testingRef.current || !recognizer) return
    const next = recognizer.process(frame.pose, frame.timestamp, frame.aspect)
    if (next.repEvent || frame.timestamp - lastUiRef.current >= 100) {
      lastUiRef.current = frame.timestamp
      setSnapshot(next)
    }
    if (!passedRef.current && testPasses(next, draftRef.current)) {
      passedRef.current = true
      setDraft((previous) => ({ ...previous, test: { status: 'passed', testedAt: new Date().toISOString(), repsDetected: next.reps, repsPassed: next.passedReps } }))
      setDirty(true)
      setAnnouncement('测试通过')
    }
  }, [])

  const camera = useWorkshopCamera({
    synthetic,
    onFrame,
    fixture: () => ({
      mode: captureRef.current ? captureRef.current.target : testingRef.current ? 'cycle' : 'start',
      poses: { start: draftRef.current.startPose.capture, finish: draftRef.current.finishPose.capture },
    }),
  })
  const { capturing: cameraOn, start: startCamera, stop: stopCamera } = camera

  const cancelCapture = useCallback(() => {
    captureRef.current = null
    setCapture(null)
  }, [])

  const stopTest = useCallback(() => {
    testingRef.current = false
    setTesting(false)
  }, [])

  const record = (target: CaptureTarget) => {
    stopTest()
    captureRef.current = { target }
    setCapture({ target, progress: null })
    if (!cameraOn) void startCamera()
  }

  const startTest = () => {
    if (!setup.ready) return
    cancelCapture()
    recognizerRef.current = new CustomActionRecognizer(draftRef.current)
    passedRef.current = false
    setSnapshot(null)
    testingRef.current = true
    setTesting(true)
    if (!cameraOn) void startCamera()
  }

  const cameraStep = step === 'requirements' || step === 'test'

  // The camera runs only on the steps that need it; the synthetic fixture starts by itself there (DEV).
  useEffect(() => {
    if (!cameraStep) {
      cancelCapture()
      stopTest()
      stopCamera()
    } else if (synthetic && !cameraOn) {
      void startCamera()
    }
  }, [cameraOn, cameraStep, cancelCapture, startCamera, stopCamera, stopTest, synthetic])

  useEffect(() => {
    if (step !== 'test') stopTest()
  }, [step, stopTest])

  const goTo = (next: EditorStep) => {
    setStepNotice(undefined)
    if (stepIndex(next) > stepIndex('basics') && !draft.name.trim()) {
      setErrors({ name: '请填写动作名称' })
      setStep('basics')
      window.requestAnimationFrame(() => document.getElementById('action-name')?.focus())
      return
    }
    setErrors({})
    if (stepIndex(next) > stepIndex('requirements') && !setup.ready) {
      setStep('requirements')
      setStepNotice(setup.issue)
      return
    }
    setStep(next)
    window.requestAnimationFrame(() => headingRef.current?.focus())
  }

  const save = () => {
    const problems = validateForSave(draft)
    if (readOnly) problems.push('本地的动作数据来自更新版本或无法读取，暂时不能保存。')
    setSaveProblems(problems)
    if (problems.length) return
    const now = new Date().toISOString()
    const toSave: CustomActionDefinition = { ...draft, name: draft.name.trim(), description: draft.description.trim(), createdAt: existing?.createdAt ?? draft.createdAt, updatedAt: now }
    if (!repository.save(toSave)) {
      setSaveProblems(['保存失败：本地存储不可用，或已经有 50 个动作。'])
      return
    }
    setDirty(false)
    window.location.assign(`${WORKSHOP_PATH}?saved=${encodeURIComponent(toSave.id)}`)
  }

  if (actionId && !existing) {
    return (
      <div className="fp-page min-h-dvh text-slate-900">
        <AppHeader />
        <main className="mx-auto grid min-h-[60dvh] max-w-3xl place-items-center px-4 py-12">
          <section className="fp-card w-full p-8 text-center" data-testid="workshop-action-not-found">
            <AlertTriangle className="mx-auto text-amber-600" size={28} aria-hidden="true" />
            <h1 className="mt-3 text-balance text-2xl font-bold">没有找到这个动作</h1>
            <p className="mt-2 text-pretty text-sm text-slate-600">它可能已经被删除。可以回到动作工坊重新创建。</p>
            <a href={WORKSHOP_PATH} className="primary-button mt-6 inline-flex items-center gap-2"><ArrowLeft size={16} aria-hidden="true" />回到动作工坊</a>
          </section>
        </main>
      </div>
    )
  }

  const current = STEPS[stepIndex(step)]
  const framingHint = testing ? snapshot?.framingHint : undefined
  const saveProblemsNow = step === 'save' ? saveProblems : []
  return (
    <div className="fp-page min-h-dvh min-w-0 overflow-x-clip text-slate-900">
      <AppHeader />
      <main className="mx-auto min-w-0 max-w-[1280px] px-4 pb-14 pt-5 sm:px-6 lg:px-8">
        <a href={WORKSHOP_PATH} className="mb-3 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ArrowLeft size={17} aria-hidden="true" />动作工坊</a>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-balance text-3xl font-bold tracking-tight text-slate-950">{existing ? '编辑动作' : '创建动作'}</h1>
            <p className="mt-1 text-sm text-slate-600">{existing ? `正在编辑「${existing.name}」` : '教 FormPilot 学会你的动作，只需要四步。'}</p>
          </div>
          {dirty ? <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900" data-testid="editor-dirty">有未保存的修改</span> : null}
        </header>
        {readOnly ? <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="status">本地的动作数据来自更新版本或无法读取，暂时不能保存修改。</p> : null}

        <nav className="mt-5" aria-label="创建步骤">
          <ol className="grid grid-cols-4 gap-1.5 sm:gap-2">
            {STEPS.map((item, index) => {
              const state = index < stepIndex(step) ? 'done' : item.id === step ? 'current' : 'upcoming'
              return (
                <li key={item.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => goTo(item.id)}
                    aria-current={state === 'current' ? 'step' : undefined}
                    className={cn(
                      'flex w-full min-w-0 flex-col items-start gap-1 rounded-xl border px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:px-3',
                      state === 'current' ? 'border-blue-500 bg-blue-50' : state === 'done' ? 'border-emerald-200 bg-white' : 'border-slate-200 bg-white/70',
                    )}
                    data-testid={`editor-step-${item.id}`}
                  >
                    <span className={cn('grid size-6 place-items-center rounded-full text-xs font-bold tabular-nums', state === 'current' ? 'bg-blue-600 text-white' : state === 'done' ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600')}>
                      {state === 'done' ? <Check size={13} aria-hidden="true" /> : index + 1}
                    </span>
                    <span className={cn('w-full truncate text-xs font-semibold sm:text-sm', state === 'current' ? 'text-blue-800' : 'text-slate-700')}>{item.label}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>

        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

        <div className={cn('mt-5 grid min-w-0 items-start gap-5', cameraStep ? 'lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]' : 'max-w-4xl')}>
          <section className="fp-card min-w-0 p-5 sm:p-6" aria-labelledby="editor-step-title" data-testid="editor-step" data-step={step}>
            <StepHeading id="editor-step-title" title={current.title} description={current.description} headingRef={headingRef} />
            {stepNotice ? <p className="mt-4 flex items-start gap-2 rounded-xl bg-coral-50 px-4 py-3 text-sm font-semibold text-coral-600" role="alert"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{stepNotice}</p> : null}
            <div className="mt-5">
              {step === 'basics' ? (
                <BasicsStep
                  draft={draft}
                  errors={errors}
                  onChange={(patch) => {
                    if (patch.name !== undefined && errors.name) setErrors({})
                    if (patch.bodyArea) changeRecognition((previous) => withBodyArea(previous, patch.bodyArea!))
                    else if (patch.goal) changeRecognition((previous) => ({ ...previous, goal: patch.goal! }))
                    else change((previous) => ({ ...previous, ...patch }))
                  }}
                />
              ) : null}
              {step === 'requirements' ? (
                <RequirementsStep
                  draft={draft}
                  setup={setup}
                  capture={capture}
                  onPoseDescription={(target, value) => change((previous) => target === 'start' ? { ...previous, startPose: { ...previous.startPose, description: value } } : { ...previous, finishPose: { ...previous.finishPose, description: value } })}
                  onRecord={record}
                  onCancelCapture={cancelCapture}
                  onToggleRequirement={(id: RequirementId, enabled) => changeRecognition((previous) => ({ ...previous, requirements: previous.requirements.map((item) => item.id === id ? { ...item, enabled } : item) }))}
                  onRequirementThreshold={(id, value) => changeRecognition((previous) => ({ ...previous, requirements: previous.requirements.map((item) => item.id === id ? { id: item.id, enabled: item.enabled, ...(value === undefined ? {} : { threshold: value }) } : item) }))}
                  onSource={(source) => changeRecognition((previous) => withSignalSource(previous, source))}
                  onProfile={(profile) => changeRecognition((previous) => ({ ...previous, recognition: { ...previous.recognition, profile } }))}
                  onThresholds={(thresholds) => changeRecognition((previous) => ({ ...previous, recognition: { ...previous.recognition, thresholds } }))}
                  onTiming={(patch) => changeRecognition((previous) => ({ ...previous, recognition: { ...previous.recognition, ...patch } }))}
                  onExport={() => downloadJson(exportFileName(draft), buildExport([draft]))}
                />
              ) : null}
              {step === 'test' ? (
                <TestStep draft={draft} setup={setup} snapshot={snapshot} testing={testing} passed={draft.test.status === 'passed'} cameraReady={cameraOn} onStart={startTest} />
              ) : null}
              {step === 'save' ? <SaveStep draft={draft} problems={saveProblemsNow} /> : null}
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
              {stepIndex(step) > 0 ? (
                <button type="button" onClick={() => goTo(STEPS[stepIndex(step) - 1].id)} className="secondary-button inline-flex items-center gap-2"><ArrowLeft size={16} aria-hidden="true" />上一步</button>
              ) : <span />}
              {step === 'save' ? (
                <button type="button" onClick={save} disabled={readOnly} className="primary-button inline-flex items-center gap-2 px-6 disabled:cursor-not-allowed disabled:opacity-50" data-testid="editor-save"><Save size={17} aria-hidden="true" />保存动作</button>
              ) : (
                <button type="button" onClick={() => goTo(STEPS[stepIndex(step) + 1].id)} className="primary-button inline-flex items-center gap-2" data-testid="editor-next">下一步：{STEPS[stepIndex(step) + 1].label}<ArrowRight size={16} aria-hidden="true" /></button>
              )}
            </div>
          </section>
          {cameraStep ? (
            <aside className="order-first min-w-0 lg:sticky lg:top-4 lg:order-none" aria-label="摄像头">
              <CameraPanel
                variant="compact"
                videoRef={camera.videoRef}
                demoImageRef={camera.demoImageRef}
                overlayRef={camera.overlayRef}
                mode={camera.mode}
                errorMessage={camera.error}
                errorKind={camera.errorKind}
                errors={framingHint ? [{ code: 'BODY_OUT_OF_FRAME', severity: 1, message: framingHint }] : []}
                demoAsset={SYNTHETIC_BACKDROP}
                preparationMessage={captureMessage(capture)}
                outOfFrameMessage={framingHint ?? ''}
                showPoseOverlay
                onStart={() => void startCamera()}
              />
              <p className="mt-2 px-1 text-pretty text-xs leading-5 text-slate-500">摄像头画面只用于实时识别，动作工坊只保存身体关键点位置。{camera.modelVariant === 'full' ? '当前使用完整版姿态模型。' : camera.modelVariant === 'lite' ? '完整版姿态模型不可用，已改用轻量版。' : ''}</p>
            </aside>
          ) : null}
        </div>
      </main>
    </div>
  )
}
