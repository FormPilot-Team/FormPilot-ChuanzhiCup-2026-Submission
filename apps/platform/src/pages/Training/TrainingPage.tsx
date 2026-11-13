import { AICoach } from '../../components/aiCoach/AICoach'
import { buildWarmUpCoachContext, warmUpGuide } from '../../features/coachContext/liveCoachContexts'
import { CoachToast, ImmersiveCameraPanel } from '../../components/immersive/ImmersiveCameraPanel'
import { ImmersiveShell, ImmersiveTopBar } from '../../components/immersive/ImmersiveShell'
import { useMediaArrangement } from '../../components/immersive/useMediaArrangement'
import { WarmupCountCard } from '../../components/training/WarmupCountCard'
import { DemonstrationVideo } from '../../components/demo/DemonstrationVideo'
import { MetricsPanel } from '../../components/metrics/MetricsPanel'
import { AICoachFeedbackDock } from '../../components/training/AICoachFeedbackDock'
import { TrainingExitControl } from '../../components/training/TrainingExitControl'
import { TrainingFooter } from '../../components/training/TrainingFooter'
import { DebugPanel } from '../../components/feedback/DebugPanel'
import { SessionCompleteDialog } from './SessionCompleteDialog'
import { useTrainingRuntime } from './useTrainingRuntime'
import { resolveCoachDockFeedback, resolveCoachDockState } from '../../features/coach/coachDockState'
import { shouldShowPoseOverlay } from '../../features/pose/poseOverlayVisibility'
import { warmUpExitPhase } from '../../features/training/trainingExit'
import { SMART_TRAINING_PATH } from '../../app/routes'
import { useAdaptiveTraining } from '../../features/adaptiveTraining/useAdaptiveTraining'
import { AdaptiveDecisionPanel } from '../../components/training/AdaptiveDecisionPanel'
import { switchedCue } from '../../features/adaptiveTraining/localGuidance'

type TrainingRuntime = ReturnType<typeof useTrainingRuntime>

function courseStateText(runtime: TrainingRuntime, freeTraining: boolean): string {
  if (runtime.poseUnavailable) return runtime.framingProfile.poseLost
  switch (runtime.courseSnapshot.state) {
    case 'PAUSED': return freeTraining ? '训练已暂停' : '训练已暂停 · 课程已暂停'
    case 'COUNTDOWN': return `${runtime.courseSnapshot.countdown} · 准备开始`
    case 'TRANSITION': return freeTraining ? '完成 ✓ · 即将生成报告' : `完成 ✓ · 下一动作 ${runtime.nextDefinition?.displayName ?? '课程总结'}`
    case 'COURSE_COMPLETE': return freeTraining ? '训练完成 ✓' : '课程完成 ✓'
    case 'COURSE_INCOMPLETE': return freeTraining ? '训练未完成' : '课程未完成'
    case 'PREPARING': return '请进入准备姿势'
    default: return '坚持，让更好的自己发生'
  }
}

export function TrainingPage() {
  const runtime = useTrainingRuntime()
  const { definition } = runtime
  const freeTraining = runtime.freeTrainingExerciseId !== undefined
  const demonstrationSnapshot = runtime.courseEnabled
    ? runtime.courseSnapshot
    : {
        ...runtime.courseSnapshot,
        state: runtime.session.status === 'paused' ? 'PAUSED' as const : 'ACTIVE' as const,
        previousState: runtime.session.status === 'paused' ? 'ACTIVE' as const : undefined,
      }
  const coachDockState = resolveCoachDockState({
    courseState: demonstrationSnapshot.state,
    poseReady: !runtime.poseUnavailable && Boolean(runtime.features?.bodyInFrame),
    ...resolveCoachDockFeedback(runtime.coachViewModel),
    exercise: {
      name: definition.displayName,
      guidance: definition.presentation.guidance,
      preparationText: definition.presentation.coach.preparationText,
      activeText: definition.presentation.coach.activeText,
    },
    nextExerciseName: runtime.nextDefinition?.displayName,
    isSpeaking: runtime.voicePlayback.isSpeaking,
    currentSpokenMessage: runtime.voicePlayback.currentMessage,
  })
  const targetUnit = runtime.courseTargetType === 'duration' ? '秒' as const : runtime.courseTargetType === 'cycles' ? '组' as const : '次' as const
  const coachContext = {
    page: 'training' as const,
    live: buildWarmUpCoachContext({
      definition,
      position: { index: runtime.exerciseIndex, total: runtime.exerciseNames.length },
      freeTraining,
      courseState: demonstrationSnapshot.state,
      progress: runtime.courseProgress,
      target: runtime.courseTarget,
      targetUnit,
      score: runtime.result.currentScore > 0 ? Math.round(runtime.result.currentScore) : null,
      feedback: runtime.feedback,
    }),
    guide: warmUpGuide(definition, targetUnit),
  }
  const overlayCourseState = runtime.courseEnabled
    ? demonstrationSnapshot.state
    : runtime.cameraMode === 'live' || runtime.cameraMode === 'demo'
      ? demonstrationSnapshot.state
      : undefined
  const active = demonstrationSnapshot.state === 'ACTIVE' && runtime.session.status !== 'paused'
    && (runtime.cameraMode === 'live' || runtime.cameraMode === 'demo')
  const poseValid = !runtime.poseUnavailable && Boolean(runtime.features?.bodyInFrame)
    && (runtime.features?.confidence ?? 0) >= .65
    && !runtime.result.errors.some(e => e.code === 'POSE_LOW_CONFIDENCE' || e.code === 'BODY_OUT_OF_FRAME')
  const adaptive = useAdaptiveTraining({
    exerciseId: definition.id, phase: runtime.result.phase,
    trainingState: runtime.session.status === 'completed' ? 'COMPLETE' : runtime.session.status === 'paused' ? 'PAUSED' : active ? 'ACTIVE' : 'PREPARING',
    poseValid, poseReliability: runtime.features?.confidence ?? 0,
    score: runtime.result.confidence >= .65 && definition.id !== 'shoulder_rotation' ? runtime.result.currentScore : null,
    errors: runtime.result.exerciseId === definition.id ? runtime.result.errors
      .filter(e => e.severity >= .8 || e.code === 'KNEE_VALGUS' || e.code === runtime.confirmedPrimaryFeedback?.code)
      .map(e => ({ code: e.code, severity: e.severity })) : [],
    feedback: runtime.feedback?.exerciseId === definition.id ? runtime.feedback : undefined,
    elapsedSeconds: (Date.now() - runtime.session.startedAt) / 1000,
    completion: runtime.courseTarget > 0 ? runtime.courseProgress / runtime.courseTarget : 0,
    completedReps: runtime.exerciseState.repCount,
  })
  const adaptiveDockState = adaptive.decision.strategy === 'SWITCH_CUE'
    ? { ...coachDockState, primaryMessage: switchedCue(adaptive.input?.errors[0]?.code) }
    : coachDockState
  const canPause = active && poseValid && ['START', 'CENTER', 'STANDING', 'READY', 'COMPLETE'].includes(runtime.result.phase)

  const capturing = runtime.cameraMode === 'live' || runtime.cameraMode === 'demo'
  const exerciseComplete = demonstrationSnapshot.state === 'TRANSITION' || demonstrationSnapshot.state === 'COURSE_COMPLETE' || runtime.session.status === 'completed'
  const toastTone = adaptiveDockState.severity === 'warning' ? 'warning' : adaptiveDockState.severity === 'success' ? 'success' : adaptiveDockState.severity === 'info' ? 'info' : 'neutral'
  const arrangement = useMediaArrangement()

  return (
    <ImmersiveShell
      testId="warmup-training-shell"
      topBar={(
        <ImmersiveTopBar
          exit={(
            <TrainingExitControl
              tone="dark"
              href={SMART_TRAINING_PATH}
              label="返回热身训练"
              phase={warmUpExitPhase({ sessionStatus: runtime.session.status, courseState: demonstrationSnapshot.state, exerciseIndex: runtime.exerciseIndex })}
            />
          )}
          title={`${freeTraining ? '自由训练' : '今日训练'} · ${definition.presentation.subtitle}`}
          subtitle={freeTraining ? `单个动作 · ${definition.displayName}` : `第 ${runtime.exerciseIndex + 1} / ${runtime.exerciseNames.length} 项 · ${definition.displayName}`}
          status={<p className="imm-status max-sm:hidden" data-testid="course-state">{courseStateText(runtime, freeTraining)}</p>}
          actions={<AICoach context={coachContext} variant="inline" />}
        />
      )}
    >
      {/* 热身 / 单动作 (Web V1.1 C3): the user's own camera is the main picture; the demonstration is a small window
          beside it with the count, the movement phase and the AI coach. Counting, scoring, phases and the course
          state machine are the runtime's and unchanged. */}
      <div className="imm-warmup" data-testid="hybrid-training-layout" data-layout="camera-primary" data-arrangement={arrangement}>
        <div className="imm-warmup-camera min-w-0" data-layout-region="camera">
          <ImmersiveCameraPanel
            className="h-full"
            videoRef={runtime.videoRef}
            demoImageRef={runtime.demoImageRef}
            overlayRef={runtime.overlayRef}
            mode={runtime.cameraMode}
            failure={runtime.cameraFailure}
            errors={runtime.result.errors}
            demoAsset={definition.presentation.cameraDemo}
            demoFrameSrc={runtime.demoFrameSrc}
            preparationMessage={runtime.preparationMessage}
            gesturePrompt={runtime.gesturePrompt}
            gestureProgress={runtime.gestureProgress}
            gestureHolding={runtime.gestureHolding}
            outOfFrameMessage={runtime.framingProfile.notInFrame}
            showPoseOverlay={shouldShowPoseOverlay(overlayCourseState)}
            framingAssist={runtime.poseUnavailable ? undefined : runtime.framingAssist}
            course={runtime.courseEnabled ? demonstrationSnapshot : undefined}
            correctionActive={Boolean(runtime.confirmedPrimaryFeedback?.side)}
            headerExtra={capturing && runtime.feedback?.kind === 'recovery' ? <span className="imm-chip imm-chip-good" data-testid="camera-recovery">{runtime.feedback.message}</span> : null}
            guidance={<CoachToast message={adaptiveDockState.primaryMessage} tone={toastTone} label={toastTone === 'warning' ? '需要调整' : undefined} testId="warmup-coach-toast" />}
            onStart={runtime.startCamera}
          />
        </div>
        <div className="imm-warmup-side min-w-0" data-layout-region="side">
          <DemonstrationVideo
            variant="compact"
            currentExerciseId={definition.id}
            nextExerciseId={runtime.nextDefinition?.id}
            courseSnapshot={demonstrationSnapshot}
          />
          <WarmupCountCard
            exerciseName={definition.displayName}
            progress={runtime.courseProgress}
            target={runtime.courseTarget}
            targetType={runtime.courseTargetType ?? 'reps'}
            phase={runtime.result.phase}
            presentation={definition.presentation}
            complete={exerciseComplete}
            guidanceOnly={runtime.courseEnabled && definition.id === 'shoulder_rotation'}
          />
          <div className="imm-warmup-dock min-h-0 min-w-0">
            <AICoachFeedbackDock
              state={adaptiveDockState}
              adaptive={<AdaptiveDecisionPanel decision={adaptive.decision} input={adaptive.input} definition={definition} onPause={runtime.togglePause} canPause={canPause} />}
              metrics={(
                <MetricsPanel result={runtime.result} presentation={definition.presentation} advice={runtime.feedback?.message} guidanceOnly={runtime.courseEnabled && definition.id === 'shoulder_rotation'} trackingState={runtime.session.status === 'paused' ? 'paused' : runtime.poseUnavailable ? 'adjust' : capturing && runtime.features ? 'normal' : 'preparing'} />
              )}
            />
          </div>
        </div>
      </div>
      <div className="imm-rail-slot">
        <TrainingFooter
          repCount={runtime.courseProgress}
          targetReps={runtime.courseTarget}
          targetType={runtime.courseTargetType}
          exerciseIndex={runtime.exerciseIndex}
          exerciseNames={runtime.exerciseNames}
          currentName={definition.displayName}
          nextName={runtime.nextDefinition?.displayName}
          sessionStatus={runtime.session.status}
          freeTraining={freeTraining}
          voiceEnabled={runtime.voiceEnabled}
          voiceAvailable={runtime.voiceAvailable}
          onPause={runtime.togglePause}
          onToggleVoice={runtime.toggleVoice}
          onEnd={runtime.finish}
        />
      </div>
      {runtime.debug ? (
        <div className="rounded-3xl bg-white p-1 text-slate-900">
          <DebugPanel
            definition={definition}
            features={runtime.features}
            state={runtime.exerciseState}
            result={runtime.result}
            performance={runtime.performanceData}
            onExportJson={runtime.onExportJson}
            onExportCsv={runtime.onExportCsv}
            showCoachReference={runtime.showCoachReference}
            onShowCoachReferenceChange={runtime.setShowCoachReference}
            runtimeData={runtime.debugRuntimeData}
          />
        </div>
      ) : null}
      <SessionCompleteDialog session={runtime.session} persistFailed={runtime.persistFailed} />
    </ImmersiveShell>
  )
}
