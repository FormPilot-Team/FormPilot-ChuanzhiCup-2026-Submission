import { useCallback, useEffect, useRef, useState } from 'react'
import type { PoseOverlayDrawOptions, PoseOverlayHandle } from '../../components/pose/PoseOverlay'
import { getCoachAnimationFrame, PlaceholderCoachAnimationAdapter } from '../../adapters/coachAnimation/PlaceholderCoachAnimationAdapter'
import { BrowserCameraAdapter } from '../../adapters/camera/BrowserCameraAdapter'
import { useCameraFailure } from '../../features/camera/useCameraFailure'
import { BrowserSpeechAdapter, type VoicePlaybackState } from '../../adapters/speech/BrowserSpeechAdapter'
import { PoseDetector } from '../../features/pose/PoseDetector'
import { PoseFilter } from '../../features/pose/PoseFilter'
import { normalizePoseFrame } from '../../features/pose/PoseNormalizer'
import type { PoseFrame } from '../../features/pose/types'
import type { BaseMotionFeatures } from '../../features/motion/types'
import type { ExerciseDefinition } from '../../features/exercises/contract'
import { EXERCISE_ORDER, getExerciseDefinition, isRegisteredExerciseId } from '../../features/exercises/registry'
import { createExerciseRuntime, type ExerciseRuntime } from '../../features/exercises/runtime'
import { isKneeRaiseRep, isSquatRep, type ExerciseId, type ExerciseState, type RuleResult } from '../../features/exercises/types'
import type { FeedbackEvent } from '../../features/feedback/types'
import { TrainingSession } from '../../features/training/TrainingSession'
import { LocalStorageTrainingSessionRepository } from '../../features/training/LocalStorageTrainingSessionRepository'
import type { TrainingCaptureSource, TrainingSessionState } from '../../features/training/types'
import { resolveTrainingMode } from '../../features/training/trainingMode'
import { createExerciseDemoPoseFrame, createGestureDemoPoseFrame } from '../../data/demoPose'
import { PerformanceTracker, type PerformanceSnapshot } from '../../features/diagnostics/PerformanceTracker'
import { SessionDiagnosticsRecorder, type DiagnosticsDataSource } from '../../features/diagnostics/SessionDiagnosticsRecorder'
import { CourseController, type CourseSnapshot } from '../../features/course/CourseController'
import { ELECTRONIC_COACH_COURSE_V1, resolveCourseTarget } from '../../features/course/CourseDefinition'
import { createFreeTrainingCourse } from '../../features/course/freeTraining'
import type { CourseTargetType } from '../../features/course/CourseDefinition'
import { CoachCardStateResolver } from '../../features/coach/CoachCardStateResolver'
import type { CoachCardResolverInput, CoachExerciseInput } from '../../features/coach/types'
import { getFramingProfile } from '../../features/framing/framingProfiles'
import { deriveCourseVoiceEvents, VoiceGuidePolicy, type VoiceGuideCommand, type VoiceGuideEvent } from '../../features/voice/VoiceGuidePolicy'
import { EncouragementPolicy } from '../../features/voice/EncouragementPolicy'
import { GestureRuntimeController, type GestureAction } from '../../features/gesture/GestureRuntimeController'

type CameraMode = 'idle' | 'requesting_permission' | 'model_loading' | 'live' | 'demo' | 'error'

const emptyPerformance: PerformanceSnapshot = {
  cameraFps: 0, inferenceFps: 0, averageInferenceMs: 0, p95InferenceMs: 0, uiFps: 0,
  droppedFrames: 0, skippedFrames: 0, sampleCount: 0, inputResolution: 'unknown',
}

function initialResult(definition: ExerciseDefinition<BaseMotionFeatures, ExerciseState>): RuleResult {
  return {
    exerciseId: definition.id,
    phase: definition.presentation.initialPhase,
    confidence: 0,
    metrics: Object.fromEntries([
      ...definition.presentation.metrics.map(({ key }) => [key, { value: 0, score: 0, valid: false }]),
      ['completion', { value: 0, score: 0, valid: false }],
    ]),
    currentScore: 0,
    errors: [],
  }
}

function initialState(definition: ExerciseDefinition<BaseMotionFeatures, ExerciseState>): ExerciseState {
  return { phase: definition.presentation.initialPhase, repCount: 0 }
}

function activeMotionDurationMs(state: ExerciseState): number | undefined {
  if (!('activeMotionMs' in state)) return undefined
  return typeof state.activeMotionMs === 'number' ? state.activeMotionMs : undefined
}

function captureSource(demo: boolean, synthetic: boolean): TrainingCaptureSource {
  if (synthetic) return 'synthetic'
  if (demo) return 'demo'
  return 'live'
}

function diagnosticsSource(demo: boolean, synthetic: boolean, dynamicSequence: boolean): DiagnosticsDataSource {
  if (synthetic) return 'synthetic_fixture'
  if (demo) return dynamicSequence ? 'demo_image_sequence' : 'demo_image'
  return 'camera'
}

type DemoSequenceFrame = NonNullable<ExerciseDefinition['presentation']['cameraDemo']['sequence']>[number]

function firstDemoFrame(definition: ExerciseDefinition): DemoSequenceFrame | undefined {
  return definition.presentation.cameraDemo.sequence?.[0]
}

function selectDemoFrame(definition: ExerciseDefinition, elapsedMs: number): DemoSequenceFrame | undefined {
  const sequence = definition.presentation.cameraDemo.sequence
  if (!sequence?.length) return undefined
  const duration = sequence.reduce((sum, frame) => sum + frame.durationMs, 0)
  let cursor = elapsedMs % duration
  for (const frame of sequence) {
    if (cursor < frame.durationMs) return frame
    cursor -= frame.durationMs
  }
  return sequence[0]
}

function coachExerciseInput(definition: ExerciseDefinition): CoachExerciseInput {
  return {
    id: definition.id,
    name: definition.displayName,
    presentation: definition.presentation,
    asset: getCoachAnimationFrame(definition.id),
    referenceProfile: definition.reference,
  }
}

export function useTrainingRuntime() {
  const paramsRef = useRef(new URLSearchParams(window.location.search))
  const debug = paramsRef.current.get('debug') === '1'
  const demo = paramsRef.current.get('demo') === '1'
  const trainingMode = resolveTrainingMode(paramsRef.current.get('fast') === '1')
  const fast = trainingMode === 'fast'
  const voiceTestMode = import.meta.env.DEV && paramsRef.current.get('voice') === '1'
  const voiceFlowEnabled = !demo || voiceTestMode
  const syntheticFixture = import.meta.env.DEV && paramsRef.current.get('fixture') === 'synthetic'
  const manualGestureFixture = syntheticFixture && paramsRef.current.get('gesture') === 'manual'
  const coachFixture = syntheticFixture ? paramsRef.current.get('coachFixture') ?? undefined : undefined
  const requested = paramsRef.current.get('exercise')
  const requestedExercise = isRegisteredExerciseId(requested) ? requested : undefined
  // Product entries always run the course flow: the six-step course, or one of its steps as free training
  // (`/train?exercise=<id>`). `?demo=1&exercise=<id>` without `course=1` keeps the legacy standalone diagnostics.
  const courseEnabled = !demo || paramsRef.current.get('course') === '1'
  const freeTrainingExerciseId = courseEnabled ? requestedExercise : undefined
  const courseDefinitionRef = useRef(freeTrainingExerciseId ? createFreeTrainingCourse(freeTrainingExerciseId) : ELECTRONIC_COACH_COURSE_V1)
  const course = courseDefinitionRef.current
  const courseOrder = course.steps.map((step) => step.exerciseId)
  const courseVoiceExercisesRef = useRef(course.steps.map((step) => {
    const stepDefinition = getExerciseDefinition(step.exerciseId)
    return { id: stepDefinition.id, name: stepDefinition.displayName }
  }))
  const courseVoiceExercises = courseVoiceExercisesRef.current
  const activeCourseDefinition = fast ? { ...course, countdownSeconds: .1, transitionMs: 600 } : course
  const standaloneOrderRef = useRef<ExerciseId[]>(requestedExercise && !EXERCISE_ORDER.includes(requestedExercise) ? [requestedExercise] : EXERCISE_ORDER)
  const standaloneOrder = standaloneOrderRef.current
  const initialExerciseId: ExerciseId = requestedExercise ?? (courseEnabled ? courseOrder[0] : standaloneOrder[0])
  const initialDefinition = getExerciseDefinition(initialExerciseId)

  const videoRef = useRef<HTMLVideoElement>(null)
  const demoImageRef = useRef<HTMLImageElement>(null)
  const overlayRef = useRef<PoseOverlayHandle>(null)
  const cameraRef = useRef(new BrowserCameraAdapter())
  const detectorRef = useRef(new PoseDetector())
  if (import.meta.env.DEV) Object.assign(window, { __poseDetector: detectorRef.current })
  const filterRef = useRef(new PoseFilter())
  const gestureFilterRef = useRef(new PoseFilter({ medianWindow: 3, emaAlpha: 0.5 }))
  const gestureControllerRef = useRef(new GestureRuntimeController())
  const runtimeRef = useRef<ExerciseRuntime>(createExerciseRuntime(initialDefinition))
  const coachRef = useRef(new PlaceholderCoachAnimationAdapter())
  const coachResolverRef = useRef(new CoachCardStateResolver())
  const coachInitializedRef = useRef(false)
  const sessionRef = useRef(new TrainingSession(
    Date.now(),
    new LocalStorageTrainingSessionRepository(),
    courseEnabled ? courseOrder : standaloneOrder,
    captureSource(demo, syntheticFixture),
    trainingMode,
  ))
  const courseRef = useRef(new CourseController(activeCourseDefinition))
  const courseStepIndexRef = useRef(0)
  const speechRef = useRef(new BrowserSpeechAdapter())
  const voicePolicyRef = useRef(new VoiceGuidePolicy())
  const encouragementPolicyRef = useRef(new EncouragementPolicy())
  const voiceEnabledRef = useRef(true)
  const performanceRef = useRef(new PerformanceTracker())
  const diagnosticsRef = useRef(new SessionDiagnosticsRecorder())
  const rafRef = useRef<number>(0)
  const completedRef = useRef(false)
  const switchingRef = useRef(false)
  const lastUiUpdateRef = useRef(0)
  const lastPerformanceUpdateRef = useRef(0)
  const lastVideoTimeRef = useRef(-1)
  const exerciseFrameStartedAtRef = useRef<number | undefined>(undefined)
  const pausedDurationRef = useRef(0)
  const pauseStartedAtRef = useRef<number | undefined>(undefined)
  const demoExerciseStartedAtRef = useRef(performance.now())
  const feedbackRef = useRef<FeedbackEvent | undefined>(undefined)
  const recoveredFeedbackRef = useRef<FeedbackEvent | undefined>(undefined)
  const cameraLoopGenerationRef = useRef(0)
  const detectorCloseTimerRef = useRef<number | undefined>(undefined)
  const processFrameRef = useRef<(rawFrame: PoseFrame, overlayOptions?: PoseOverlayDrawOptions) => void>(() => undefined)
  const processNoPoseRef = useRef<(timestamp: number) => void>(() => undefined)
  const demoFrameRef = useRef<DemoSequenceFrame | undefined>(demo ? firstDemoFrame(initialDefinition) : undefined)
  const phaseTraceRef = useRef<string[]>([initialDefinition.presentation.initialPhase])
  const noPoseStartedAtRef = useRef<number | undefined>(undefined)
  const noPoseCoursePausedRef = useRef(false)
  const noPosePauseStartedAtRef = useRef<number | undefined>(undefined)
  const poseUnavailableRef = useRef(false)
  const startGestureConfirmedRef = useRef(false)
  const gestureActionRef = useRef<() => void>(() => undefined)

  if (initialExerciseId !== (courseEnabled ? courseOrder[0] : standaloneOrder[0]) && sessionRef.current.snapshot().activeExerciseId !== initialExerciseId) {
    sessionRef.current.switchExercise(initialExerciseId)
  }
  if (!coachInitializedRef.current) {
    coachRef.current.loadExercise(initialExerciseId)
    coachRef.current.setLoop(true)
    coachRef.current.play()
    coachInitializedRef.current = true
  }

  const [definition, setDefinition] = useState(initialDefinition)
  const [exerciseState, setExerciseState] = useState<ExerciseState>(() => initialState(initialDefinition))
  const [cameraMode, setCameraMode] = useState<CameraMode>(demo ? 'demo' : 'idle')
  const { failure: cameraFailure, report: reportCameraFailure, clear: clearCameraFailure } = useCameraFailure()
  const [result, setResult] = useState(() => initialResult(initialDefinition))
  const [features, setFeatures] = useState<BaseMotionFeatures>()
  const [feedback, setFeedback] = useState<FeedbackEvent>()
  const [remainingSeconds, setRemainingSeconds] = useState(initialDefinition.presentation.durationSeconds)
  const [session, setSession] = useState<TrainingSessionState>(() => sessionRef.current.start())
  const [performanceData, setPerformanceData] = useState(emptyPerformance)
  const [coachFrame, setCoachFrame] = useState(() => coachRef.current.getFrame())
  const [showCoachReference, setShowCoachReference] = useState(false)
  const [persistFailed, setPersistFailed] = useState(false)
  const [demoFrame, setDemoFrame] = useState<DemoSequenceFrame | undefined>(() => demo ? firstDemoFrame(initialDefinition) : undefined)
  const [phaseTrace, setPhaseTrace] = useState<string[]>(() => [...phaseTraceRef.current])
  const [courseSnapshot, setCourseSnapshot] = useState<CourseSnapshot>(() => courseRef.current.getSnapshot())
  const [poseUnavailable, setPoseUnavailable] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [voiceAvailable, setVoiceAvailable] = useState(() => speechRef.current.isAvailable())
  const [voicePlayback, setVoicePlayback] = useState<VoicePlaybackState>({ isSpeaking: false })
  const [gestureStatus, setGestureStatus] = useState<{ action?: GestureAction; progress: number }>({ progress: 0 })
  const initialCoachInputRef = useRef<CoachCardResolverInput>({
    now: performance.now(),
    courseSnapshot: courseEnabled ? courseRef.current.getSnapshot() : { state: demo ? 'ACTIVE' : 'PREPARING', countdown: 0 },
    exerciseReady: demo,
    exercise: coachExerciseInput(initialDefinition),
    targetType: courseEnabled ? course.steps[0].target.type : 'reps',
    currentProgress: 0,
    targetValue: courseEnabled ? resolveCourseTarget(course.steps[0], fast) : fast ? initialDefinition.presentation.fastTargetReps : initialDefinition.presentation.targetReps,
  })
  const coachInputRef = useRef(initialCoachInputRef.current)
  const [coachViewModel, setCoachViewModel] = useState(() => coachResolverRef.current.resolve(initialCoachInputRef.current))
  const [lastSquatRep, setLastSquatRep] = useState<{
    durationMs: number
    maxHipDrop: number
    minKneeSpreadRatio: number
    maxKneeHeightDiff: number
    maxTorsoLean: number
    score: number
    errors: string
  }>()
  const [lastKneeRaiseRep, setLastKneeRaiseRep] = useState<{
    side: string; durationMs: number; peakKneeHeight: number; hipShiftMax: number; maxTorsoLean: number; score: number; errors: string
  }>()

  const targetReps = useCallback((exerciseId: ExerciseId) => {
    const presentation = getExerciseDefinition(exerciseId).presentation
    return fast ? presentation.fastTargetReps : presentation.targetReps
  }, [fast])

  const applyVoiceCommand = useCallback((command: VoiceGuideCommand) => {
    if (command.kind === 'cancel') {
      speechRef.current.cancel()
      return
    }
    if (command.kind === 'speak') speechRef.current.speak(command.text, command.priority, command.interrupt, command.event)
  }, [])

  const dispatchVoiceEvent = useCallback((event: VoiceGuideEvent) => {
    if (!voiceFlowEnabled) return
    const speech = speechRef.current
    applyVoiceCommand(voicePolicyRef.current.handle(event, {
      muted: !voiceEnabledRef.current,
      available: speech.isAvailable(),
      paused: sessionRef.current.status() === 'paused',
      currentPriority: speech.currentPriority(),
    }))
  }, [applyVoiceCommand, voiceFlowEnabled])

  const dispatchPoseAvailability = useCallback((available: boolean, at: number) => {
    if (!voiceFlowEnabled) return
    const speech = speechRef.current
    applyVoiceCommand(voicePolicyRef.current.onPoseAvailability(available, at, {
      muted: !voiceEnabledRef.current,
      available: speech.isAvailable(),
      paused: sessionRef.current.status() === 'paused',
      currentPriority: speech.currentPriority(),
    }))
  }, [applyVoiceCommand, voiceFlowEnabled])

  const dispatchCourseVoice = useCallback((before: CourseSnapshot | undefined, after: CourseSnapshot, at: number) => {
    if (!courseEnabled || !voiceFlowEnabled) return
    for (const event of deriveCourseVoiceEvents(before, after, courseVoiceExercises, at)) dispatchVoiceEvent(event)
  }, [courseEnabled, courseVoiceExercises, dispatchVoiceEvent, voiceFlowEnabled])

  const activateExercise = useCallback((exerciseId: ExerciseId) => {
    const next = getExerciseDefinition(exerciseId)
    dispatchVoiceEvent({ kind: 'exercise_switch', at: performance.now() })
    runtimeRef.current = createExerciseRuntime(next)
    filterRef.current.reset()
    gestureFilterRef.current.reset()
    gestureControllerRef.current.reset()
    startGestureConfirmedRef.current = false
    overlayRef.current?.clear()
    coachRef.current.reset()
    coachRef.current.loadExercise(exerciseId)
    coachRef.current.setLoop(true)
    coachRef.current.play()
    exerciseFrameStartedAtRef.current = undefined
    demoExerciseStartedAtRef.current = performance.now()
    feedbackRef.current = undefined
    recoveredFeedbackRef.current = undefined
    encouragementPolicyRef.current.resetForExercise()
    lastUiUpdateRef.current = 0
    switchingRef.current = false
    const nextDemoFrame = demo ? firstDemoFrame(next) : undefined
    demoFrameRef.current = nextDemoFrame
    phaseTraceRef.current = [next.presentation.initialPhase]
    setDefinition(next)
    setExerciseState(initialState(next))
    setResult(initialResult(next))
    setFeatures(undefined)
    setGestureStatus({ progress: 0 })
    setFeedback(undefined)
    setRemainingSeconds(next.presentation.durationSeconds)
    setCoachFrame(coachRef.current.getFrame())
    const snapshot = courseRef.current.getSnapshot()
    const step = courseEnabled ? course.steps[snapshot.stepIndex] : undefined
    const coachInput: CoachCardResolverInput = {
      now: performance.now() - pausedDurationRef.current,
      courseSnapshot: courseEnabled ? snapshot : { state: 'ACTIVE', countdown: 0 },
      exerciseReady: !courseEnabled,
      exercise: coachExerciseInput(next),
      targetType: step?.target.type ?? 'reps',
      currentProgress: 0,
      targetValue: step ? resolveCourseTarget(step, fast) : targetReps(exerciseId),
      nextExercise: courseEnabled && snapshot.stepIndex < course.steps.length - 1
        ? coachExerciseInput(getExerciseDefinition(course.steps[snapshot.stepIndex + 1].exerciseId))
        : undefined,
    }
    coachInputRef.current = coachInput
    setCoachViewModel(coachResolverRef.current.resolve(coachInput))
    setSession(sessionRef.current.switchExercise(exerciseId))
    setDemoFrame(nextDemoFrame)
    setPhaseTrace([...phaseTraceRef.current])
    setLastSquatRep(undefined)
    setLastKneeRaiseRep(undefined)
  }, [course, courseEnabled, demo, dispatchVoiceEvent, fast, targetReps])

  const finishCompletedCourse = useCallback(() => {
    if (completedRef.current) return
    completedRef.current = true
    cameraLoopGenerationRef.current += 1
    cameraRef.current.stop(videoRef.current ?? undefined)
    dispatchVoiceEvent({ kind: 'exercise_switch', at: performance.now() })
    coachRef.current.pause()
    filterRef.current.reset()
    runtimeRef.current.reset()
    overlayRef.current?.clear()
    setCourseSnapshot(courseRef.current.getSnapshot())
    setSession(sessionRef.current.finish(Date.now(), 'completed'))
    setPersistFailed(!sessionRef.current.didPersist())
    setCameraMode('idle')
  }, [dispatchVoiceEvent])

  const applyCourseLifecycle = useCallback((courseBefore: CourseSnapshot, courseAfter: CourseSnapshot, completedExerciseId?: ExerciseId) => {
    if (courseAfter.stepIndex !== courseStepIndexRef.current) {
      courseStepIndexRef.current = courseAfter.stepIndex
      activateExercise(course.steps[courseAfter.stepIndex].exerciseId)
      return
    }
    if (courseAfter.state === 'TRANSITION' && courseBefore.state === 'ACTIVE' && completedExerciseId === 'shoulder_rotation') {
      sessionRef.current.completeGuidanceExercise('shoulder_rotation', Date.now())
    }
    if (courseAfter.state === 'COURSE_COMPLETE') finishCompletedCourse()
  }, [activateExercise, course, finishCompletedCourse])

  const processFrame = useCallback((rawFrame: PoseFrame, overlayOptions: PoseOverlayDrawOptions = {}) => {
    noPoseStartedAtRef.current = undefined
    dispatchPoseAvailability(true, rawFrame.timestamp)
    if (poseUnavailableRef.current) {
      poseUnavailableRef.current = false
      setPoseUnavailable(false)
    }
    if (courseEnabled && noPoseCoursePausedRef.current && sessionRef.current.status() === 'active') {
      const pauseStartedAt = noPosePauseStartedAtRef.current ?? rawFrame.timestamp
      const pauseDuration = Math.max(0, rawFrame.timestamp - pauseStartedAt)
      pausedDurationRef.current += pauseDuration
      demoExerciseStartedAtRef.current += pauseDuration
      noPoseCoursePausedRef.current = false
      noPosePauseStartedAtRef.current = undefined
      setCourseSnapshot(courseRef.current.resume(rawFrame.timestamp))
    }
    if (completedRef.current) return
    const gestureFiltered = gestureFilterRef.current.push(rawFrame)
    const gesturePose = normalizePoseFrame(gestureFiltered)
    if (!gesturePose) return
    if (sessionRef.current.status() === 'paused') {
      const gesture = courseEnabled
        ? gestureControllerRef.current.update({ courseState: courseRef.current.getSnapshot().state, framingValid: true, pose: gesturePose })
        : { progress: 0, action: undefined, triggered: undefined, holding: false }
      setGestureStatus({ action: gesture.action, progress: gesture.progress })
      if (gesture.triggered === 'resume') {
        gestureActionRef.current()
        setGestureStatus({ progress: 0 })
      }
      return
    }
    if (sessionRef.current.status() !== 'active') return
    const exerciseFrame = { ...rawFrame, timestamp: rawFrame.timestamp - pausedDurationRef.current }
    const filtered = filterRef.current.push(exerciseFrame)
    const normalized = normalizePoseFrame(filtered)
    if (!normalized || !runtimeRef.current.definition.isPoseCompatible(normalized)) return
    const courseBefore = courseRef.current.getSnapshot()
    const shouldProcessRep = !courseEnabled || courseBefore.state === 'ACTIVE'
    const extracted = runtimeRef.current.extract(normalized)
    const framingValid = extracted.confidence >= .65 && extracted.bodyInFrame
      && (!('baselineReady' in extracted) || Boolean(extracted.baselineReady))
    if (courseEnabled && ['PREPARING', 'COUNTDOWN'].includes(courseBefore.state) && !framingValid) startGestureConfirmedRef.current = false
    const gesture = courseEnabled
      ? gestureControllerRef.current.update({ courseState: courseBefore.state, framingValid, pose: gesturePose })
      : { progress: 0, action: undefined, triggered: undefined, holding: false }
    setGestureStatus({ action: gesture.action, progress: gesture.progress })
    if (gesture.triggered === 'start') startGestureConfirmedRef.current = true
    if (gesture.triggered === 'pause') {
      gestureActionRef.current()
      setGestureStatus({ progress: 0 })
      return
    }
    if (gesture.action === 'pause' && gesture.holding) return
    const engineOutput = shouldProcessRep
      ? runtimeRef.current.processFeatures(extracted)
      : { result: { ...initialResult(runtimeRef.current.definition), confidence: extracted.confidence }, state: initialState(runtimeRef.current.definition), feedback: undefined, confirmedPrimaryFeedback: undefined, recoveredFeedback: undefined }
    const output = { features: extracted, ...engineOutput }
    let courseAfter = courseBefore
    let coachTargetType: CourseTargetType = 'reps'
    let coachTargetValue = targetReps(output.result.exerciseId)
    let coachProgress = output.state.repCount
    if (courseEnabled) {
      const step = course.steps[courseBefore.stepIndex]
      const target = resolveCourseTarget(step, fast)
      const progress = step.target.type === 'duration' && activeMotionDurationMs(output.state) !== undefined ? activeMotionDurationMs(output.state)! / 1000
        : step.target.type === 'duration' ? courseBefore.elapsedMs / 1000
        : step.target.type === 'cycles' ? Math.floor(output.state.repCount / 2) : output.state.repCount
      coachTargetType = step.target.type
      coachTargetValue = target
      coachProgress = progress
      courseAfter = courseRef.current.update(rawFrame.timestamp, {
        ready: framingValid && startGestureConfirmedRef.current,
        progress, target,
      })
      if (courseAfter.state !== courseBefore.state) {
        gestureControllerRef.current.reset()
        setGestureStatus({ progress: 0 })
      }
      if (courseBefore.state !== 'ACTIVE' && courseAfter.state === 'ACTIVE') {
        if ('baselineReady' in output.features) runtimeRef.current.resetEngine()
        else runtimeRef.current.reset()
        filterRef.current.reset()
        demoExerciseStartedAtRef.current = performance.now()
      }
    }
    if (!courseEnabled || courseBefore.state === 'ACTIVE') sessionRef.current.record(output.result, output.state, output.feedback)
    diagnosticsRef.current.record(output.features, output.state, output.result)
    overlayRef.current?.draw(filtered, output.result.errors, overlayOptions)

    if (phaseTraceRef.current.at(-1) !== output.state.phase) {
      phaseTraceRef.current = [...phaseTraceRef.current, output.state.phase].slice(-16)
      setPhaseTrace([...phaseTraceRef.current])
    }
    if (output.state.completedRep && isSquatRep(output.state.completedRep)) {
      setLastSquatRep({
        durationMs: output.state.completedRep.durationMs,
        maxHipDrop: output.state.completedRep.maxHipDrop,
        minKneeSpreadRatio: output.state.completedRep.minKneeSpreadRatio,
        maxKneeHeightDiff: output.state.completedRep.maxKneeHeightDiff,
        maxTorsoLean: output.state.completedRep.maxTorsoLean,
        score: output.result.currentScore,
        errors: output.result.errors.map((item) => item.code).join(', ') || 'none',
      })
    }
    if (output.state.completedRep && isKneeRaiseRep(output.state.completedRep)) {
      setLastKneeRaiseRep({ side: output.state.completedRep.side, durationMs: output.state.completedRep.durationMs,
        peakKneeHeight: output.state.completedRep.peakKneeHeight, hipShiftMax: output.state.completedRep.hipShiftMax,
        maxTorsoLean: output.state.completedRep.maxTorsoLean, score: output.result.currentScore,
        errors: output.result.errors.map((item) => item.code).join(', ') || 'none' })
    }

    if (output.feedback) {
      feedbackRef.current = output.feedback
      setFeedback(output.feedback)
      const profile = getFramingProfile(output.result.exerciseId)
      const poseQualityCorrection = output.feedback.kind === 'correction' && (output.feedback.code === 'BODY_OUT_OF_FRAME' || output.feedback.code === 'POSE_LOW_CONFIDENCE')
      dispatchVoiceEvent({
        kind: output.feedback.kind === 'correction' ? 'confirmed_correction' : 'recovery_positive',
        text: poseQualityCorrection ? profile.notInFrame : output.feedback.message,
        at: output.feedback.timestamp,
        id: output.feedback.id,
        code: output.feedback.code,
      })
    }
    if (output.recoveredFeedback) recoveredFeedbackRef.current = output.recoveredFeedback

    if (courseEnabled) {
      const encouragement = encouragementPolicyRef.current.update({
        exerciseId: output.result.exerciseId,
        exerciseIndex: courseAfter.stepIndex,
        courseState: courseAfter.state,
        poseValid: output.features.confidence >= .65 && output.features.bodyInFrame,
        hasCorrection: Boolean(output.confirmedPrimaryFeedback || output.feedback?.kind === 'correction'),
        hasRecovery: Boolean(output.recoveredFeedback || output.feedback?.kind === 'recovery'),
        currentVoicePriority: speechRef.current.currentPriority(),
        at: rawFrame.timestamp,
      })
      if (encouragement) dispatchVoiceEvent({
        kind: 'encouragement',
        text: encouragement,
        at: rawFrame.timestamp,
        id: `encouragement-${output.result.exerciseId}`,
      })
    }

    const wallNow = performance.now()
    if (wallNow - lastUiUpdateRef.current >= 100) {
      lastUiUpdateRef.current = wallNow
      exerciseFrameStartedAtRef.current ??= output.features.timestamp
      const elapsedSeconds = Math.floor((output.features.timestamp - exerciseFrameStartedAtRef.current) / 1000)
      setFeatures(output.features)
      setResult(output.result)
      setExerciseState(output.state)
      setRemainingSeconds(courseEnabled && course.steps[courseAfter.stepIndex].target.type === 'duration'
        ? Math.max(0, resolveCourseTarget(course.steps[courseAfter.stepIndex], fast) - Math.floor((activeMotionDurationMs(output.state) ?? courseAfter.elapsedMs) / 1000))
        : Math.max(0, runtimeRef.current.definition.presentation.durationSeconds - elapsedSeconds))
      setPerformanceData(performanceRef.current.snapshot(wallNow))
      if (courseEnabled) setCourseSnapshot(courseAfter)
      const nextCoachExercise = courseEnabled && courseAfter.stepIndex < course.steps.length - 1
        ? coachExerciseInput(getExerciseDefinition(course.steps[courseAfter.stepIndex + 1].exerciseId))
        : undefined
      const coachInput: CoachCardResolverInput = {
        now: output.features.timestamp,
        courseSnapshot: courseEnabled ? courseAfter : { state: 'ACTIVE', countdown: 0 },
        exerciseReady: courseEnabled ? !['PREPARING', 'COUNTDOWN'].includes(courseAfter.state) : true,
        exercise: coachExerciseInput(runtimeRef.current.definition),
        targetType: coachTargetType,
        currentProgress: coachProgress,
        targetValue: coachTargetValue,
        confirmedPrimaryFeedback: output.confirmedPrimaryFeedback,
        recoveredFeedback: recoveredFeedbackRef.current,
        nextExercise: nextCoachExercise,
      }
      coachInputRef.current = coachInput
      setCoachViewModel(coachResolverRef.current.resolve(coachInput))
      recoveredFeedbackRef.current = undefined
      if (feedbackRef.current && output.features.timestamp - feedbackRef.current.timestamp > 2400) {
        feedbackRef.current = undefined
        setFeedback(undefined)
      }
    }

    if (courseEnabled) {
      applyCourseLifecycle(courseBefore, courseAfter, output.result.exerciseId)
      dispatchCourseVoice(courseBefore, courseAfter, rawFrame.timestamp)
      return
    }
    const reachedTarget = Boolean(output.state.completedRep) && output.state.repCount >= targetReps(output.result.exerciseId)
    if (!reachedTarget || switchingRef.current) return
    switchingRef.current = true
    const index = standaloneOrder.indexOf(output.result.exerciseId)
    const nextExercise = index >= 0 ? standaloneOrder[index + 1] : undefined
    if (nextExercise) {
      activateExercise(nextExercise)
      return
    }
    completedRef.current = true
    cameraLoopGenerationRef.current += 1
    cameraRef.current.stop(videoRef.current ?? undefined)
    speechRef.current.cancel()
    coachRef.current.pause()
    filterRef.current.reset()
    runtimeRef.current.reset()
    setSession(sessionRef.current.finish())
    setPersistFailed(!sessionRef.current.didPersist())
    setCameraMode('idle')
  }, [activateExercise, applyCourseLifecycle, course, courseEnabled, dispatchCourseVoice, dispatchPoseAvailability, dispatchVoiceEvent, fast, standaloneOrder, targetReps])

  processFrameRef.current = processFrame

  const processNoPose = useCallback((timestamp: number) => {
    if (completedRef.current) return
    noPoseStartedAtRef.current ??= timestamp
    if (timestamp - noPoseStartedAtRef.current < 500) return
    overlayRef.current?.clear()
    if (!poseUnavailableRef.current) {
      poseUnavailableRef.current = true
      setPoseUnavailable(true)
    }
    dispatchPoseAvailability(false, timestamp)
    if (!courseEnabled || sessionRef.current.status() === 'paused') return

    const courseBefore = courseRef.current.getSnapshot()
    let courseAfter = courseBefore
    const step = course.steps[courseBefore.stepIndex]
    const target = resolveCourseTarget(step, fast)
    if (courseBefore.state === 'PREPARING' || courseBefore.state === 'COUNTDOWN') {
      startGestureConfirmedRef.current = false
      gestureControllerRef.current.reset()
      setGestureStatus({ progress: 0 })
      courseAfter = courseRef.current.update(timestamp, { ready: false, progress: 0, target })
    } else if (courseBefore.state === 'ACTIVE' && !noPoseCoursePausedRef.current) {
      const lostAt = noPoseStartedAtRef.current
      courseAfter = courseRef.current.pause(lostAt)
      noPoseCoursePausedRef.current = true
      noPosePauseStartedAtRef.current = lostAt
    } else if (courseBefore.state === 'TRANSITION') {
      courseAfter = courseRef.current.update(timestamp, { ready: false, progress: 0, target })
    }
    if (courseAfter !== courseBefore || courseAfter.state !== courseBefore.state) setCourseSnapshot(courseAfter)
    applyCourseLifecycle(courseBefore, courseAfter)
    dispatchCourseVoice(courseBefore, courseAfter, timestamp)
  }, [applyCourseLifecycle, course, courseEnabled, dispatchCourseVoice, dispatchPoseAvailability, fast])

  processNoPoseRef.current = processNoPose

  useEffect(() => {
    if (!demo) return
    let disposed = false
    let lastInferenceAt = 0
    const tick = (timestamp: number) => {
      performanceRef.current.markUiFrame(timestamp)
      if (timestamp - lastInferenceAt >= 33) {
        lastInferenceAt = timestamp
        const exerciseTime = timestamp - demoExerciseStartedAtRef.current
        const selectedDemoFrame = syntheticFixture ? undefined : selectDemoFrame(runtimeRef.current.definition, exerciseTime)
        const image = demoImageRef.current
        if (selectedDemoFrame && demoFrameRef.current?.id !== selectedDemoFrame.id) {
          demoFrameRef.current = selectedDemoFrame
          if (image) image.src = selectedDemoFrame.src
          setDemoFrame(selectedDemoFrame)
        }
        const started = performance.now()
        const forceNoPose = import.meta.env.DEV && Boolean((window as typeof window & { __forceNoPose?: boolean }).__forceNoPose)
        const requestedGesture = import.meta.env.DEV
          ? (window as typeof window & { __gestureTestPose?: 'start' | 'pause' | 'none' }).__gestureTestPose
          : undefined
        const autoStartGesture = syntheticFixture && courseEnabled && !manualGestureFixture
          && courseRef.current.getSnapshot().state === 'PREPARING'
        const exerciseFixtureFrame = syntheticFixture
          ? { ...createExerciseDemoPoseFrame(runtimeRef.current.definition.id, autoStartGesture ? 0 : exerciseTime, coachFixture), timestamp }
          : undefined
        const frame = forceNoPose ? null : syntheticFixture
          ? requestedGesture
            ? createGestureDemoPoseFrame(timestamp, requestedGesture, exerciseFixtureFrame)
            : autoStartGesture
              ? createGestureDemoPoseFrame(timestamp, 'start', exerciseFixtureFrame)
              : exerciseFixtureFrame
          : image && (!selectedDemoFrame || new URL(image.currentSrc || image.src).pathname === selectedDemoFrame.src)
            ? detectorRef.current.detect(image, timestamp)
            : null
        const width = syntheticFixture ? 1280 : image?.naturalWidth
        const height = syntheticFixture ? 720 : image?.naturalHeight
        performanceRef.current.markCameraFrame(timestamp, width, height)
        performanceRef.current.recordInference(timestamp, performance.now() - started, Boolean(frame))
        if (frame) processFrameRef.current(frame, { mirrored: false, sourceWidth: width, sourceHeight: height,
          fit: runtimeRef.current.definition.presentation.cameraDemo.fit ?? 'cover' })
        else processNoPoseRef.current(timestamp)
      }
      if (!disposed && !completedRef.current) rafRef.current = requestAnimationFrame(tick)
    }
    const start = async () => {
      try {
        await detectorRef.current.initialize()
        if (!disposed) {
          demoExerciseStartedAtRef.current = performance.now()
          const initialFrame = firstDemoFrame(runtimeRef.current.definition)
          demoFrameRef.current = initialFrame
          setDemoFrame(initialFrame)
          dispatchCourseVoice(undefined, courseRef.current.getSnapshot(), performance.now())
          rafRef.current = requestAnimationFrame(tick)
        }
      } catch (error) {
        if (disposed) return
        setCameraMode('error')
        reportCameraFailure(error, 'model')
        if (debug) console.error('Pose model initialization failed', error)
      }
    }
    void start()
    return () => { disposed = true; cancelAnimationFrame(rafRef.current) }
  }, [coachFixture, courseEnabled, debug, demo, dispatchCourseVoice, manualGestureFixture, reportCameraFailure, syntheticFixture])

  useEffect(() => speechRef.current.onAvailabilityChange(setVoiceAvailable), [])

  useEffect(() => speechRef.current.onPlaybackStateChange(setVoicePlayback), [])

  useEffect(() => {
    const camera = cameraRef.current
    const detector = detectorRef.current
    const speech = speechRef.current
    if (detectorCloseTimerRef.current !== undefined) window.clearTimeout(detectorCloseTimerRef.current)
    return () => {
      cameraLoopGenerationRef.current += 1
      cancelAnimationFrame(rafRef.current)
      camera.stop()
      speech.cancel()
      detectorCloseTimerRef.current = window.setTimeout(() => detector.close(), 0)
    }
  }, [])

  const startCamera = async () => {
    const video = videoRef.current
    if (!video) return
    cameraLoopGenerationRef.current += 1
    const generation = cameraLoopGenerationRef.current
    cancelAnimationFrame(rafRef.current)
    setCameraMode('requesting_permission')
    clearCameraFailure()
    let cameraReady = false
    try {
      const stream = await cameraRef.current.start(video)
      cameraReady = true
      if (generation !== cameraLoopGenerationRef.current) {
        cameraRef.current.stop(video)
        return
      }
      setCameraMode('model_loading')
      await detectorRef.current.initialize()
      if (generation !== cameraLoopGenerationRef.current) {
        cameraRef.current.stop(video)
        return
      }
      const settings = stream.getVideoTracks()[0]?.getSettings()
      performanceRef.current.markCameraFrame(performance.now(), settings?.width, settings?.height)
      setPerformanceData(performanceRef.current.snapshot())
      setCameraMode('live')
      dispatchCourseVoice(undefined, courseRef.current.getSnapshot(), performance.now())
      const loop = () => {
        if (completedRef.current || generation !== cameraLoopGenerationRef.current) return
        const timestamp = performance.now()
        performanceRef.current.markUiFrame(timestamp)
        if (video.currentTime === lastVideoTimeRef.current) {
          performanceRef.current.markSkippedFrame()
        } else {
          lastVideoTimeRef.current = video.currentTime
          performanceRef.current.markCameraFrame(timestamp, video.videoWidth, video.videoHeight)
          const started = performance.now()
          const frame = detectorRef.current.detect(video, timestamp)
          performanceRef.current.recordInference(timestamp, performance.now() - started, Boolean(frame))
          if (frame) processFrameRef.current(frame, { mirrored: true, sourceWidth: video.videoWidth, sourceHeight: video.videoHeight, fit: 'contain' })
          else processNoPoseRef.current(timestamp)
        }
        if (timestamp - lastPerformanceUpdateRef.current >= 250) {
          lastPerformanceUpdateRef.current = timestamp
          setPerformanceData(performanceRef.current.snapshot(timestamp))
        }
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    } catch (error) {
      if (generation !== cameraLoopGenerationRef.current) return
      setCameraMode('error')
      reportCameraFailure(error, cameraReady ? 'model' : 'camera')
      if (cameraReady && debug) console.error('Pose model initialization failed', error)
      cameraRef.current.stop(video)
    }
  }

  const togglePause = useCallback(() => {
    gestureControllerRef.current.reset()
    setGestureStatus({ progress: 0 })
    const next = sessionRef.current.togglePause()
    const now = performance.now()
    const waitingForPose = poseUnavailableRef.current && next.status === 'active'
    const nextCourseSnapshot = courseEnabled
      ? next.status === 'paused' ? courseRef.current.pause(now) : waitingForPose ? courseRef.current.getSnapshot() : courseRef.current.resume(now)
      : next.status === 'paused'
        ? { state: 'PAUSED', previousState: coachInputRef.current.courseSnapshot.state, countdown: 0 } as CourseSnapshot
        : { state: coachInputRef.current.courseSnapshot.previousState ?? 'ACTIVE', countdown: 0 } as CourseSnapshot
    if (courseEnabled) setCourseSnapshot(nextCourseSnapshot)
    setSession(next)
    if (next.status === 'paused') {
      pauseStartedAtRef.current = now
      dispatchVoiceEvent({ kind: 'pause', text: '训练已暂停。', at: now }); coachRef.current.pause()
    } else {
      if (pauseStartedAtRef.current !== undefined && !noPoseCoursePausedRef.current) {
        const pauseDuration = now - pauseStartedAtRef.current
        pausedDurationRef.current += pauseDuration
        demoExerciseStartedAtRef.current += pauseDuration
      }
      pauseStartedAtRef.current = undefined
      if (waitingForPose && courseEnabled) {
        noPoseCoursePausedRef.current = true
        noPosePauseStartedAtRef.current ??= noPoseStartedAtRef.current ?? now
      }
      coachRef.current.play()
      dispatchVoiceEvent({ kind: 'resume', text: '继续训练。', at: now })
    }
    const coachInput = { ...coachInputRef.current, now, courseSnapshot: nextCourseSnapshot }
    coachInputRef.current = coachInput
    setCoachViewModel(coachResolverRef.current.resolve(coachInput))
  }, [courseEnabled, dispatchVoiceEvent])

  gestureActionRef.current = togglePause

  const toggleVoice = useCallback(() => {
    const nextEnabled = !voiceEnabledRef.current
    if (!nextEnabled) dispatchVoiceEvent({ kind: 'mute', at: performance.now() })
    voiceEnabledRef.current = nextEnabled
    speechRef.current.setMuted(!nextEnabled)
    setVoiceEnabled(nextEnabled)
  }, [dispatchVoiceEvent])

  const finish = () => {
    completedRef.current = true
    cameraLoopGenerationRef.current += 1
    cameraRef.current.stop(videoRef.current ?? undefined)
    cancelAnimationFrame(rafRef.current)
    dispatchVoiceEvent({ kind: 'manual_end', at: performance.now() })
    coachRef.current.pause()
    filterRef.current.reset()
    runtimeRef.current.reset()
    if (courseEnabled) setCourseSnapshot(courseRef.current.manualEnd())
    setSession(sessionRef.current.finish(Date.now(), courseEnabled ? 'incomplete' : 'completed'))
    setPersistFailed(!sessionRef.current.didPersist())
    setCameraMode('idle')
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      const target = event.target
      if (target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return
      if (sessionRef.current.status() === 'completed') return
      event.preventDefault()
      togglePause()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePause])

  const exportContext = {
    specVersion: definition.specVersion,
    thresholdVersion: definition.thresholdVersion,
    dataSource: diagnosticsSource(demo, syntheticFixture, Boolean(definition.presentation.cameraDemo.sequence?.length)),
    captureSource: session.source,
  }

  const activeOrder = courseEnabled ? courseOrder : standaloneOrder
  const exerciseIndex = activeOrder.indexOf(definition.id)
  const nextDefinition = exerciseIndex < activeOrder.length - 1 ? getExerciseDefinition(activeOrder[exerciseIndex + 1]) : undefined
  const framingProfile = getFramingProfile(definition.id)
  const currentFramingValid = Boolean(features && features.confidence >= .65 && features.bodyInFrame
    && (!('baselineReady' in features) || Boolean(features.baselineReady)))
  const gesturePrompt = courseEnabled && courseSnapshot.state === 'PAUSED'
    ? '双手在胸前合拢并保持，继续训练'
    : courseEnabled && courseSnapshot.state === 'PREPARING' && currentFramingValid
      ? '双手在胸前合拢并保持，开始训练'
      : undefined

  return {
    debug,
    definition,
    exerciseState,
    cameraMode,
    cameraFailure,
    poseUnavailable,
    result,
    features,
    feedback,
    remainingSeconds,
    session,
    persistFailed,
    performanceData,
    coachFrame,
    coachViewModel,
    showCoachReference,
    setShowCoachReference,
    videoRef,
    demoImageRef,
    demoFrameSrc: demoFrame?.src,
    framingProfile,
    voiceEnabled,
    voiceAvailable,
    voicePlayback,
    gesturePrompt,
    gestureProgress: gesturePrompt ? gestureStatus.progress : 0,
    gestureHolding: Boolean(gesturePrompt && gestureStatus.progress > 0),
    preparationMessage: courseEnabled && courseSnapshot.state === 'PAUSED' ? undefined
      : poseUnavailable ? framingProfile.poseLost
      : courseEnabled && ['PREPARING', 'COUNTDOWN'].includes(courseSnapshot.state) && features && !features.bodyInFrame
      ? framingProfile.notInFrame
      : definition.id === 'knee_raise' && (!features || !('baselineReady' in features) || !features.baselineReady)
      ? '请自然站立，准备开始'
      : coachViewModel.state === 'PREPARING' && courseEnabled && !currentFramingValid ? definition.presentation.coach.preparationText : undefined,
    overlayRef,
    startCamera,
    togglePause,
    toggleVoice,
    finish,
    targetReps: targetReps(definition.id),
    courseSnapshot,
    courseEnabled,
    freeTrainingExerciseId,
    courseTargetType: courseEnabled ? course.steps[courseSnapshot.stepIndex].target.type : 'reps',
    courseTarget: courseEnabled ? resolveCourseTarget(course.steps[courseSnapshot.stepIndex], fast) : targetReps(definition.id),
    courseProgress: courseEnabled
      ? course.steps[courseSnapshot.stepIndex].target.type === 'duration' ? Math.min(resolveCourseTarget(course.steps[courseSnapshot.stepIndex], fast), Math.floor((activeMotionDurationMs(exerciseState) ?? courseSnapshot.elapsedMs) / 1000))
        : course.steps[courseSnapshot.stepIndex].target.type === 'cycles' ? Math.floor(exerciseState.repCount / 2) : exerciseState.repCount
      : exerciseState.repCount,
    exerciseIndex,
    nextDefinition,
    exerciseNames: activeOrder.map((id) => getExerciseDefinition(id).displayName),
    debugRuntimeData: [
      { label: 'Demo source', value: syntheticFixture ? 'synthetic fixture (DEV only)' : demoFrame ? 'real image sequence' : demo ? 'real static image' : 'camera' },
      { label: 'Demo frame', value: demoFrame?.id ?? 'n/a' },
      { label: 'Pose pipeline', value: syntheticFixture ? 'DEV shortcut' : 'PoseDetector → Filter → Normalizer → Runtime' },
      { label: 'Course state', value: courseSnapshot.state },
      { label: 'Course step', value: `${courseSnapshot.stepIndex + 1} / ${course.steps.length}` },
      { label: 'Course countdown', value: String(courseSnapshot.countdown) },
      { label: 'Phase trace', value: phaseTrace.join(' → ') },
      { label: 'MediaPipe init count', value: String(detectorRef.current.initializationCount) },
      { label: 'coachState', value: coachViewModel.state },
      { label: 'coachHighlightRegion', value: coachViewModel.highlightRegion },
      { label: 'coachPrimaryMessage', value: coachViewModel.primaryMessage },
      { label: 'coachPositiveSourceError', value: coachViewModel.positiveSourceError ?? 'none' },
      { label: 'coachPositiveRemainingMs', value: String(coachViewModel.positiveRemainingMs) },
      { label: 'nextExercise', value: coachViewModel.nextExercise?.name ?? nextDefinition?.displayName ?? 'none' },
      ...(lastSquatRep ? [
        { label: 'Last rep duration', value: `${lastSquatRep.durationMs} ms` },
        { label: 'Last maxHipDrop', value: lastSquatRep.maxHipDrop.toFixed(3) },
        { label: 'Last knee spread', value: lastSquatRep.minKneeSpreadRatio.toFixed(2) },
        { label: 'Last knee height diff', value: lastSquatRep.maxKneeHeightDiff.toFixed(3) },
        { label: 'Last torso lean', value: `${lastSquatRep.maxTorsoLean.toFixed(1)}°` },
        { label: 'Last rep score', value: String(lastSquatRep.score) },
        { label: 'Last rep errors', value: lastSquatRep.errors },
      ] : []),
      ...(lastKneeRaiseRep ? [
        { label: 'Last side', value: lastKneeRaiseRep.side }, { label: 'Last rep duration', value: `${lastKneeRaiseRep.durationMs} ms` },
        { label: 'Last peak knee height', value: lastKneeRaiseRep.peakKneeHeight.toFixed(3) },
        { label: 'Last hip shift', value: lastKneeRaiseRep.hipShiftMax.toFixed(3) },
        { label: 'Last torso lean', value: `${lastKneeRaiseRep.maxTorsoLean.toFixed(1)}°` },
        { label: 'Last rep score', value: String(lastKneeRaiseRep.score) }, { label: 'Last rep errors', value: lastKneeRaiseRep.errors },
      ] : []),
    ],
    onExportJson: () => diagnosticsRef.current.downloadJson(performanceRef.current.snapshot(), exportContext),
    onExportCsv: () => diagnosticsRef.current.downloadCsv(),
  }
}
