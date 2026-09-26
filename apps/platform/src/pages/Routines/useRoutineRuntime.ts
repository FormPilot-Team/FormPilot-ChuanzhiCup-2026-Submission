import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserCameraAdapter, cameraErrorPresentation, type CameraFailureKind } from '../../adapters/camera/BrowserCameraAdapter'
import { BrowserSpeechAdapter, type VoicePlaybackState } from '../../adapters/speech/BrowserSpeechAdapter'
import type { PoseOverlayDrawOptions, PoseOverlayHandle } from '../../components/pose/PoseOverlay'
import { createGestureDemoPoseFrame } from '../../data/demoPose'
import { buildRecentReports } from '../../features/coachContext/recentReports'
import { buildRoutineCoachContext } from '../../features/coachContext/routineCoachContext'
import type { RecentReportSummary } from '../../features/coachContext/types'
import { CourseController, type CourseSnapshot } from '../../features/course/CourseController'
import { PerformanceTracker } from '../../features/diagnostics/PerformanceTracker'
import { GestureRuntimeController, type GestureAction } from '../../features/gesture/GestureRuntimeController'
import { buildTrainingHistoryItems } from '../../features/history/TrainingHistory'
import { buildRoutineHistoryItems } from '../../features/history/routineHistory'
import { extractPoseQuality } from '../../features/motion/sharedFeatures'
import { PoseDetector } from '../../features/pose/PoseDetector'
import { PoseFilter } from '../../features/pose/PoseFilter'
import { normalizePoseFrame, type NormalizedPoseFrame } from '../../features/pose/PoseNormalizer'
import { shouldShowPoseOverlay } from '../../features/pose/poseOverlayVisibility'
import { FULL_BODY_BOUNDS, LANDMARK_INDEX, SQUAT_REQUIRED, type PoseFrame } from '../../features/pose/types'
import { RoutineFeedbackPolicy, type RoutineFeedback } from '../../features/routines/followAlong/feedbackPolicy'
import { FOLLOW_ALONG_CONFIG, FollowAlongMatcher, type FollowAlongMatch } from '../../features/routines/followAlong/matcher'
import { loadReferenceTrack, type ReferenceTrack } from '../../features/routines/followAlong/referenceTrack'
import { mirrorPoseFrame, referencePoseFrame } from '../../features/routines/followAlong/referencePoseFrame'
import { createRoutineCourse, deriveRoutineVoiceEvents, routineCourseProgress, type RoutineCourseStep } from '../../features/routines/routineCourse'
import { chapterAt, scopeChapters } from '../../features/routines/scope'
import { RoutineProgressRecorder } from '../../features/routines/session/RoutineProgressRecorder'
import { LocalStorageRoutineSessionRepository } from '../../features/routines/session/RoutineSessionRepository'
import { createRoutineSessionId, type RoutineSessionRecord } from '../../features/routines/session/types'
import type { RoutineProgram, RoutineScope } from '../../features/routines/types'
import { LocalStorageTrainingSessionRepository } from '../../features/training/LocalStorageTrainingSessionRepository'
import { resolveTrainingMode } from '../../features/training/trainingMode'
import { VoiceGuidePolicy, type VoiceGuideCommand, type VoiceGuideEvent } from '../../features/voice/VoiceGuidePolicy'

export type RoutineCameraMode = 'idle' | 'requesting_permission' | 'model_loading' | 'live' | 'demo' | 'error'
export type RoutineSessionStatus = 'ready' | 'active' | 'paused' | 'completed'
export type ReferenceTrackStatus = 'loading' | 'ready' | 'unavailable'
export type StageStatus = 'loading' | 'ready' | 'error'

export interface RoutineCompletion {
  outcome: 'completed' | 'incomplete'
  recordId: string | null
  saved: boolean
}

/** Full body in view: the routines use the whole body, feet included. */
const REQUIRED_LANDMARKS = [...SQUAT_REQUIRED, 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist'] as const
const FRAME_MARGIN = 0.02
const FRAMING_CONFIDENCE = 0.65
/** Losing the pose for this long pauses the video; shorter losses (deep bends, low stances) are tolerated. */
const POSE_LOSS_PAUSE_MS = 2000
const EVALUATION_INTERVAL_MS = 100
const UI_INTERVAL_MS = 100
const PERSIST_INTERVAL_MS = 10_000

function framingHint(frame: NormalizedPoseFrame): string {
  const at = (index: number) => frame.landmarks[index]
  const head = at(LANDMARK_INDEX.nose)
  const feet = [at(LANDMARK_INDEX.leftAnkle), at(LANDMARK_INDEX.rightAnkle)]
  const outVertically = !head || head.y < FRAME_MARGIN
    || feet.some((point) => !point || point.visibility < FRAMING_CONFIDENCE || point.y > 1 - FRAME_MARGIN)
  if (outVertically) return '请后退一些，确保头部和双脚都在画面内'
  const outSideways = FULL_BODY_BOUNDS.some((name) => {
    const point = at(LANDMARK_INDEX[name])
    return point && (point.x < FRAME_MARGIN || point.x > 1 - FRAME_MARGIN)
  })
  return outSideways ? '请向画面中间移动一些，保持全身在画面内' : '请后退一些，确保全身完整入镜'
}

type GestureTestWindow = typeof window & { __gestureTestPose?: 'start' | 'pause' | 'none'; __forceNoPose?: boolean }

export function useRoutineRuntime(program: RoutineProgram, scope: RoutineScope) {
  const paramsRef = useRef(new URLSearchParams(window.location.search))
  const params = paramsRef.current
  const debug = params.get('debug') === '1'
  const trainingMode = resolveTrainingMode(params.get('fast') === '1')
  const fast = trainingMode === 'fast'
  // DEV-only test path: the "user" is the standard video's own pose (optionally late or mirrored), no camera.
  const synthetic = import.meta.env.DEV && params.get('fixture') === 'synthetic'
  const manualGesture = synthetic && params.get('gesture') === 'manual'
  const fixtureLagSeconds = synthetic ? Number(params.get('lag') ?? 0) || 0 : 0
  const fixtureMirror = synthetic && params.get('mirror') === '1'
  const voiceFlowEnabled = !synthetic || (import.meta.env.DEV && params.get('voice') === '1')
  const playbackRate = fast ? 8 : 1

  const chapters = useMemo(() => scopeChapters(program, scope), [program, scope])
  // Runtime objects are created once; several register listeners or allocate per-second buckets.
  const courseRef = useRef(null as unknown as CourseController<RoutineCourseStep>)
  courseRef.current ??= new CourseController(createRoutineCourse(program, scope, fast))
  const step = courseRef.current.getStep()

  const stageRef = useRef<HTMLVideoElement>(null)
  const cameraVideoRef = useRef<HTMLVideoElement>(null)
  const demoImageRef = useRef<HTMLImageElement>(null)
  const overlayRef = useRef<PoseOverlayHandle>(null)
  const cameraRef = useRef(null as unknown as BrowserCameraAdapter)
  cameraRef.current ??= new BrowserCameraAdapter()
  const detectorRef = useRef(null as unknown as PoseDetector)
  detectorRef.current ??= new PoseDetector()
  if (import.meta.env.DEV) Object.assign(window, { __poseDetector: detectorRef.current })
  const filterRef = useRef(null as unknown as PoseFilter)
  filterRef.current ??= new PoseFilter()
  const gestureFilterRef = useRef(null as unknown as PoseFilter)
  gestureFilterRef.current ??= new PoseFilter({ medianWindow: 3, emaAlpha: 0.5 })
  const gestureControllerRef = useRef(null as unknown as GestureRuntimeController)
  gestureControllerRef.current ??= new GestureRuntimeController()
  const matcherRef = useRef<FollowAlongMatcher | undefined>(undefined)
  const trackRef = useRef<ReferenceTrack | undefined>(undefined)
  const recorderRef = useRef(null as unknown as RoutineProgressRecorder)
  recorderRef.current ??= new RoutineProgressRecorder(program, scope)
  const feedbackPolicyRef = useRef(null as unknown as RoutineFeedbackPolicy)
  feedbackPolicyRef.current ??= new RoutineFeedbackPolicy()
  const repositoryRef = useRef(null as unknown as LocalStorageRoutineSessionRepository)
  repositoryRef.current ??= new LocalStorageRoutineSessionRepository()
  const recordRef = useRef<RoutineSessionRecord | undefined>(undefined)
  const speechRef = useRef(null as unknown as BrowserSpeechAdapter)
  speechRef.current ??= new BrowserSpeechAdapter()
  const voicePolicyRef = useRef(null as unknown as VoiceGuidePolicy)
  voicePolicyRef.current ??= new VoiceGuidePolicy()
  const voiceEnabledRef = useRef(true)
  const performanceRef = useRef(null as unknown as PerformanceTracker)
  performanceRef.current ??= new PerformanceTracker()
  const detectorCloseTimerRef = useRef<number | undefined>(undefined)
  const framingRef = useRef<{ valid: boolean; hint?: string }>({ valid: false })
  const gestureViewRef = useRef<{ action?: GestureAction; progress: number }>({ progress: 0 })
  const rafRef = useRef(0)
  const generationRef = useRef(0)
  const completedRef = useRef(false)
  const sessionStatusRef = useRef<RoutineSessionStatus>('ready')
  const stageStatusRef = useRef<StageStatus>('loading')
  const lastVideoTimeRef = useRef(-1)
  const lastStageTimeRef = useRef(step.startSeconds)
  const lastTickAtRef = useRef<number | undefined>(undefined)
  const lastEvaluationAtRef = useRef(0)
  const lastUiAtRef = useRef(0)
  const lastPersistAtRef = useRef(0)
  const noPoseStartedAtRef = useRef<number | undefined>(undefined)
  const poseUnavailableRef = useRef(false)
  const autoPausedRef = useRef(false)
  const startGestureConfirmedRef = useRef(false)
  const chapterIdRef = useRef(chapters[0].id)
  const matchRef = useRef<FollowAlongMatch | undefined>(undefined)
  const processFrameRef = useRef<(frame: PoseFrame, options: PoseOverlayDrawOptions & { aspect: number }) => void>(() => undefined)
  const processNoPoseRef = useRef<(now: number) => void>(() => undefined)
  const tickRef = useRef<(now: number) => void>(() => undefined)

  const [cameraMode, setCameraMode] = useState<RoutineCameraMode>(synthetic ? 'demo' : 'idle')
  const [cameraError, setCameraError] = useState<string>()
  const [cameraFailureKind, setCameraFailureKind] = useState<CameraFailureKind>()
  const [courseSnapshot, setCourseSnapshot] = useState<CourseSnapshot>(() => courseRef.current.getSnapshot())
  const [sessionStatus, setSessionStatus] = useState<RoutineSessionStatus>('ready')
  const [stageStatus, setStageStatus] = useState<StageStatus>('loading')
  const [stageTime, setStageTime] = useState(step.startSeconds)
  const [videoMuted, setVideoMuted] = useState(synthetic)
  const [trackStatus, setTrackStatus] = useState<ReferenceTrackStatus>('loading')
  const [chapterId, setChapterId] = useState(chapters[0].id)
  const [match, setMatch] = useState<FollowAlongMatch>()
  const [feedback, setFeedback] = useState<RoutineFeedback>()
  const [framing, setFraming] = useState<{ valid: boolean; hint?: string }>({ valid: false })
  const [poseUnavailable, setPoseUnavailable] = useState(false)
  const [gestureStatus, setGestureStatus] = useState<{ action?: GestureAction; progress: number }>({ progress: 0 })
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [voiceAvailable, setVoiceAvailable] = useState(() => speechRef.current.isAvailable())
  const [voicePlayback, setVoicePlayback] = useState<VoicePlaybackState>({ isSpeaking: false })
  const [coveredSeconds, setCoveredSeconds] = useState(0)
  const [completion, setCompletion] = useState<RoutineCompletion>()
  const [recentReports] = useState<RecentReportSummary[]>(() => {
    try {
      return buildRecentReports(
        buildTrainingHistoryItems(new LocalStorageTrainingSessionRepository().list()),
        buildRoutineHistoryItems(repositoryRef.current.list()),
      )
    } catch {
      return []
    }
  })

  const setStatus = useCallback((status: RoutineSessionStatus) => {
    sessionStatusRef.current = status
    setSessionStatus(status)
  }, [])

  // Pose frames arrive at camera rate; these only re-render when what is shown actually changes.
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

  const dispatchCourseVoice = useCallback((before: CourseSnapshot | undefined, after: CourseSnapshot, at: number) => {
    for (const event of deriveRoutineVoiceEvents(before, after, program, scope, at)) dispatchVoiceEvent(event)
  }, [dispatchVoiceEvent, program, scope])

  const dispatchPoseAvailability = useCallback((available: boolean, at: number) => {
    if (!voiceFlowEnabled) return
    applyVoiceCommand(voicePolicyRef.current.onPoseAvailability(available, at, voiceContext()))
  }, [applyVoiceCommand, voiceContext, voiceFlowEnabled])

  // ---- session record ------------------------------------------------------------------------------------------
  const persist = useCallback((outcome?: RoutineSessionRecord['outcome'], endedAt?: number): boolean => {
    const record = recordRef.current
    if (!record) return false
    record.chapters = recorderRef.current.snapshot()
    record.matcher = { version: FOLLOW_ALONG_CONFIG.version, available: record.matcher.available || Boolean(matcherRef.current) }
    if (outcome) record.outcome = outcome
    if (endedAt !== undefined) record.endedAt = endedAt
    lastPersistAtRef.current = performance.now()
    return repositoryRef.current.save(record)
  }, [])

  const beginRecord = useCallback(() => {
    if (recordRef.current) return
    const now = Date.now()
    recordRef.current = {
      schemaVersion: 1,
      kind: 'routine',
      id: createRoutineSessionId(now),
      programId: program.id,
      programVersion: program.version,
      scope,
      source: synthetic ? 'synthetic' : 'live',
      mode: trainingMode,
      matcher: { version: FOLLOW_ALONG_CONFIG.version, available: Boolean(matcherRef.current) },
      startedAt: now,
      activeMs: 0,
      outcome: 'in_progress',
      chapters: recorderRef.current.snapshot(),
    }
    persist()
  }, [persist, program, scope, synthetic, trainingMode])

  const stopCapture = useCallback(() => {
    completedRef.current = true
    generationRef.current += 1
    cancelAnimationFrame(rafRef.current)
    cameraRef.current.stop(cameraVideoRef.current ?? undefined)
    overlayRef.current?.clear()
    stageRef.current?.pause()
  }, [])

  const finishCompleted = useCallback(() => {
    if (completedRef.current) return
    stopCapture()
    const saved = persist('completed', Date.now())
    setStatus('completed')
    setCompletion({ outcome: 'completed', recordId: recordRef.current?.id ?? null, saved })
    setCameraMode('idle')
  }, [persist, setStatus, stopCapture])

  const finish = useCallback(() => {
    if (completedRef.current) return
    stopCapture()
    dispatchVoiceEvent({ kind: 'manual_end', at: performance.now() })
    setCourseSnapshot(courseRef.current.manualEnd())
    const saved = persist('incomplete', Date.now())
    setStatus('completed')
    setCompletion({ outcome: 'incomplete', recordId: recordRef.current?.id ?? null, saved })
    setCameraMode('idle')
  }, [dispatchVoiceEvent, persist, setStatus, stopCapture])

  // ---- course / playback clock -----------------------------------------------------------------------------------
  const applyCourse = useCallback((before: CourseSnapshot, after: CourseSnapshot, now: number) => {
    if (after.state !== before.state) {
      gestureControllerRef.current.reset()
      showGesture({ progress: 0 })
      if (after.state === 'ACTIVE' && before.state === 'COUNTDOWN') {
        beginRecord()
        matcherRef.current?.reset()
        feedbackPolicyRef.current.reset()
        lastStageTimeRef.current = stageRef.current?.currentTime ?? step.startSeconds
      }
    }
    dispatchCourseVoice(before, after, now)
    if (after.state !== before.state || after.countdown !== before.countdown) setCourseSnapshot(after)
    if (after.state === 'COURSE_COMPLETE') finishCompleted()
  }, [beginRecord, dispatchCourseVoice, finishCompleted, showGesture, step.startSeconds])

  /** Runs every animation frame while capturing: coverage, the course's progress and throttled UI state. */
  const tick = useCallback((now: number) => {
    if (completedRef.current) return
    const stage = stageRef.current
    const before = courseRef.current.getSnapshot()
    const stageTimeNow = stage?.currentTime ?? lastStageTimeRef.current
    const following = before.state === 'ACTIVE' && sessionStatusRef.current === 'active'
    if (following && stage && !stage.paused && !stage.seeking) {
      recorderRef.current.markPlayback(lastStageTimeRef.current, stageTimeNow, 3 * playbackRate)
      if (recordRef.current && lastTickAtRef.current !== undefined) recordRef.current.activeMs += Math.min(250, now - lastTickAtRef.current)
    }
    lastStageTimeRef.current = stageTimeNow
    lastTickAtRef.current = now
    if (before.state === 'ACTIVE' || before.state === 'TRANSITION') {
      const { progress, target } = routineCourseProgress(step, stage?.ended ? step.endSeconds : stageTimeNow)
      applyCourse(before, courseRef.current.update(now, { ready: true, progress, target }), now)
    }
    if (completedRef.current) return
    const chapter = chapterAt(program, stageTimeNow)
    if (chapter.id !== chapterIdRef.current && chapters.some((item) => item.id === chapter.id)) {
      chapterIdRef.current = chapter.id
      feedbackPolicyRef.current.reset()
      setChapterId(chapter.id)
      if (recordRef.current) persist()
    }
    if (recordRef.current && following && now - lastPersistAtRef.current >= PERSIST_INTERVAL_MS) persist()
    if (now - lastUiAtRef.current >= UI_INTERVAL_MS) {
      lastUiAtRef.current = now
      setStageTime(stageTimeNow)
      setCoveredSeconds(recorderRef.current.coveredSeconds())
    }
  }, [applyCourse, chapters, persist, playbackRate, program, step])
  tickRef.current = tick

  // ---- pose processing -------------------------------------------------------------------------------------------
  const processFrame = useCallback((rawFrame: PoseFrame, options: PoseOverlayDrawOptions & { aspect: number }) => {
    const now = rawFrame.timestamp
    noPoseStartedAtRef.current = undefined
    dispatchPoseAvailability(true, now)
    if (poseUnavailableRef.current) {
      poseUnavailableRef.current = false
      setPoseUnavailable(false)
    }
    if (autoPausedRef.current && sessionStatusRef.current === 'active') {
      autoPausedRef.current = false
      setCourseSnapshot(courseRef.current.resume(now))
      lastStageTimeRef.current = stageRef.current?.currentTime ?? lastStageTimeRef.current
    }
    if (completedRef.current) return

    const forcedGesture = import.meta.env.DEV ? (window as GestureTestWindow).__gestureTestPose : undefined
    const gestureSource = forcedGesture === 'start' ? createGestureDemoPoseFrame(now, 'start', rawFrame) : rawFrame
    const gesturePose = normalizePoseFrame(gestureFilterRef.current.push(gestureSource))
    const filtered = filterRef.current.push(rawFrame)
    const normalized = normalizePoseFrame(filtered)
    if (!normalized || !gesturePose) return
    const quality = extractPoseQuality(normalized, REQUIRED_LANDMARKS, FRAME_MARGIN, FULL_BODY_BOUNDS)
    // Starting needs the whole body clearly visible. While following, limbs are often hidden by the body itself
    // (side-facing forms), so only leaving the frame counts as a framing problem.
    const framingValid = quality.confidence >= FRAMING_CONFIDENCE && quality.bodyInFrame
    const inFrame = quality.bodyInFrame && normalized.confidence >= FOLLOW_ALONG_CONFIG.minUserConfidence
    const before = courseRef.current.getSnapshot()

    if (sessionStatusRef.current === 'paused') {
      const gesture = gestureControllerRef.current.update({ courseState: 'PAUSED', framingValid: true, pose: gesturePose })
      showGesture({ action: gesture.action, progress: gesture.progress })
      if (gesture.triggered === 'resume') togglePauseRef.current()
    } else if (before.state === 'PREPARING' || before.state === 'COUNTDOWN') {
      if (!framingValid) startGestureConfirmedRef.current = false
      // Routine movements (合掌, 十字手 …) resemble the gestures, so gestures only act outside active following.
      const gesture = gestureControllerRef.current.update({ courseState: before.state, framingValid, pose: gesturePose })
      showGesture({ action: gesture.action, progress: gesture.progress })
      if (gesture.triggered === 'start') startGestureConfirmedRef.current = true
      const ready = framingValid && startGestureConfirmedRef.current && stageStatusRef.current === 'ready'
      applyCourse(before, courseRef.current.update(now, { ready, progress: 0, target: 1 }), now)
    }

    const state = courseRef.current.getSnapshot().state
    if (shouldShowPoseOverlay(state)) overlayRef.current?.draw(filtered, [], options)
    else overlayRef.current?.clear()

    const stage = stageRef.current
    const matcher = matcherRef.current
    if (state === 'ACTIVE' && sessionStatusRef.current === 'active' && stage && !stage.paused && now - lastEvaluationAtRef.current >= EVALUATION_INTERVAL_MS) {
      lastEvaluationAtRef.current = now
      if (matcher) {
        const result = matcher.evaluate({ landmarks: normalized.landmarks, confidence: normalized.confidence, aspect: options.aspect }, stage.currentTime, now)
        matchRef.current = result
        recorderRef.current.recordComparison(stage.currentTime, result)
        const chapter = chapterAt(program, stage.currentTime)
        const update = feedbackPolicyRef.current.update(result, now, chapter.cue)
        setMatch(result)
        setFeedback(update.feedback)
        if (update.speak) dispatchVoiceEvent({ kind: 'confirmed_correction', text: update.speak.text, id: update.speak.id, at: now })
      }
    }
    const following = courseRef.current.getSnapshot().state === 'ACTIVE'
    const shownValid = following ? inFrame : framingValid
    showFraming({ valid: shownValid, hint: shownValid ? undefined : framingHint(normalized) })
  }, [applyCourse, dispatchPoseAvailability, dispatchVoiceEvent, program, showFraming, showGesture])
  processFrameRef.current = processFrame

  const processNoPose = useCallback((now: number) => {
    if (completedRef.current) return
    noPoseStartedAtRef.current ??= now
    const lostFor = now - noPoseStartedAtRef.current
    if (lostFor < 500) return
    overlayRef.current?.clear()
    if (!poseUnavailableRef.current) {
      poseUnavailableRef.current = true
      setPoseUnavailable(true)
      showFraming({ valid: false })
    }
    dispatchPoseAvailability(false, now)
    if (sessionStatusRef.current === 'paused') return
    const before = courseRef.current.getSnapshot()
    if (before.state === 'PREPARING' || before.state === 'COUNTDOWN') {
      startGestureConfirmedRef.current = false
      gestureControllerRef.current.reset()
      showGesture({ progress: 0 })
      applyCourse(before, courseRef.current.update(now, { ready: false, progress: 0, target: 1 }), now)
    } else if (before.state === 'ACTIVE' && lostFor >= POSE_LOSS_PAUSE_MS && !autoPausedRef.current) {
      autoPausedRef.current = true
      setCourseSnapshot(courseRef.current.pause(now))
      if (recordRef.current) persist()
    }
  }, [applyCourse, dispatchPoseAvailability, persist, showFraming, showGesture])
  processNoPoseRef.current = processNoPose

  // ---- pause / voice / sound / chapter jumps ------------------------------------------------------------------
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
    const waitingForPose = poseUnavailableRef.current
    if (waitingForPose) autoPausedRef.current = true
    else setCourseSnapshot(courseRef.current.resume(now))
    lastStageTimeRef.current = stageRef.current?.currentTime ?? lastStageTimeRef.current
    dispatchVoiceEvent({ kind: 'resume', text: '继续跟练。', at: now })
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

  const toggleVideoSound = useCallback(() => setVideoMuted((muted) => !muted), [])

  const selectChapter = useCallback((targetId: string) => {
    if (scope.kind !== 'full' || completedRef.current) return
    const target = program.chapters.find((chapter) => chapter.id === targetId)
    const stage = stageRef.current
    if (!target || !stage) return
    stage.currentTime = target.startSeconds
    lastStageTimeRef.current = target.startSeconds
    matcherRef.current?.reset()
    feedbackPolicyRef.current.reset()
    chapterIdRef.current = target.id
    setChapterId(target.id)
    setStageTime(target.startSeconds)
  }, [program, scope.kind])

  // ---- stage video events (wired by the stage component) ----------------------------------------------------------
  /** Idempotent: called from several media events and once after mount (a cached video can load before React commits). */
  const onStageMetadata = useCallback(() => {
    const stage = stageRef.current
    if (!stage || stage.readyState < HTMLMediaElement.HAVE_METADATA || stageStatusRef.current === 'ready') return
    if (stage.currentTime < step.startSeconds - 0.5 || stage.currentTime > step.endSeconds) stage.currentTime = step.startSeconds
    lastStageTimeRef.current = stage.currentTime
    stageStatusRef.current = 'ready'
    setStageStatus('ready')
    setStageTime(stage.currentTime)
  }, [step.endSeconds, step.startSeconds])

  const onStageError = useCallback(() => {
    stageStatusRef.current = 'error'
    setStageStatus('error')
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (stage?.error) onStageError()
    else onStageMetadata()
  }, [onStageError, onStageMetadata])

  const shouldPlay = courseSnapshot.state === 'ACTIVE' && sessionStatus === 'active' && stageStatus === 'ready'

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || stageStatus !== 'ready') return
    stage.playbackRate = playbackRate
    stage.muted = videoMuted
    if (!shouldPlay) {
      stage.pause()
      return
    }
    void stage.play().catch((error: unknown) => {
      // Autoplay with sound can be refused; follow on muted rather than not at all.
      if (error instanceof DOMException && error.name === 'NotAllowedError' && !stage.muted) {
        stage.muted = true
        setVideoMuted(true)
        void stage.play().catch(() => undefined)
      }
    })
  }, [playbackRate, shouldPlay, stageStatus, videoMuted])

  // ---- lifecycle -----------------------------------------------------------------------------------------------------
  useEffect(() => {
    let disposed = false
    void loadReferenceTrack(program.video.poseTrackSrc).then((track) => {
      if (disposed) return
      if (!track) {
        setTrackStatus('unavailable')
        return
      }
      trackRef.current = track
      matcherRef.current = new FollowAlongMatcher(track)
      setTrackStatus('ready')
    })
    return () => { disposed = true }
  }, [program.video.poseTrackSrc])

  useEffect(() => speechRef.current.onAvailabilityChange(setVoiceAvailable), [])
  useEffect(() => speechRef.current.onPlaybackStateChange(setVoicePlayback), [])

  useEffect(() => {
    const camera = cameraRef.current
    const detector = detectorRef.current
    const speech = speechRef.current
    if (detectorCloseTimerRef.current !== undefined) window.clearTimeout(detectorCloseTimerRef.current)
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
      generationRef.current += 1
      cancelAnimationFrame(rafRef.current)
      camera.stop()
      speech.cancel()
      detectorCloseTimerRef.current = window.setTimeout(() => detector.close(), 0)
    }
  }, [persist])

  // Space pauses and resumes, as in Smart Training.
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

  const beginLoop = useCallback((generation: number, frameSource: (now: number) => { frame: PoseFrame | null; width: number; height: number; mirrored: boolean; fresh: boolean }) => {
    setStatus(sessionStatusRef.current === 'ready' ? 'active' : sessionStatusRef.current)
    dispatchCourseVoice(undefined, courseRef.current.getSnapshot(), performance.now())
    const loop = () => {
      if (completedRef.current || generation !== generationRef.current) return
      const now = performance.now()
      performanceRef.current.markUiFrame(now)
      tickRef.current(now)
      const source = frameSource(now)
      if (source.fresh) {
        performanceRef.current.markCameraFrame(now, source.width, source.height)
        if (source.frame) {
          processFrameRef.current(source.frame, {
            mirrored: source.mirrored,
            sourceWidth: source.width,
            sourceHeight: source.height,
            fit: 'contain',
            aspect: source.width / source.height,
          })
        } else processNoPoseRef.current(now)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [dispatchCourseVoice, setStatus])

  const startCamera = useCallback(async () => {
    const video = cameraVideoRef.current
    if (!video || completedRef.current) return
    generationRef.current += 1
    const generation = generationRef.current
    cancelAnimationFrame(rafRef.current)
    setCameraMode('requesting_permission')
    setCameraError(undefined)
    setCameraFailureKind(undefined)
    let cameraReady = false
    try {
      await cameraRef.current.start(video)
      cameraReady = true
      if (generation !== generationRef.current) return cameraRef.current.stop(video)
      setCameraMode('model_loading')
      await detectorRef.current.initialize()
      if (generation !== generationRef.current) return cameraRef.current.stop(video)
      setCameraMode('live')
      beginLoop(generation, (now) => {
        const fresh = video.currentTime !== lastVideoTimeRef.current
        if (!fresh) return { frame: null, width: video.videoWidth, height: video.videoHeight, mirrored: true, fresh }
        lastVideoTimeRef.current = video.currentTime
        const started = performance.now()
        const forceNoPose = import.meta.env.DEV && Boolean((window as GestureTestWindow).__forceNoPose)
        const frame = forceNoPose ? null : detectorRef.current.detect(video, now)
        performanceRef.current.recordInference(now, performance.now() - started, Boolean(frame))
        return { frame, width: video.videoWidth || 1280, height: video.videoHeight || 720, mirrored: true, fresh }
      })
    } catch (error) {
      if (generation !== generationRef.current) return
      setCameraMode('error')
      if (cameraReady) {
        setCameraFailureKind('model_error')
        setCameraError('姿态识别模型加载失败，请重试。')
        if (debug) console.error('Pose model initialization failed', error)
      } else {
        const presentation = cameraErrorPresentation(error)
        setCameraFailureKind(presentation.kind)
        setCameraError(presentation.message)
      }
      cameraRef.current.stop(video)
    }
  }, [beginLoop, debug])

  // Synthetic fixture: starts by itself and feeds the reference pose (DEV only).
  useEffect(() => {
    if (!synthetic) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    let lastFrameAt = 0
    beginLoop(generation, (now) => {
      if (now - lastFrameAt < 33) return { frame: null, width: 640, height: 360, mirrored: false, fresh: false }
      lastFrameAt = now
      const track = trackRef.current
      const forceNoPose = Boolean((window as GestureTestWindow).__forceNoPose)
      const stageSeconds = stageRef.current?.currentTime ?? step.startSeconds
      const reference = track ? referencePoseFrame(track, Math.max(0, stageSeconds - fixtureLagSeconds), now) : null
      // The first posed frames of a video can have poorly tracked feet; start from a clearly visible posture.
      const firstClear = track?.frames.find((item) => item.t >= step.startSeconds && item.confidence > 0
        && [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].every((index) => (item.landmarks[index]?.visibility ?? 0) >= 0.8))
      const startBase = track && firstClear ? referencePoseFrame(track, firstClear.t, now) : null
      const state = courseRef.current.getSnapshot().state
      const requested = (window as GestureTestWindow).__gestureTestPose
      const startGesture = requested === 'start' || (!manualGesture && (state === 'PREPARING' || state === 'COUNTDOWN'))
      let frame: PoseFrame | null = null
      if (!forceNoPose) {
        if (startGesture) frame = startBase ? createGestureDemoPoseFrame(now, 'start', startBase) : null
        else frame = reference ? (fixtureMirror ? mirrorPoseFrame(reference) : reference) : null
      }
      return { frame, width: track?.width ?? 640, height: track?.height ?? 360, mirrored: false, fresh: true }
    })
    return () => { generationRef.current += 1 }
  }, [beginLoop, fixtureLagSeconds, fixtureMirror, manualGesture, step.startSeconds, synthetic])

  // ---- derived view ------------------------------------------------------------------------------------------------
  const chapter = chapters.find((item) => item.id === chapterId) ?? chapters[0]
  const chapterIndex = chapters.indexOf(chapter)
  const totalSeconds = chapters.reduce((sum, item) => sum + (item.endSeconds - item.startSeconds), 0)
  const coachContext = buildRoutineCoachContext({
    program,
    chapter,
    chapterPosition: { index: chapterIndex, total: chapters.length },
    courseState: courseSnapshot.state,
    elapsedSeconds: stageTime - step.startSeconds,
    totalSeconds,
    coveredSeconds,
    match,
    feedback,
    recentReports,
  })
  const gesturePrompt = sessionStatus === 'paused'
    ? '双手在胸前合拢并保持，继续跟练'
    : courseSnapshot.state === 'PREPARING' && framing.valid && stageStatus === 'ready'
      ? '双手在胸前合拢并保持，开始跟练'
      : undefined
  const preparationMessage = courseSnapshot.state === 'PAUSED' && sessionStatus !== 'paused'
    ? '已自动暂停：请回到画面中，识别到后继续播放'
    : poseUnavailable && courseSnapshot.state !== 'ACTIVE' ? '请回到画面中，确保全身完整入镜'
      : !framing.valid && (courseSnapshot.state === 'PREPARING' || courseSnapshot.state === 'COUNTDOWN') && cameraMode !== 'idle' ? framing.hint ?? '请后退一些，确保全身完整入镜'
        : undefined

  return {
    debug,
    fast,
    synthetic,
    program,
    scope,
    chapters,
    chapter,
    chapterIndex,
    step,
    stageRef,
    cameraVideoRef,
    demoImageRef,
    overlayRef,
    cameraMode,
    cameraError,
    cameraFailureKind,
    courseSnapshot,
    sessionStatus,
    stageStatus,
    stageTime,
    videoMuted,
    trackStatus,
    match,
    feedback,
    framing,
    poseUnavailable,
    gesturePrompt,
    gestureProgress: gesturePrompt ? gestureStatus.progress : 0,
    gestureHolding: Boolean(gesturePrompt && gestureStatus.progress > 0),
    preparationMessage,
    voiceEnabled,
    voiceAvailable,
    voicePlayback,
    coveredSeconds,
    totalSeconds,
    completion,
    coachContext,
    startCamera,
    togglePause,
    toggleVoice,
    toggleVideoSound,
    selectChapter,
    finish,
    onStageMetadata,
    onStageError,
    debugData: [
      { label: 'Course state', value: courseSnapshot.state },
      { label: 'Session', value: sessionStatus },
      { label: 'Stage', value: `${stageStatus} · ${stageTime.toFixed(1)} s` },
      { label: 'Chapter', value: chapter.id },
      { label: 'Reference track', value: `${trackStatus}${matcherRef.current ? ` · ${matcherRef.current.frameCount} frames` : ''}` },
      { label: 'Match', value: match ? `${match.status} · ${Math.round(match.similarity * 100)}% · ${Math.round(match.timingOffsetMs)} ms${match.mirrored ? ' · mirrored' : ''}` : 'n/a' },
      { label: 'Covered', value: `${coveredSeconds} / ${Math.round(totalSeconds)} s` },
      { label: 'Record', value: recordRef.current?.id ?? 'none' },
      { label: 'Mode', value: `${trainingMode}${synthetic ? ' · synthetic' : ''}` },
    ],
  }
}

export type RoutineRuntime = ReturnType<typeof useRoutineRuntime>
