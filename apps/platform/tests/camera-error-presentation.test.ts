import { describe, expect, it } from 'vitest'
import { cameraErrorPresentation } from '../src/adapters/camera/BrowserCameraAdapter'

describe('camera error presentation', () => {
  it.each([
    ['NotAllowedError', 'permission_denied', '未获得摄像头权限'],
    ['NotFoundError', 'device_unavailable', '未检测到可用摄像头'],
    ['NotReadableError', 'device_unavailable', '摄像头暂时无法使用'],
    ['OverconstrainedError', 'constraint_failed', '不支持推荐的视频参数'],
    ['UnknownError', 'unknown_error', '无法启动摄像头'],
  ])('maps %s to user-facing Chinese', (name, kind, message) => {
    const presentation = cameraErrorPresentation({ name })
    expect(presentation.kind).toBe(kind)
    expect(presentation.message).toContain(message)
    expect(presentation.message).not.toContain(name)
  })
})
