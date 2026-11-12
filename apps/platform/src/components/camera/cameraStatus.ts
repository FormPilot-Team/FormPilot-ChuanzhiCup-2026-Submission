import type { CameraFailureKind } from '../../adapters/camera/BrowserCameraAdapter'

/** The short header status for each failure, instead of one "连接异常" for everything. */
export const FAILURE_STATUS: Readonly<Record<CameraFailureKind, string>> = {
  permission_denied: '摄像头权限未开启',
  not_found: '未检测到摄像头',
  in_use: '摄像头无法读取',
  constraint_failed: '摄像头参数不兼容',
  security: '摄像头被阻止',
  unsupported: '不支持摄像头',
  unknown_error: '摄像头无法启动',
  model_error: '识别模型加载失败',
}
