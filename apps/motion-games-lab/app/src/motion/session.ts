// Creates the one camera/model pipeline the app uses (or the synthetic player in tests).
// The UI keeps a single MotionSession from "打开摄像头" until the player returns to the Game Hub.
import { MotionAdapter } from './MotionAdapter'
import { CameraPoseSource, type PoseSource } from './poseSource'
import { SyntheticPoseSource } from './synthetic'

export interface MotionSession {
  adapter: MotionAdapter
  source: PoseSource
  synthetic: SyntheticPoseSource | null
  dispose(): void
}

export async function startMotionSession(options: { synthetic: boolean; missEvery?: number | null; delegate?: 'GPU' | 'CPU' | null }): Promise<MotionSession> {
  const synthetic = options.synthetic ? new SyntheticPoseSource({ seed: 7 }) : null
  if (synthetic && options.missEvery) synthetic.bot.missEvery = options.missEvery
  const source: PoseSource = synthetic ?? new CameraPoseSource({ delegate: options.delegate ?? undefined })
  const adapter = new MotionAdapter(source)
  synthetic?.attach({ calibration: () => adapter.calibration(), targets: () => adapter.getTargets() })
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
