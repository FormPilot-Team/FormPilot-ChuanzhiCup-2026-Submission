// Creates the one camera/model pipeline the app uses (or the synthetic player in tests).
// The UI keeps a single MotionSession from "打开摄像头" until the player returns to the Game Hub.
import { MotionAdapter } from './MotionAdapter'
import { CameraPoseSource, type PoseSource } from './poseSource'
import { SyntheticPoseSource, type BotKind, type DirectorContext } from './synthetic'

export interface MotionSession {
  adapter: MotionAdapter
  source: PoseSource
  synthetic: SyntheticPoseSource | null
  dispose(): void
}

/** What a synthetic player may observe through the adapter (prompts, targets, detector states). */
export function directorContext(adapter: MotionAdapter): DirectorContext {
  return {
    calibration: () => adapter.calibration(),
    targets: () => adapter.getTargets(),
    strokes: () => adapter.strokeState(),
    draw: () => adapter.drawState(),
  }
}

export async function startMotionSession(options: { synthetic: boolean; bot?: BotKind; missEvery?: number | null; delegate?: 'GPU' | 'CPU' | null }): Promise<MotionSession> {
  const synthetic = options.synthetic ? new SyntheticPoseSource({ seed: 7 }) : null
  if (synthetic && options.bot) synthetic.useBot(options.bot)
  if (synthetic && options.missEvery) synthetic.bot.missEvery = options.missEvery
  const source: PoseSource = synthetic ?? new CameraPoseSource({ delegate: options.delegate ?? undefined })
  const adapter = new MotionAdapter(source)
  synthetic?.attach(directorContext(adapter))
  await adapter.start()
  let disposed = false
  return {
    adapter,
    source,
    synthetic,
    dispose() {
      if (disposed) return
      disposed = true
      adapter.stop()
    },
  }
}
