import { useEffect, useState } from 'react'
import { ME_PATH } from '../../app/routes'
import { resolveCoachDecisionMode } from '../../app/coachDecisionConfig'
import { StatusPill, WebShell } from '../../components/web/WebShell'
import { motionGamesBaseUrl } from '../../features/web/games'

type Permission = 'granted' | 'denied' | 'prompt' | 'unknown' | 'checking'

const PERMISSION_TEXT: Readonly<Record<Permission, string>> = {
  checking: '正在查询…',
  granted: '浏览器已允许',
  prompt: '尚未授权（训练准备页才会请求）',
  denied: '已拒绝（请在浏览器网站设置中允许）',
  unknown: '浏览器不提供状态',
}

function usePermission(name: string): Permission {
  const [state, setState] = useState<Permission>('checking')
  useEffect(() => {
    let alive = true
    const query = navigator.permissions?.query
    if (!query) { setState('unknown'); return }
    navigator.permissions.query({ name: name as PermissionName })
      .then((status) => { if (alive) setState(status.state === 'granted' || status.state === 'denied' || status.state === 'prompt' ? status.state : 'unknown') })
      .catch(() => { if (alive) setState('unknown') })
    return () => { alive = false }
  }, [name])
  return state
}

/** 我的 → 设备与设置: real device / data status only. Nothing here changes training data. */
export function SettingsPage() {
  const camera = usePermission('camera')
  const speech = typeof window !== 'undefined' && 'speechSynthesis' in window
  const mode = resolveCoachDecisionMode()
  return (
    <WebShell active="me" testId="web-settings">
      <div className="page-head"><div><div className="eyebrow">SETTINGS</div><h1 style={{ marginTop: 10 }}>设备与设置</h1><p>摄像头、语音、数据和隐私。</p></div><a className="btn btn-secondary" href={ME_PATH}>返回我的 →</a></div>
      <section className="me-grid">
        <div className="panel glass card" id="camera">
          <div className="panel-title"><div><h3>摄像头与语音</h3><p>只在训练准备页开启摄像头</p></div></div>
          <div className="fpw-setting-row" data-testid="settings-camera">摄像头权限<span>{PERMISSION_TEXT[camera]}</span></div>
          <div className="fpw-setting-row">姿态识别<span>MediaPipe Pose Landmarker · 浏览器本地运行</span></div>
          <div className="fpw-setting-row">语音提示<span>{speech ? '浏览器支持本地语音合成 · 在训练页开关' : '此浏览器不支持语音合成'}</span></div>
          <div className="fpw-setting-row">站位建议<span>距屏幕 2.5–3 米，头到脚完整入镜，光线充足</span></div>
        </div>
        <div className="panel glass card" id="privacy">
          <div className="panel-title"><div><h3>数据与隐私</h3><p>训练数据只保存在此浏览器</p></div><StatusPill tone="mint">不上传</StatusPill></div>
          <div className="fpw-setting-row">训练记录<span>浏览器本地存储（localStorage），不上传、不同步</span></div>
          <div className="fpw-setting-row">摄像头画面<span>只用于本次实时识别，不录制、不上传</span></div>
          <div className="fpw-setting-row">AI Coach 画像<span>只保存在页面内存，离开页面即清除</span></div>
          <div className="fpw-setting-row" data-testid="settings-model">AI Coach 决策模型<span>{mode === 'shadow' ? 'SHADOW（开发验收：后台运行，界面仍为规则推荐）' : '默认关闭（规则推荐）'} · 实验性模型，AI 标注训练，未经人工验证</span></div>
          <div className="fpw-setting-row">体感游戏<span>独立应用 {motionGamesBaseUrl()} · 成绩不写入训练记录</span></div>
        </div>
      </section>
      <div className="notice" style={{ marginTop: 20 }}>FormPilot 提供运动练习建议，不做诊断，不替代医生或康复治疗师。出现疼痛、眩晕等不适请立即停止训练。</div>
    </WebShell>
  )
}
