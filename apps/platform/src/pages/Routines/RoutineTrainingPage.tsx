import { useMemo, type CSSProperties } from 'react'
import { routinePath } from '../../app/routes'
import { CameraPanel } from '../../components/camera/CameraPanel'
import { AICoach } from '../../components/aiCoach/AICoach'
import { AppHeader } from '../../components/layout/AppHeader'
import { routineGuide } from '../../features/coachContext/liveCoachContexts'
import { RoutineCameraStatus } from '../../components/routines/RoutineCameraStatus'
import { RoutineChapterPoints } from '../../components/routines/RoutineChapterPoints'
import { RoutineFeedbackPanel, type RoutineTrackingState } from '../../components/routines/RoutineFeedbackPanel'
import { RoutineFooter } from '../../components/routines/RoutineFooter'
import { RoutineVideoStage } from '../../components/routines/RoutineVideoStage'
import { useMatchedMediaHeight } from '../../components/routines/useMatchedMediaHeight'
import { TrainingExitControl } from '../../components/training/TrainingExitControl'
import { routineExitPhase } from '../../features/training/trainingExit'
import { ROUTINE_ACCENT } from '../../components/routines/routineTheme'
import { shouldShowPoseOverlay } from '../../features/pose/poseOverlayVisibility'
import type { RoutineFeedbackTone } from '../../features/routines/followAlong/feedbackPolicy'
import { routineAnalyzerTitle } from '../../features/routines/analyzers/registry'
import { liveChecks } from '../../features/routines/followAlong/liveChecks'
import { chapterDisplayName, scopeChapters } from '../../features/routines/scope'
import type { RoutineProgram, RoutineScope } from '../../features/routines/types'
import { cn } from '../../lib/cn'
import { RoutineCompleteDialog } from './RoutineCompleteDialog'
import { useRoutineRuntime, type RoutineRuntime } from './useRoutineRuntime'

function stateText(runtime: RoutineRuntime): string {
  if (runtime.sessionStatus === 'paused') return '已暂停'
  switch (runtime.courseSnapshot.state) {
    case 'PAUSED': return '等待回到画面'
    case 'COUNTDOWN': return `${runtime.courseSnapshot.countdown} · 准备开始`
    case 'ACTIVE': return '跟练中'
    case 'TRANSITION':
    case 'COURSE_COMPLETE': return '跟练完成 ✓'
    case 'COURSE_INCOMPLETE': return '跟练已结束'
    default: return runtime.cameraMode === 'idle' || runtime.cameraMode === 'error' ? '启用摄像头后开始' : '请进入准备姿势'
  }
}

function coachLine(runtime: RoutineRuntime): { message: string; tone: RoutineFeedbackTone } {
  const state = runtime.courseSnapshot.state
  if (runtime.sessionStatus === 'completed' || state === 'COURSE_COMPLETE' || state === 'TRANSITION') return { message: '本次跟练完成，可以查看跟练报告。', tone: 'success' }
  if (runtime.sessionStatus === 'paused') return { message: '已暂停。双手在胸前合拢并保持，可以继续跟练。', tone: 'neutral' }
  if (state === 'PAUSED') return { message: '请回到画面中，识别到你后会自动继续播放。', tone: 'warning' }
  if (state === 'COUNTDOWN') return { message: '准备开始，跟着示范一起动起来。', tone: 'info' }
  if (state === 'ACTIVE') {
    if (runtime.trackStatus === 'unavailable') return { message: '本次无法比对动作，请跟着视频完成练习。', tone: 'neutral' }
    if (!runtime.framing.valid && !runtime.poseUnavailable && runtime.framing.hint) return { message: runtime.framing.hint, tone: 'warning' }
    return runtime.feedback ? { message: runtime.feedback.message, tone: runtime.feedback.tone } : { message: runtime.chapter.cue, tone: 'info' }
  }
  if (runtime.cameraMode === 'idle' || runtime.cameraMode === 'error') return { message: '启用摄像头，站到离屏幕约 2.5 米处，让全身完整入镜。', tone: 'neutral' }
  if (runtime.stageStatus !== 'ready') return { message: '标准示范加载中，请稍候。', tone: 'neutral' }
  if (!runtime.framing.valid) return { message: runtime.framing.hint ?? '请后退一些，确保全身完整入镜。', tone: 'info' }
  return { message: '站好了！双手在胸前合拢并保持，开始跟练。', tone: 'info' }
}

function trackingState(runtime: RoutineRuntime): RoutineTrackingState {
  if (runtime.sessionStatus === 'completed') return 'done'
  if (runtime.sessionStatus === 'paused') return 'paused'
  if (runtime.poseUnavailable || (runtime.cameraMode === 'live' || runtime.cameraMode === 'demo') && !runtime.framing.valid && runtime.courseSnapshot.state !== 'PREPARING') return 'adjust'
  if ((runtime.cameraMode === 'live' || runtime.cameraMode === 'demo') && runtime.framing.valid) return 'normal'
  return 'preparing'
}

const CAMERA_ASPECT = 16 / 9

/** Column template for the follow-along stage: demonstration and camera widths in proportion to their pictures. */
function routineColumns(contentAspect: number): CSSProperties {
  const demo = Number((contentAspect / CAMERA_ASPECT).toFixed(3))
  return {
    '--routine-cols-md': `minmax(0,${demo}fr) minmax(0,1fr)`,
    '--routine-cols-xl': `minmax(0,${demo}fr) minmax(0,1fr) minmax(280px,.64fr)`,
  } as CSSProperties
}

export function RoutineTrainingPage({ program, scope }: { program: RoutineProgram; scope: RoutineScope }) {
  const runtime = useRoutineRuntime(program, scope)
  const demoMedia = useMatchedMediaHeight<HTMLDivElement>()
  const accent = ROUTINE_ACCENT[program.accent]
  const { chapter, courseSnapshot } = runtime
  const coach = coachLine(runtime)
  const heading = scope.kind === 'full' ? `${program.title} · 整套跟练` : `${program.title} · ${chapterDisplayName(scopeChapters(program, scope)[0])}`
  const capturing = runtime.cameraMode === 'live' || runtime.cameraMode === 'demo'
  const outOfFrame = capturing && courseSnapshot.state === 'ACTIVE' && !runtime.framing.valid && !runtime.poseUnavailable
  const finished = runtime.sessionStatus === 'completed' || courseSnapshot.state === 'TRANSITION' || courseSnapshot.state === 'COURSE_COMPLETE'
  const following = capturing && courseSnapshot.state === 'ACTIVE' && runtime.sessionStatus === 'active'
  const analyzerTitle = useMemo(() => routineAnalyzerTitle(program), [program])
  const checks = liveChecks({
    routine: program.id,
    chapter,
    record: runtime.techniqueRecord,
    videoSeconds: runtime.stageTime,
    match: runtime.match,
    following,
    comparisonAvailable: runtime.trackStatus !== 'unavailable',
  })
  return (
    <div className="min-h-dvh min-w-0 overflow-x-clip bg-[#f6f9fc] text-slate-900" data-routine={program.id}>
      <AppHeader immersive />
      <main className="mx-auto min-w-0 max-w-[1600px] px-4 py-5 lg:px-7">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <TrainingExitControl href={routinePath(program.id)} label={`返回${program.title}`} phase={routineExitPhase({ sessionStatus: runtime.sessionStatus, courseState: courseSnapshot.state })} />
            <h1 className="text-balance text-2xl font-bold text-slate-950 lg:text-3xl">{heading}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-pretty text-sm text-slate-500">
              <span className={cn('rounded-md px-2 py-0.5 text-xs font-semibold', accent.chip)}>{program.subtitle}</span>
              {scope.kind === 'full' ? <span>第 {runtime.chapterIndex + 1} / {runtime.chapters.length} 段</span> : <span>单独练习</span>}
              <span aria-hidden="true">·</span><span>跟随标准视频，实时比对动作</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AICoach context={{ page: 'training', live: runtime.coachContext, guide: routineGuide(program, chapter) }} variant="inline" />
            <p className="rounded-2xl bg-blue-50 px-5 py-3 text-sm font-semibold text-blue-600" data-testid="routine-state" data-course-state={courseSnapshot.state} data-session-status={runtime.sessionStatus}>{stateText(runtime)}</p>
          </div>
        </div>

        {/* 标准示范 | 我的画面 share one media height. The demonstration column is as wide as its picture needs at the
            camera's 16:9 height (a 4:3 source gets a narrower column), so neither picture is stretched or cropped and the
            camera box stays close to its own 16:9; the hook below removes the last few pixels of difference. */}
        <div
          className="grid min-w-0 items-start gap-3 md:grid-cols-(--routine-cols-md) xl:grid-cols-(--routine-cols-xl) xl:items-stretch"
          style={routineColumns(program.video.contentAspect)}
          data-testid="routine-training-layout"
          data-layout="camera-centered"
        >
          <div className="flex min-w-0 flex-col gap-3 self-start xl:self-stretch" data-layout-region="demonstration">
            <RoutineVideoStage
              program={program}
              chapter={chapter}
              stageRef={runtime.stageRef}
              mediaRef={demoMedia.ref}
              stageStatus={runtime.stageStatus}
              stageSlow={runtime.stageSlow}
              diagnostics={runtime.stageDiagnostics}
              stageTime={runtime.stageTime}
              course={courseSnapshot}
              manuallyPaused={runtime.sessionStatus === 'paused'}
              videoMuted={runtime.videoMuted}
              onToggleSound={runtime.toggleVideoSound}
              onMetadata={runtime.onStageMetadata}
              onError={runtime.onStageError}
              onReload={runtime.reloadStage}
            />
            <RoutineChapterPoints program={program} chapter={chapter} />
          </div>
          <div className="flex min-w-0 flex-col self-start xl:self-stretch [&>section]:xl:flex-1" data-layout-region="camera">
            <CameraPanel
              variant="compact"
              stageHeight={demoMedia.height}
              course={courseSnapshot}
              title="我的画面"
              videoRef={runtime.cameraVideoRef}
              demoImageRef={runtime.demoImageRef}
              overlayRef={runtime.overlayRef}
              mode={runtime.cameraMode}
              failure={runtime.cameraFailure}
              errors={outOfFrame ? [{ code: 'BODY_OUT_OF_FRAME', severity: 1, message: runtime.framing.hint ?? '' }] : []}
              demoAsset={{ portraitSrc: program.video.posterSrc, landscapeSrc: program.video.posterSrc, alt: `${program.title}测试画面`, fit: 'contain' }}
              preparationMessage={runtime.preparationMessage}
              gesturePrompt={runtime.gesturePrompt}
              gestureProgress={runtime.gestureProgress}
              gestureHolding={runtime.gestureHolding}
              outOfFrameMessage={runtime.framing.hint ?? '请后退一些，确保全身完整入镜'}
              showPoseOverlay={shouldShowPoseOverlay(courseSnapshot.state)}
              framingAssist={runtime.poseUnavailable ? undefined : runtime.framingAssist}
              footer={<RoutineCameraStatus cameraMode={runtime.cameraMode} framingAssist={runtime.framingAssist} poseUnavailable={runtime.poseUnavailable} paused={runtime.sessionStatus === 'paused'} />}
              onStart={runtime.startCamera}
            />
          </div>
          <div className="flex min-w-0 flex-col self-start md:col-span-2 xl:col-span-1 xl:self-stretch" data-layout-region="feedback">
            <RoutineFeedbackPanel
              accent={program.accent}
              match={runtime.match}
              checks={checks}
              trackingState={trackingState(runtime)}
              coachMessage={coach.message}
              coachTone={coach.tone}
              comparisonAvailable={runtime.trackStatus !== 'unavailable'}
              analyzer={analyzerTitle && runtime.trackStatus !== 'unavailable' ? { title: analyzerTitle, live: runtime.analysisLive, following } : undefined}
            />
          </div>
        </div>

        <div className="mt-3">
          <RoutineFooter
            program={program}
            chapters={runtime.chapters}
            chapter={chapter}
            elapsedSeconds={Math.max(0, runtime.stageTime - runtime.step.startSeconds)}
            totalSeconds={runtime.totalSeconds}
            paused={runtime.sessionStatus === 'paused'}
            canControl={runtime.sessionStatus === 'active' || runtime.sessionStatus === 'paused'}
            canJump={scope.kind === 'full' && runtime.sessionStatus !== 'completed' && runtime.stageStatus === 'ready'}
            finished={finished}
            voiceEnabled={runtime.voiceEnabled}
            voiceAvailable={runtime.voiceAvailable}
            onSelectChapter={runtime.selectChapter}
            onPause={runtime.togglePause}
            onToggleVoice={runtime.toggleVoice}
            onEnd={runtime.finish}
          />
        </div>

        {runtime.debug ? (
          <section className="panel mt-3 p-4" aria-label="调试信息" data-testid="routine-debug">
            <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {runtime.debugData.map((item) => <div key={item.label} className="flex min-w-0 justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"><dt className="text-slate-500">{item.label}</dt><dd className="truncate font-mono text-slate-800">{item.value}</dd></div>)}
            </dl>
          </section>
        ) : null}
      </main>
      <RoutineCompleteDialog completion={runtime.completion} program={program} scope={scope} />
    </div>
  )
}
