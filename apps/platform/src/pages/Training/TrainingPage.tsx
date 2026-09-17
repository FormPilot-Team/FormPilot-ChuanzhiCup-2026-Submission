import { AppHeader } from '../../components/layout/AppHeader'
import { CoachPanel } from '../../components/coach/CoachPanel'
import { CameraPanel } from '../../components/camera/CameraPanel'
import { MetricsPanel } from '../../components/metrics/MetricsPanel'
import { TrainingFooter } from '../../components/training/TrainingFooter'
import { DebugPanel } from '../../components/feedback/DebugPanel'
import { SessionCompleteDialog } from './SessionCompleteDialog'
import { useTrainingRuntime } from './useTrainingRuntime'

export function TrainingPage() {
  const runtime = useTrainingRuntime()
  const { definition } = runtime

  return (
    <div className="min-h-dvh min-w-0 overflow-x-clip bg-[#f6f9fc] text-slate-900">
      <AppHeader />
      <main className="mx-auto min-w-0 max-w-[1600px] px-4 py-5 lg:px-7">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-balance text-2xl font-bold text-slate-950 lg:text-3xl">今日训练 · {definition.presentation.subtitle}</h1>
            <p className="mt-1 text-pretty text-sm text-slate-500">第 {runtime.exerciseIndex + 1} / {runtime.exerciseNames.length} 项 · 实时姿态识别与动作纠正</p>
          </div>
          <p className="rounded-2xl bg-blue-50 px-5 py-3 text-sm font-semibold text-blue-600" data-testid="course-state">{runtime.poseUnavailable ? runtime.framingProfile.poseLost : runtime.courseSnapshot.state === 'COUNTDOWN' ? `${runtime.courseSnapshot.countdown} · 准备开始` : runtime.courseSnapshot.state === 'TRANSITION' ? `完成 ✓ · 下一动作 ${runtime.nextDefinition?.displayName ?? '课程总结'}` : runtime.courseSnapshot.state === 'PAUSED' ? '课程已暂停' : runtime.courseSnapshot.state === 'COURSE_COMPLETE' ? '课程完成 ✓' : runtime.courseSnapshot.state === 'COURSE_INCOMPLETE' ? '课程未完成' : runtime.courseSnapshot.state === 'PREPARING' ? '请进入准备姿势' : '坚持，让更好的自己发生'}</p>
        </div>
        <div className="training-grid grid min-h-[635px] min-w-0 gap-3 xl:h-[clamp(440px,calc(100dvh-300px),580px)] xl:min-h-0 xl:grid-cols-[minmax(0,410px)_minmax(0,1fr)_minmax(0,470px)]">
          <CoachPanel
            viewModel={runtime.coachViewModel}
            showReferenceSkeleton={runtime.debug && runtime.showCoachReference}
          />
          <CameraPanel
            videoRef={runtime.videoRef}
            demoImageRef={runtime.demoImageRef}
            overlayRef={runtime.overlayRef}
            mode={runtime.cameraMode}
            errorMessage={runtime.cameraError}
            errorKind={runtime.cameraFailureKind}
            errors={runtime.result.errors}
            feedback={runtime.feedback}
            demoAsset={definition.presentation.cameraDemo}
            demoFrameSrc={runtime.demoFrameSrc}
            preparationMessage={runtime.preparationMessage}
            outOfFrameMessage={runtime.framingProfile.notInFrame}
            onStart={runtime.startCamera}
          />
          <MetricsPanel result={runtime.result} presentation={definition.presentation} advice={runtime.feedback?.message} guidanceOnly={runtime.courseEnabled && definition.id === 'shoulder_rotation'} trackingState={runtime.session.status === 'paused' ? 'paused' : runtime.poseUnavailable ? 'adjust' : (runtime.cameraMode === 'live' || runtime.cameraMode === 'demo') && runtime.features ? 'normal' : 'preparing'} />
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
