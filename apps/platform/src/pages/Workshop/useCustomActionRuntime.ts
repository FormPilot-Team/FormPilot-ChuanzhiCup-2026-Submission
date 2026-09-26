import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserSpeechAdapter, type VoicePlaybackState } from '../../adapters/speech/BrowserSpeechAdapter'
import { CourseController, type CourseSnapshot } from '../../features/course/CourseController'
import { GestureRuntimeController, type GestureAction } from '../../features/gesture/GestureRuntimeController'
import { PoseFilter } from '../../features/pose/PoseFilter'
import { normalizePoseFrame } from '../../features/pose/PoseNormalizer'
import { shouldShowPoseOverlay } from '../../features/pose/poseOverlayVisibility'
import { resolveTrainingMode } from '../../features/training/trainingMode'
import { VoiceGuidePolicy, type VoiceGuideCommand, type VoiceGuideEvent } from '../../features/voice/VoiceGuidePolicy'
import { REQUIREMENTS } from '../../features/workshop/catalog'
import { createCustomCourse, deriveCustomVoiceEvents, milestoneText, type CustomCourseStep } from '../../features/workshop/customCourse'
import type { FixtureMode } from '../../features/workshop/fixture'
import { CustomActionRecognizer, framingHintFor, type RecognizerSnapshot } from '../../features/workshop/recognition/recognizer'
import {
  LocalStorageCustomSessionRepository, createCustomSessionId, recordFeedback, recordRep, startCustomSession, type CustomActionSessionRecord,
} from '../../features/workshop/session'
import type { CustomActionDefinition } from '../../features/workshop/types'
import { useWorkshopCamera, type WorkshopFrame } from './useWorkshopCamera'

export type CustomSessionStatus = 'ready' | 'active' | 'paused' | 'completed'

export interface CustomCompletion {
  outcome: 'completed' | 'incomplete'
  recordId: string | null
  saved: boolean
}

/** Losing the pose for this long pauses the training; shorter losses (deep bends, floor moves) are tolerated. */
const POSE_LOSS_PAUSE_MS = 2000
const PERSIST_INTERVAL_MS = 10_000
const UI_INTERVAL_MS = 100
/** At most one spoken correction in this window: the display carries the rest. */
const CORRECTION_COOLDOWN_MS = 6000
const FRAMING_CONFIDENCE = 0.5

type TestWindow = typeof window & { __gestureTestPose?: 'start' | 'none'; __forceNoPose?: boolean }

/**
 * Runtime of a saved custom action: the workshop's camera pipeline and recognizer inside the shared course,
 * gesture, voice and pause behaviour. Gestures act only outside active training (user-defined moves may look like
 * them); pause is the button or Space.
 */
export function useCustomActionRuntime(action: CustomActionDefinition) {
  const paramsRef = useRef(new URLSearchParams(window.location.search))
  const params = paramsRef.current
  const debug = params.get('debug') === '1'
  const trainingMode = resolveTrainingMode(params.get('fast') === '1')
  const fast = trainingMode === 'fast'
  // DEV-only test path: the "user" moves between the action's own recorded poses, no camera.
  const synthetic = import.meta.env.DEV && params.get('fixture') === 'synthetic'
  const manualGesture = synthetic && params.get('gesture') === 'manual'
  const voiceFlowEnabled = !synthetic || (import.meta.env.DEV && params.get('voice') === '1')

  const courseRef = useRef(null as unknown as CourseController<CustomCourseStep>)
  courseRef.current ??= new CourseController(createCustomCourse(action, fast))
  const step = courseRef.current.getStep()
  const recognizerRef = useRef(null as unknown as CustomActionRecognizer)
  recognizerRef.current ??= new CustomActionRecognizer(action)
  const setup = recognizerRef.current.setup
  const gestureFilterRef = useRef(null as unknown as PoseFilter)
  gestureFilterRef.current ??= new PoseFilter({ medianWindow: 3, emaAlpha: 0.5 })
  const gestureControllerRef = useRef(null as unknown as GestureRuntimeController)
  gestureControllerRef.current ??= new GestureRuntimeController()
  const speechRef = useRef(null as unknown as BrowserSpeechAdapter)
  speechRef.current ??= new BrowserSpeechAdapter()
  const voicePolicyRef = useRef(null as unknown as VoiceGuidePolicy)
  voicePolicyRef.current ??= new VoiceGuidePolicy()
  const repositoryRef = useRef(null as unknown as LocalStorageCustomSessionRepository)
  repositoryRef.current ??= new LocalStorageCustomSessionRepository()
  const recordRef = useRef<CustomActionSessionRecord | undefined>(undefined)
  const voiceEnabledRef = useRef(true)
  const completedRef = useRef(false)
  const sessionStatusRef = useRef<CustomSessionStatus>('ready')
  const noPoseStartedAtRef = useRef<number | undefined>(undefined)
  const poseUnavailableRef = useRef(false)
  const autoPausedRef = useRef(false)
  const startGestureConfirmedRef = useRef(false)
  const lastUiAtRef = useRef(0)
  const lastPersistAtRef = useRef(0)
  const lastFrameAtRef = useRef<number | undefined>(undefined)
  const lastCorrectionAtRef = useRef(Number.NEGATIVE_INFINITY)
  const lastQualityRef = useRef<RecognizerSnapshot['quality']>('good')
  const lastFeedbackCodeRef = useRef<string | undefined>(undefined)
  const framingRef = useRef<{ valid: boolean; hint?: string }>({ valid: false })
  const gestureViewRef = useRef<{ action?: GestureAction; progress: number }>({ progress: 0 })

  const [courseSnapshot, setCourseSnapshot] = useState<CourseSnapshot>(() => courseRef.current.getSnapshot())
  const [sessionStatus, setSessionStatusState] = useState<CustomSessionStatus>('ready')
  const [snapshot, setSnapshot] = useState<RecognizerSnapshot | null>(null)
  const [count, setCount] = useState(0)
  const [framing, setFraming] = useState<{ valid: boolean; hint?: string }>({ valid: false })
  const [poseUnavailable, setPoseUnavailable] = useState(false)
  const [gestureStatus, setGestureStatus] = useState<{ action?: GestureAction; progress: number }>({ progress: 0 })
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [voiceAvailable, setVoiceAvailable] = useState(() => speechRef.current.isAvailable())
  const [voicePlayback, setVoicePlayback] = useState<VoicePlaybackState>({ isSpeaking: false })
  const [completion, setCompletion] = useState<CustomCompletion>()

  const setStatus = useCallback((status: CustomSessionStatus) => {
    sessionStatusRef.current = status
    setSessionStatusState(status)
  }, [])

  const showFraming = useCallback((next: { valid: boolean; hint?: string }) => {
    if (framingRef.current.valid === next.valid && framingRef.current.hint === next.hint) return
    framingRef.current = next
    setFraming(next)
  }, [])

  const showGesture = useCallback((next: { action?: GestureAction; progress: number }) => {
    const rounded = { action: next.action, progress: Math.round(next.progress * 20) / 20 }
    if (gestureViewRef.current.action === rounded.action && gestureViewRef.current.progress === rounded.progress) return
    gestureViewRef.current = rounded
    setGestureStatus(rounded)
  }, [])

  // ---- voice ---------------------------------------------------------------------------------------------------
  const applyVoiceCommand = useCallback((command: VoiceGuideCommand) => {
    if (command.kind === 'cancel') speechRef.current.cancel()
    if (command.kind === 'speak') speechRef.current.speak(command.text, command.priority, command.interrupt, command.event)
  }, [])

  const voiceContext = useCallback(() => ({
    muted: !voiceEnabledRef.current,
    available: speechRef.current.isAvailable(),
    paused: sessionStatusRef.current === 'paused',
    currentPriority: speechRef.current.currentPriority(),
  }), [])

  const dispatchVoiceEvent = useCallback((event: VoiceGuideEvent) => {
    if (!voiceFlowEnabled) return
    applyVoiceCommand(voicePolicyRef.current.handle(event, voiceContext()))
  }, [applyVoiceCommand, voiceContext, voiceFlowEnabled])

  const dispatchPoseAvailability = useCallback((available: boolean, at: number) => {
    if (!voiceFlowEnabled) return
    applyVoiceCommand(voicePolicyRef.current.onPoseAvailability(available, at, voiceContext()))
  }, [applyVoiceCommand, voiceContext, voiceFlowEnabled])

  // ---- session record ------------------------------------------------------------------------------------------
  const persist = useCallback((outcome?: CustomActionSessionRecord['outcome'], endedAt?: number): boolean => {
    const record = recordRef.current
    if (!record) return false
    if (outcome) record.outcome = outcome
    if (endedAt !== undefined) record.endedAt = endedAt
    lastPersistAtRef.current = performance.now()
    return repositoryRef.current.save(record)
  }, [])

  const beginRecord = useCallback(() => {
    if (recordRef.current) return
    const now = Date.now()
    recordRef.current = startCustomSession(action, {
      id: createCustomSessionId(now),
      startedAt: now,
      recognitionMode: setup.mode,
      source: synthetic ? 'synthetic' : 'live',
      mode: trainingMode,
      requirements: setup.requirements.map((item) => item.id),
    })
    persist()
  }, [action, persist, setup.mode, setup.requirements, synthetic, trainingMode])

  const stopCapture = useRef<() => void>(() => undefined)

  const finishCompleted = useCallback(() => {
    if (completedRef.current) return
    completedRef.current = true
    stopCapture.current()
    const saved = persist('completed', Date.now())
    setStatus('completed')
    setCompletion({ outcome: 'completed', recordId: recordRef.current?.id ?? null, saved })
  }, [persist, setStatus])

  const finish = useCallback(() => {
    if (completedRef.current) return
    completedRef.current = true
    stopCapture.current()
    dispatchVoiceEvent({ kind: 'manual_end', at: performance.now() })
    setCourseSnapshot(courseRef.current.manualEnd())
    const saved = persist('incomplete', Date.now())
    setStatus('completed')
    setCompletion({ outcome: 'incomplete', recordId: recordRef.current?.id ?? null, saved })
  }, [dispatchVoiceEvent, persist, setStatus])

  // ---- course ----------------------------------------------------------------------------------------------------
  const applyCourse = useCallback((before: CourseSnapshot, after: CourseSnapshot, now: number) => {
    if (after.state !== before.state) {
      gestureControllerRef.current.reset()
      showGesture({ progress: 0 })
      if (after.state === 'ACTIVE' && before.state === 'COUNTDOWN') {
        recognizerRef.current.reset()
        beginRecord()
      }
    }
    for (const event of deriveCustomVoiceEvents(before, after, action, now)) dispatchVoiceEvent(event)
    if (after.state !== before.state || after.countdown !== before.countdown) setCourseSnapshot(after)
    if (after.state === 'COURSE_COMPLETE') finishCompleted()
  }, [action, beginRecord, dispatchVoiceEvent, finishCompleted, showGesture])

  const onRep = useCallback((event: NonNullable<RecognizerSnapshot['repEvent']>, done: number, now: number) => {
    const record = recordRef.current
    if (record) {
      recordRep(record, event)
      for (const failed of event.failed) recordFeedback(record, `REQUIREMENT_${failed.toUpperCase().replaceAll('-', '_')}`)
    }
    const failed = event.failed[0]
    if (failed && now - lastCorrectionAtRef.current >= CORRECTION_COOLDOWN_MS) {
      lastCorrectionAtRef.current = now
      dispatchVoiceEvent({ kind: 'confirmed_correction', text: `${REQUIREMENTS[failed].feedback}。`, id: `custom:req:${failed}:${event.index}`, at: now })
      return
    }
    const milestone = milestoneText(done, step.target, step.unit)
    if (milestone) dispatchVoiceEvent({ kind: 'encouragement', text: milestone, id: `custom:milestone:${done}`, at: now })
  }, [dispatchVoiceEvent, step.target, step.unit])

  // ---- frames -------------------------------------------------------------------------------------------------------
  const processNoPose = useCallback((now: number) => {
    if (completedRef.current) return
    noPoseStartedAtRef.current ??= now
    const lostFor = now - noPoseStartedAtRef.current
    const before = courseRef.current.getSnapshot()
    if (before.state === 'TRANSITION') applyCourse(before, courseRef.current.update(now, { ready: true, progress: step.target, target: step.target }), now)
    if (lostFor < 500) return
    if (!poseUnavailableRef.current) {
      poseUnavailableRef.current = true
      setPoseUnavailable(true)
      showFraming({ valid: false })
      if (before.state === 'ACTIVE' && recordRef.current) recordFeedback(recordRef.current, 'POSE_LOST')
    }
    dispatchPoseAvailability(false, now)
    if (sessionStatusRef.current === 'paused') return
    if (before.state === 'PREPARING' || before.state === 'COUNTDOWN') {
      startGestureConfirmedRef.current = false
      gestureControllerRef.current.reset()
      showGesture({ progress: 0 })
      applyCourse(before, courseRef.current.update(now, { ready: false, progress: 0, target: step.target }), now)
    } else if (before.state === 'ACTIVE' && lostFor >= POSE_LOSS_PAUSE_MS && !autoPausedRef.current) {
      autoPausedRef.current = true
      setCourseSnapshot(courseRef.current.pause(now))
      if (recordRef.current) persist()
    }
  }, [applyCourse, dispatchPoseAvailability, persist, showFraming, showGesture, step.target])

  const onFrame = useCallback((frame: WorkshopFrame) => {
    const now = frame.timestamp
    const previousFrameAt = lastFrameAtRef.current
    lastFrameAtRef.current = now
    const forceNoPose = import.meta.env.DEV && Boolean((window as TestWindow).__forceNoPose)
    const pose = forceNoPose ? null : frame.pose
    if (!pose) return processNoPose(now)
    noPoseStartedAtRef.current = undefined
    dispatchPoseAvailability(true, now)
    if (poseUnavailableRef.current) {
      poseUnavailableRef.current = false
      setPoseUnavailable(false)
    }
    if (autoPausedRef.current && sessionStatusRef.current === 'active') {
      autoPausedRef.current = false
      setCourseSnapshot(courseRef.current.resume(now))
    }
    if (completedRef.current) return

    const gesturePose = frame.detected ? normalizePoseFrame(gestureFilterRef.current.push(frame.detected)) : null
    const hint = framingHintFor(pose.landmarks, setup)
    const framingValid = !hint && pose.confidence >= FRAMING_CONFIDENCE
    const before = courseRef.current.getSnapshot()

    if (sessionStatusRef.current === 'paused') {
      if (gesturePose) {
        const gesture = gestureControllerRef.current.update({ courseState: 'PAUSED', framingValid: true, pose: gesturePose })
        showGesture({ action: gesture.action, progress: gesture.progress })
        if (gesture.triggered === 'resume') togglePauseRef.current()
      }
    } else if (before.state === 'PREPARING' || before.state === 'COUNTDOWN') {
      if (!framingValid) startGestureConfirmedRef.current = false
      if (gesturePose) {
        const gesture = gestureControllerRef.current.update({ courseState: before.state, framingValid, pose: gesturePose })
        showGesture({ action: gesture.action, progress: gesture.progress })
        if (gesture.triggered === 'start') startGestureConfirmedRef.current = true
      }
      applyCourse(before, courseRef.current.update(now, { ready: framingValid && startGestureConfirmedRef.current && setup.ready, progress: 0, target: step.target }), now)
    } else if (before.state === 'TRANSITION') {
      applyCourse(before, courseRef.current.update(now, { ready: true, progress: step.target, target: step.target }), now)
    }

    const state = courseRef.current.getSnapshot().state
    if (state === 'ACTIVE' && sessionStatusRef.current === 'active') {
      const record = recordRef.current
      if (record && previousFrameAt !== undefined) record.activeMs += Math.min(250, Math.max(0, now - previousFrameAt))
      const next = recognizerRef.current.process(pose, now, frame.aspect)
      const done = setup.counting === 'hold' ? Math.floor(next.holdMs / 1000) : next.reps
      if (record) {
        record.holdMs = next.holdMs
        if (next.feedback?.code === 'MOTION_TOO_SMALL' && lastFeedbackCodeRef.current !== 'MOTION_TOO_SMALL') recordFeedback(record, 'MOTION_TOO_SMALL')
        if (next.quality === 'degraded' && lastQualityRef.current === 'good') recordFeedback(record, 'FRAMING')
      }
      lastFeedbackCodeRef.current = next.feedback?.code
      lastQualityRef.current = next.quality
      if (next.repEvent) onRep(next.repEvent, done, now)
      if (next.repEvent || now - lastUiAtRef.current >= UI_INTERVAL_MS) {
        lastUiAtRef.current = now
        setSnapshot(next)
        setCount(done)
      }
      if (record && (next.repEvent || now - lastPersistAtRef.current >= PERSIST_INTERVAL_MS)) persist()
      applyCourse(courseRef.current.getSnapshot(), courseRef.current.update(now, { ready: true, progress: done, target: step.target }), now)
      showFraming({ valid: next.quality === 'good', hint: next.framingHint })
      return
    }
    showFraming({ valid: framingValid, hint })
  }, [applyCourse, dispatchPoseAvailability, onRep, persist, processNoPose, setup, showFraming, showGesture, step.target])

  const fixtureMode = useCallback((): FixtureMode => {
    const test = window as TestWindow
    if (test.__forceNoPose) return 'none'
    const requested = test.__gestureTestPose
    if (requested === 'start') return 'gesture'
    const state = courseRef.current.getSnapshot().state
    if (!manualGesture && (state === 'PREPARING' || state === 'COUNTDOWN')) return 'gesture'
    if (state === 'ACTIVE' && sessionStatusRef.current === 'active') return 'cycle'
    return 'start'
  }, [manualGesture])

  const camera = useWorkshopCamera({
    synthetic,
    onFrame,
    fixture: () => ({ mode: fixtureMode(), poses: { start: action.startPose.capture, finish: action.finishPose.capture } }),
    showOverlay: () => shouldShowPoseOverlay(courseRef.current.getSnapshot().state),
  })
  const { start: startCamera, stop: stopCameraNow, capturing } = camera
  stopCapture.current = stopCameraNow

  // ---- pause / voice -------------------------------------------------------------------------------------------
  const togglePause = useCallback(() => {
    if (sessionStatusRef.current === 'completed' || sessionStatusRef.current === 'ready') return
    gestureControllerRef.current.reset()
    showGesture({ progress: 0 })
    const now = performance.now()
    if (sessionStatusRef.current !== 'paused') {
      setStatus('paused')
      setCourseSnapshot(courseRef.current.pause(now))
      dispatchVoiceEvent({ kind: 'pause', text: '已暂停。', at: now })
      if (recordRef.current) persist()
      return
    }
    setStatus('active')
    if (poseUnavailableRef.current) autoPausedRef.current = true
    else setCourseSnapshot(courseRef.current.resume(now))
    dispatchVoiceEvent({ kind: 'resume', text: '继续训练。', at: now })
  }, [dispatchVoiceEvent, persist, setStatus, showGesture])
  const togglePauseRef = useRef(togglePause)
  togglePauseRef.current = togglePause

  const toggleVoice = useCallback(() => {
    const next = !voiceEnabledRef.current
    if (!next) dispatchVoiceEvent({ kind: 'mute', at: performance.now() })
    voiceEnabledRef.current = next
    speechRef.current.setMuted(!next)
    setVoiceEnabled(next)
  }, [dispatchVoiceEvent])

  const start = useCallback(async () => {
    if (completedRef.current) return
    await startCamera()
  }, [startCamera])

  // Camera running → the session is live (the course waits in PREPARING for the start gesture).
  useEffect(() => {
    if (!capturing || completedRef.current || sessionStatusRef.current !== 'ready') return
    setStatus('active')
    for (const event of deriveCustomVoiceEvents(undefined, courseRef.current.getSnapshot(), action, performance.now())) dispatchVoiceEvent(event)
  }, [action, capturing, dispatchVoiceEvent, setStatus])

  // The synthetic fixture starts by itself (DEV only).
  useEffect(() => {
    if (synthetic) void startCamera()
  }, [startCamera, synthetic])

  useEffect(() => speechRef.current.onAvailabilityChange(setVoiceAvailable), [])
  useEffect(() => speechRef.current.onPlaybackStateChange(setVoicePlayback), [])

  useEffect(() => {
    const speech = speechRef.current
    const flush = () => { if (recordRef.current && !completedRef.current) persist() }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && sessionStatusRef.current === 'active' && courseRef.current.getSnapshot().state === 'ACTIVE') togglePauseRef.current()
      flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      flush()
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      speech.cancel()
    }
  }, [persist])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      const target = event.target
      if (target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A'].includes(target.tagName) || target.isContentEditable)) return
      if (sessionStatusRef.current === 'completed' || sessionStatusRef.current === 'ready') return
      event.preventDefault()
      togglePauseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const gesturePrompt = sessionStatus === 'paused'
    ? '双手在胸前合拢并保持，继续训练'
    : courseSnapshot.state === 'PREPARING' && framing.valid && setup.ready
      ? '双手在胸前合拢并保持，开始训练'
      : undefined
  const preparationMessage = courseSnapshot.state === 'PAUSED' && sessionStatus !== 'paused'
    ? '已自动暂停：请回到画面中，识别到后自动继续'
    : poseUnavailable && courseSnapshot.state !== 'ACTIVE' ? `请回到画面中，让${setup.framingLabel}完整入镜`
      : !framing.valid && (courseSnapshot.state === 'PREPARING' || courseSnapshot.state === 'COUNTDOWN') && camera.capturing ? framing.hint ?? `请让${setup.framingLabel}完整入镜`
        : undefined

  const debugData = useMemo(() => [
    { label: 'Course state', value: courseSnapshot.state },
    { label: 'Session', value: sessionStatus },
    { label: 'Recognition', value: `${setup.mode} · ${setup.counting}` },
    { label: 'Phase', value: snapshot ? `${snapshot.phase} · ${snapshot.progress ?? '—'}` : 'n/a' },
    { label: 'Count', value: `${count} / ${step.target} ${step.unit}` },
    { label: 'Model', value: camera.modelVariant ?? (synthetic ? 'synthetic' : 'n/a') },
    { label: 'Record', value: recordRef.current?.id ?? 'none' },
    { label: 'Mode', value: `${trainingMode}${synthetic ? ' · synthetic' : ''}` },
  ], [camera.modelVariant, count, courseSnapshot.state, sessionStatus, setup.counting, setup.mode, snapshot, step.target, step.unit, synthetic, trainingMode])

  return {
    debug,
    fast,
    synthetic,
    action,
    setup,
    step,
    camera,
    courseSnapshot,
    sessionStatus,
    snapshot,
    count,
    framing,
    poseUnavailable,
    gesturePrompt,
    gestureProgress: gesturePrompt ? gestureStatus.progress : 0,
    gestureHolding: Boolean(gesturePrompt && gestureStatus.progress > 0),
    preparationMessage,
    voiceEnabled,
    voiceAvailable,
    voicePlayback,
    completion,
    start,
    togglePause,
    toggleVoice,
    finish,
    debugData,
  }
}

export type CustomActionRuntime = ReturnType<typeof useCustomActionRuntime>
