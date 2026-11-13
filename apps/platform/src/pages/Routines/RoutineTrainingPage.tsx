import { useMemo, useState, type CSSProperties } from 'react'
import { routinePath } from '../../app/routes'
import { AICoach } from '../../components/aiCoach/AICoach'
import { DemoStage } from '../../components/immersive/DemoStage'
import { CoachToast, ImmersiveCameraPanel } from '../../components/immersive/ImmersiveCameraPanel'
import { DetailsDrawer, DetailsToggle, ImmersiveShell, ImmersiveTopBar } from '../../components/immersive/ImmersiveShell'
import { useMediaArrangement } from '../../components/immersive/useMediaArrangement'
import type { PoseHighlightRegion } from '../../components/pose/PoseOverlay'
import { RoutineCameraStatus } from '../../components/routines/RoutineCameraStatus'
import { RoutineChapterPoints } from '../../components/routines/RoutineChapterPoints'
import { RoutineFeedbackPanel, type RoutineTrackingState } from '../../components/routines/RoutineFeedbackPanel'
import { RoutineFooter } from '../../components/routines/RoutineFooter'
import { useMatchedMediaHeight } from '../../components/routines/useMatchedMediaHeight'
import { TrainingExitControl } from '../../components/training/TrainingExitControl'
import { routineGuide } from '../../features/coachContext/liveCoachContexts'
import { configuredPresenter, resolveRoutineDemo } from '../../features/demo/demoPresenter'
import { shouldShowPoseOverlay } from '../../features/pose/poseOverlayVisibility'
import { routineAnalyzerTitle } from '../../features/routines/analyzers/registry'
import type { RoutineFeedback, RoutineFeedbackTone } from '../../features/routines/followAlong/feedbackPolicy'
import { liveChecks } from '../../features/routines/followAlong/liveChecks'
import type { FollowAlongMatch } from '../../features/routines/followAlong/matcher'
import { chapterDisplayName, scopeChapters } from '../../features/routines/scope'
import type { RoutineProgram, RoutineScope } from '../../features/routines/types'
import { routineExitPhase } from '../../features/training/trainingExit'
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

/** Column template in landscape: demonstration and camera widths in proportion to their pictures at one height. */
function routineColumns(contentAspect: number): CSSProperties {
  const demo = Number((contentAspect / CAMERA_ASPECT).toFixed(3))
  return { '--imm-cols': `minmax(0,${demo}fr) minmax(0,1fr)`, '--imm-demo-aspect': String(contentAspect) } as CSSProperties
}

/** A confirmed follow-along correction names a body region; that region is marked on the user's own skeleton. */
function highlightRegion(feedback?: RoutineFeedback): PoseHighlightRegion | undefined {
  if (feedback?.code === 'MISMATCH_ARMS') return 'arms'
  if (feedback?.code === 'MISMATCH_TORSO') return 'torso'
  if (feedback?.code === 'MISMATCH_LEGS') return 'legs'
  return undefined
}

function rhythmShort(match: FollowAlongMatch): string {
  if (match.status === 'ahead') return '稍快'
  if (match.status === 'behind') return '稍慢'
  if (match.status === 'mismatch') return '差异较大'
  return '同步'
}

const STATUS_DOT: Readonly<Record<RoutineFeedbackTone, string>> = { neutral: 'bg-slate-400', info: 'bg-sky-300', success: 'bg-emerald-300', warning: 'bg-amber-300' }

/**
 * 功法实时跟练 (Web V1.1, C2): the dark immersive shell, the standard demonstration and the user's own camera side by
 * side (stacked on portrait screens), one coaching line under the camera, the chapter rail, and the secondary live
 * data in 详细数据. Recognition, matching, technique checks, the course state machine and the saved record are the
 * runtime's and unchanged.
 */
export function RoutineTrainingPage({ program, scope }: { program: RoutineProgram; scope: RoutineScope }) {
  const runtime = useRoutineRuntime(program, scope)
  const demoMedia = useMatchedMediaHeight<HTMLDivElement>()
  const arrangement = useMediaArrangement()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const demo = useMemo(() => resolveRoutineDemo(program, configuredPresenter()), [program])
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
  const measured = following && runtime.match && runtime.match.status !== 'insufficient' ? runtime.match : undefined
  const highlight = following ? highlightRegion(runtime.feedback) : undefined
  // Side by side, the camera box takes the demonstration's height; stacked, it takes the remaining screen height.
  const stageStyle: CSSProperties | undefined = arrangement === 'side-by-side'
    ? demoMedia.height ? { height: demoMedia.height } : { aspectRatio: '16 / 9' }
    : undefined
  return (
    <ImmersiveShell
      testId="routine-training-shell"
      topBar={(
        <ImmersiveTopBar
          exit={<TrainingExitControl tone="dark" href={routinePath(program.id)} label={`返回${program.title}`} phase={routineExitPhase({ sessionStatus: runtime.sessionStatus, courseState: courseSnapshot.state })} />}
          title={heading}
          subtitle={scope.kind === 'full' ? `第 ${runtime.chapterIndex + 1} / ${runtime.chapters.length} 段 · ${chapterDisplayName(chapter)}` : `${program.subtitle} · 单独练习`}
          status={(
            <p className="imm-status max-sm:hidden" data-testid="routine-state" data-course-state={courseSnapshot.state} data-session-status={runtime.sessionStatus}>
              <i className={cn('size-2 rounded-full', STATUS_DOT[coach.tone])} aria-hidden="true" />{stateText(runtime)}
            </p>
          )}
          actions={(
            <>
              <AICoach context={{ page: 'training', live: runtime.coachContext, guide: routineGuide(program, chapter) }} variant="inline" />
              <DetailsToggle open={detailsOpen} onOpenChange={setDetailsOpen} />
            </>
          )}
        />
      )}
    >
      <div
        className="imm-media"
        style={routineColumns(demo.contentAspect)}
        data-testid="routine-training-layout"
        data-layout="immersive"
        data-arrangement={arrangement}
        data-routine={program.id}
      >
        <div className="min-w-0" data-layout-region="demonstration">
          <DemoStage
            program={program}
            demo={demo}
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
        </div>
        <div className="min-w-0" data-layout-region="camera">
          <ImmersiveCameraPanel
            stageStyle={stageStyle}
            course={courseSnapshot}
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
            highlight={highlight}
            headerExtra={measured ? (
              <span className="imm-chip tabular-nums" data-testid="routine-hud" data-match-status={measured.status}>
                相似度 <b className="text-white">{Math.round(measured.similarity * 100)}%</b><span className="imm-hide-sm text-slate-400">· 节奏{rhythmShort(measured)}</span>
              </span>
            ) : null}
            guidance={<CoachToast message={coach.message} tone={coach.tone} detail={highlight ? '已在你的画面上标出需要调整的部位' : undefined} label={coach.tone === 'warning' ? '需要调整' : undefined} testId="routine-coach-toast" />}
            onStart={runtime.startCamera}
          />
        </div>
      </div>

      <div className="imm-rail-slot">
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

      <DetailsDrawer open={detailsOpen} onOpenChange={setDetailsOpen}>
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
        <RoutineChapterPoints program={program} chapter={chapter} />
        <section className="panel p-4" aria-label="入镜与识别状态">
          <RoutineCameraStatus cameraMode={runtime.cameraMode} framingAssist={runtime.framingAssist} poseUnavailable={runtime.poseUnavailable} paused={runtime.sessionStatus === 'paused'} />
        </section>
        {runtime.debug ? (
          <section className="panel p-4" aria-label="调试信息" data-testid="routine-debug">
            <dl className="grid gap-2 text-xs">
              {runtime.debugData.map((item) => <div key={item.label} className="flex min-w-0 justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"><dt className="text-slate-500">{item.label}</dt><dd className="truncate font-mono text-slate-800">{item.value}</dd></div>)}
            </dl>
          </section>
        ) : null}
      </DetailsDrawer>
      <RoutineCompleteDialog completion={runtime.completion} program={program} scope={scope} />
    </ImmersiveShell>
  )
}
