export interface CameraAdapter {
  start(video: HTMLVideoElement): Promise<MediaStream>
  stop(video?: HTMLVideoElement): void
}

export type CameraFailureKind = 'permission_denied' | 'device_unavailable' | 'constraint_failed' | 'unknown_error' | 'model_error'

export interface CameraErrorPresentation {
  kind: Exclude<CameraFailureKind, 'model_error'>
  message: string
}

export function cameraErrorPresentation(error: unknown): CameraErrorPresentation {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return { kind: 'permission_denied', message: '未获得摄像头权限，请允许访问摄像头后重试。' }
  if (name === 'NotFoundError') return { kind: 'device_unavailable', message: '未检测到可用摄像头，请连接设备后重试。' }
  if (name === 'NotReadableError') return { kind: 'device_unavailable', message: '摄像头暂时无法使用，请关闭其他占用摄像头的应用后重试。' }
  if (name === 'OverconstrainedError') return { kind: 'constraint_failed', message: '当前摄像头不支持推荐的视频参数，请尝试重新连接摄像头。' }
  return { kind: 'unknown_error', message: '无法启动摄像头，请检查设备连接后重试。' }
}

export class BrowserCameraAdapter implements CameraAdapter {
  private stream?: MediaStream

  async start(video: HTMLVideoElement): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持摄像头访问')
    this.stop()
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, min: 20 },
        },
        audio: false,
      })
    } catch (error) {
      const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
      if (name !== 'OverconstrainedError') throw error
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    }
    video.srcObject = this.stream
    await video.play()
    return this.stream
  }

  stop(video?: HTMLVideoElement): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = undefined
    if (video) video.srcObject = null
  }
}
