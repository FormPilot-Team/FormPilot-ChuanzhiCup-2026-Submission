import { useState } from 'react'
import { MonitorCog, RotateCcw, SearchCheck } from 'lucide-react'
import { cameraFailureRows, checkCameraDevices, deviceCheckLines, type CameraDeviceCheck, type CameraFailureReport } from '../../features/camera/cameraDiagnostics'
import { isDesktopApp, logDiagnostics, openCameraPrivacySettings } from '../../features/diagnostics/desktopBridge'
import { DiagnosticsDetails } from '../diagnostics/DiagnosticsDetails'

interface CameraFailureNoticeProps {
  failure: CameraFailureReport
  onRetry: () => void
}

/** Why the camera could not start, what to do about it, and — folded away — the diagnostics behind it. */
export function CameraFailureNotice({ failure, onRetry }: CameraFailureNoticeProps) {
  const [check, setCheck] = useState<CameraDeviceCheck | 'running'>()
  const model = failure.stage === 'model'

  const runCheck = async () => {
    setCheck('running')
    const result = await checkCameraDevices()
    setCheck(result)
    logDiagnostics('camera-check', { videoInputs: result.videoInputs, labelsAvailable: result.labelsAvailable, permission: result.permission, windowsCamera: result.system ? { verdict: result.system.verdict, blockedBy: result.system.blockedBy } : null })
  }

  return (
    <div className="mx-auto w-full max-w-md" data-testid="camera-failure" data-camera-failure={failure.kind} data-failure-complete={failure.complete ? 'true' : 'false'}>
      <p className="text-pretty text-sm font-semibold text-coral-600">{failure.message}</p>
      <p className="mt-1 text-pretty text-sm text-slate-600">{failure.guidance}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onRetry} className="primary-button inline-flex items-center gap-1.5"><RotateCcw size={16} aria-hidden="true" />{model ? '重新尝试' : '重新检测'}</button>
        {!model && failure.windowsPrivacy && isDesktopApp() ? (
          <button type="button" onClick={() => void openCameraPrivacySettings()} className="secondary-button inline-flex items-center gap-1.5"><MonitorCog size={16} aria-hidden="true" />打开 Windows 相机设置</button>
        ) : null}
        {!model ? (
          <button type="button" onClick={() => void runCheck()} disabled={check === 'running'} className="secondary-button inline-flex items-center gap-1.5 disabled:opacity-60"><SearchCheck size={16} aria-hidden="true" />检查设备</button>
        ) : null}
      </div>
      {check ? (
        <div className="mt-3 rounded-xl bg-white p-3 text-left text-sm ring-1 ring-slate-200" role="status" data-testid="camera-device-check">
          {check === 'running' ? <p className="text-slate-500">正在检查…</p> : (
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
              {deviceCheckLines(check).map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-slate-500">{row.label}</dt>
                  <dd className="font-semibold text-slate-800">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ) : null}
      <DiagnosticsDetails
        className="mt-3"
        title={model ? 'FormPilot 姿态识别诊断' : 'FormPilot 摄像头诊断'}
        rows={failure.complete ? cameraFailureRows(failure) : null}
        testId="camera-diagnostics"
      />
    </div>
  )
}
