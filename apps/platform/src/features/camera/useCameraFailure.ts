import { useCallback, useRef, useState } from 'react'
import { logDiagnostics } from '../diagnostics/desktopBridge'
import { cameraFailureLog, completeCameraFailure, initialCameraFailure, type CameraFailureReport } from './cameraDiagnostics'

/**
 * The camera / pose-model failure a training page shows: classified from the error at once, then completed with the
 * device check and Windows camera status (which can re-classify it) and written to the diagnostics log.
 */
export function useCameraFailure() {
  const [failure, setFailure] = useState<CameraFailureReport>()
  const tokenRef = useRef(0)

  const clear = useCallback(() => {
    tokenRef.current += 1
    setFailure(undefined)
  }, [])

  const report = useCallback((error: unknown, stage: 'camera' | 'model') => {
    const token = ++tokenRef.current
    setFailure(initialCameraFailure(error, stage))
    void completeCameraFailure(error, stage).then((complete) => {
      // Every failure is logged, even one the reviewer already retried; only the current one stays on screen.
      logDiagnostics(stage === 'model' ? 'model-error' : 'camera-error', cameraFailureLog(complete))
      if (token === tokenRef.current) setFailure(complete)
    })
  }, [])

  return { failure, report, clear }
}
