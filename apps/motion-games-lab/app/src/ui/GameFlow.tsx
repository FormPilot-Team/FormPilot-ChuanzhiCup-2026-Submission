// 进入游戏 → 游戏说明 → 站位提示 → 摄像头识别(+校准) → 准备倒计时 3/2/1 → 开始 → 结果. Same for all games.
// One MotionSession (camera + model) lives from "打开摄像头" until the player leaves the game.
import { useCallback, useEffect, useRef, useState } from 'react'
import { REGISTRY } from '../games/registry'
import type { CalibrationProfile } from '../motion/contracts'
import { PoseSourceError } from '../motion/poseSource'
import { startMotionSession, type MotionSession } from '../motion/session'
import { sfx } from '../shared/audio'
import { FLAGS } from '../shared/flags'
import type { GameId, GameResult } from '../shared/metrics'
import { perf } from '../shared/perf'
import { addPlayedMs, playedThisSessionMs, type Settings } from '../shared/settings'
import { CameraStep } from './CameraStep'
import { DebugPanel } from './DebugPanel'
import type { AnyController } from './GamePlay'
import { ResultScreen } from './ResultScreen'
import { IntroStep, PositioningStep, Stepper } from './Steps'

type Step = 'intro' | 'positioning' | 'camera' | 'play' | 'result'
const STEP_INDEX: Record<Step, number> = { intro: 0, positioning: 1, camera: 2, play: 3, result: 4 }
const REST_LOCK_MS = 60_000

export function GameFlow({ gameId, settings, onSettings, onHub }: { gameId: GameId; settings: Settings; onSettings: (s: Settings) => void; onHub: () => void }) {
  const game = REGISTRY[gameId]
  const [step, setStep] = useState<Step>('intro')
  const [session, setSession] = useState<MotionSession | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<{ message: string; guidance: string } | null>(null)
  const [profile, setProfile] = useState<CalibrationProfile | null>(null)
  const [result, setResult] = useState<GameResult | null>(null)
  const [restLockMs, setRestLockMs] = useState(0)
  const [playKey, setPlayKey] = useState(0)
  const [controller, setController] = useState<AnyController | null>(null)
  const sessionRef = useRef<MotionSession | null>(null)

  const stopSession = useCallback(() => {
    sessionRef.current?.dispose()
    sessionRef.current = null
    setSession(null)
  }, [])

  useEffect(() => () => sessionRef.current?.dispose(), [])

  useEffect(() => {
    sfx.setMuted(!settings.sound)
  }, [settings.sound])

  // Test / debug hook (read-only handles; no UI depends on it).
  useEffect(() => {
    ;(window as unknown as { __mgl?: unknown }).__mgl = {
      game: gameId, step, session, controller, perf, flags: FLAGS,
      diagnostics: () => session?.adapter.diagnostics() ?? null,
      synthetic: session?.synthetic ?? null,
    }
  }, [gameId, step, session, controller])

  const openCamera = useCallback(async () => {
    sfx.unlock()
    setStep('camera')
    if (sessionRef.current) return
    setError(null)
    setStarting(true)
    try {
      const next = await startMotionSession({ synthetic: FLAGS.synthetic, bot: game.bot, missEvery: FLAGS.missEvery, delegate: FLAGS.delegate, inference: FLAGS.inference })
      sessionRef.current = next
      setSession(next)
    } catch (e) {
      setError(e instanceof PoseSourceError ? e.presentation : { message: '摄像头没有打开。', guidance: '请检查摄像头连接后点“重新检测”。' })
    } finally {
      setStarting(false)
    }
  }, [game.bot])

  const exit = useCallback(() => {
    stopSession()
    onHub()
  }, [onHub, stopSession])

  const onReady = useCallback((p: CalibrationProfile | null) => {
    setProfile(p)
    setStep('play')
  }, [])

  const onEnd = useCallback((r: GameResult) => {
    addPlayedMs(r.activeMs)
    setRestLockMs(playedThisSessionMs() >= settings.sessionCapMinutes * 60_000 ? REST_LOCK_MS : 0)
    setResult(r)
    setStep('result')
  }, [settings.sessionCapMinutes])

  const replay = useCallback(() => {
    sfx.unlock()
    setResult(null)
    setPlayKey((k) => k + 1)
    setStep('play')
  }, [])

  const Play = game.Play
  const durationMs = (FLAGS.durationSeconds ?? settings.roundSeconds) * 1000
  return (
    <div className={`stage stage-${gameId}`}>
      {step !== 'play' && step !== 'result' && <Stepper index={STEP_INDEX[step]} />}
      {step === 'intro' && <IntroStep game={game} settings={settings} onChange={onSettings} onNext={() => setStep('positioning')} onBack={exit} />}
      {step === 'positioning' && <PositioningStep seated={settings.seated} onNext={() => void openCamera()} onBack={() => setStep('intro')} />}
      {step === 'camera' && (
        <CameraStep
          session={session}
          starting={starting}
          error={error}
          seated={settings.seated}
          gameId={gameId}
          onRetry={() => {
            stopSession()
            void openCamera()
          }}
          onBack={() => {
            stopSession()
            setStep('positioning')
          }}
          onReady={onReady}
        />
      )}
      {step === 'play' && session && (
        <Play
          key={playKey}
          session={session}
          profile={profile}
          settings={settings}
          durationMs={durationMs}
          onEnd={onEnd}
          onRestart={replay}
          onExit={exit}
          onController={setController}
        />
      )}
      {step === 'result' && result && <ResultScreen result={result} restLockMs={restLockMs} onReplay={replay} onHub={exit} />}
      {FLAGS.debug && <DebugPanel session={session} controller={controller} />}
    </div>
  )
}
