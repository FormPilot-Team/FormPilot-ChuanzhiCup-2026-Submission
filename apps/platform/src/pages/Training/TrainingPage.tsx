import { AICoach } from '../../components/aiCoach/AICoach'
import { AppHeader } from '../../components/layout/AppHeader'
import { buildWarmUpCoachContext, warmUpGuide } from '../../features/coachContext/liveCoachContexts'
import { CameraPanel } from '../../components/camera/CameraPanel'
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

  return (
    <div className="min-h-dvh min-w-0 overflow-x-clip bg-[#f6f9fc] text-slate-900">
      <AppHeader />
      <main className="mx-auto min-w-0 max-w-[1600px] px-4 py-5 lg:px-7">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <TrainingExitControl
              href={SMART_TRAINING_PATH}
              label="返回热身训练"
              phase={warmUpExitPhase({ sessionStatus: runtime.session.status, courseState: demonstrationSnapshot.state, exerciseIndex: runtime.exerciseIndex })}
            />
            <h1 className="text-balance text-2xl font-bold text-slate-950 lg:text-3xl">{freeTraining ? '自由训练' : '今日训练'} · {definition.presentation.subtitle}</h1>
            <p className="mt-1 text-pretty text-sm text-slate-500">{freeTraining ? '单个动作' : `第 ${runtime.exerciseIndex + 1} / ${runtime.exerciseNames.length} 项`} · 实时姿态识别与动作纠正</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AICoach context={coachContext} variant="inline" />
            <p className="rounded-2xl bg-blue-50 px-5 py-3 text-sm font-semibold text-blue-600" data-testid="course-state">{courseStateText(runtime, freeTraining)}</p>
          </div>
        </div>
        <div className="training-grid grid min-h-[635px] min-w-0 gap-3 xl:h-[clamp(520px,calc(100dvh-300px),680px)] xl:min-h-0 xl:grid-cols-[minmax(280px,0.72fr)_minmax(460px,1.45fr)_minmax(340px,0.9fr)]" data-testid="hybrid-training-layout">
          <DemonstrationVideo
            currentExerciseId={definition.id}
            nextExerciseId={runtime.nextDefinition?.id}
            courseSnapshot={demonstrationSnapshot}
          />
          <CameraPanel
            videoRef={runtime.videoRef}
            demoImageRef={runtime.demoImageRef}
            overlayRef={runtime.overlayRef}
            mode={runtime.cameraMode}
            failure={runtime.cameraFailure}
            errors={runtime.result.errors}
            feedback={runtime.feedback}
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
            onStart={runtime.startCamera}
          />
          <AICoachFeedbackDock
            state={coachDockState}
            metrics={(
              <MetricsPanel result={runtime.result} presentation={definition.presentation} advice={runtime.feedback?.message} guidanceOnly={runtime.courseEnabled && definition.id === 'shoulder_rotation'} trackingState={runtime.session.status === 'paused' ? 'paused' : runtime.poseUnavailable ? 'adjust' : (runtime.cameraMode === 'live' || runtime.cameraMode === 'demo') && runtime.features ? 'normal' : 'preparing'} />
            )}
          />
        </div>
        <div className="mt-3">
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
          <div className="mt-3">
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
      </main>
      <SessionCompleteDialog session={runtime.session} persistFailed={runtime.persistFailed} />
    </div>
  )
}
