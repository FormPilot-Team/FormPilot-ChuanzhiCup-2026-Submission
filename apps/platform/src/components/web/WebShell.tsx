import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { COACH_PATH, GAMES_PATH, HOME_PATH, ME_PATH, ME_SETTINGS_PATH, ROUTINES_PATH, TRAINING_CENTER_PATH, webBoardOf, type WebBoard } from '../../app/routes'
import { OnboardingDialog } from '../onboarding/OnboardingDialog'
import { recordOnboarding } from '../../features/onboarding/onboarding'

/** The six first-level boards, in the approved #52 order. Icons are the design's own glyphs. */
export const WEB_NAV: ReadonlyArray<{ id: WebBoard; label: string; icon: string; href: string }> = [
  { id: 'home', label: '首页', icon: '⌂', href: HOME_PATH },
  { id: 'training', label: '训练中心', icon: '✦', href: TRAINING_CENTER_PATH },
  { id: 'routines', label: '功法训练', icon: '◒', href: ROUTINES_PATH },
  { id: 'games', label: '游戏中心', icon: '◈', href: GAMES_PATH },
  { id: 'coach', label: 'AI Coach', icon: '✧', href: COACH_PATH },
  { id: 'me', label: '我的', icon: '●', href: ME_PATH },
]

function currentBoard(): WebBoard | undefined {
  if (typeof window === 'undefined') return undefined
  return webBoardOf(window.location.pathname, window.location.search)
}

type CameraPermission = 'granted' | 'denied' | 'prompt' | 'unknown'

async function queryCameraPermission(): Promise<CameraPermission> {
  try {
    if (!navigator.permissions?.query) return 'unknown'
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName })
    return status.state === 'granted' || status.state === 'denied' || status.state === 'prompt' ? status.state : 'unknown'
  } catch {
    return 'unknown'
  }
}

const CAMERA_TEXT: Readonly<Record<CameraPermission, string>> = {
  granted: '摄像头：浏览器已允许 · 只在训练准备页开启，画面不上传',
  prompt: '摄像头：尚未授权 · 进入训练准备页后才会请求',
  denied: '摄像头：已被浏览器拒绝 · 请在地址栏的网站设置中允许摄像头',
  unknown: '摄像头：此浏览器不提供权限状态 · 进入训练准备页后才会请求',
}

export function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((text: string) => {
    setMessage(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), 2600)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return { message, show }
}

export function WebToast({ message }: { message: string | null }) {
  return <div className={`toast${message ? ' show' : ''}`} role="status" aria-live="polite" data-testid="web-toast">{message ?? ''}</div>
}

const ICONS = {
  camera: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5h-5l-1.3 2H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.2L14.5 5Z" /><circle cx="12" cy="12.5" r="3.2" /></svg>,
  voice: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Z" /><path d="M16 9a5 5 0 0 1 0 6M18.5 6.5a8.5 8.5 0 0 1 0 11" /></svg>,
  help: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.4 2.4 0 1 1 3.8 1.9c-.9.6-1.5 1-1.5 2.1" /><path d="M12 16.5h.01" /></svg>,
  avatar: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" /><path d="M5.5 19.2a6.8 6.8 0 0 1 13 0" /></svg>,
}

/** Desktop top navigation of the #52 design. The global actions report real state only. */
export function WebTopbar({ active = currentBoard(), onToast }: { active?: WebBoard; onToast: (text: string) => void }) {
  const [guideOpen, setGuideOpen] = useState(false)
  return (
    <header className="topbar" data-testid="web-topbar">
      <a className="brand" href={HOME_PATH} aria-label="FormPilot 首页">
        <div className="brand-mark" aria-hidden="true">F</div>
        <div><div className="brand-name">FormPilot</div><span className="brand-sub">motion intelligence</span></div>
      </a>
      <nav className="nav" aria-label="主导航">
        {WEB_NAV.map((item) => (
          <a key={item.id} className={`nav-btn${active === item.id ? ' active' : ''}`} href={item.href} aria-current={active === item.id ? 'page' : undefined} data-testid={`web-nav-${item.id}`}>{item.label}</a>
        ))}
      </nav>
      <div className="global-actions">
        <button className="icon-btn" type="button" aria-label="摄像头状态" title="摄像头状态" onClick={() => { void queryCameraPermission().then((state) => onToast(CAMERA_TEXT[state])) }} data-testid="web-camera-status">{ICONS.camera}</button>
        <button className="icon-btn" type="button" aria-label="语音提示" title="语音提示" onClick={() => onToast('语音提示：在训练页右上角开关，使用浏览器本地语音合成')}>{ICONS.voice}</button>
        <button className="icon-btn" type="button" aria-label="帮助" title="使用说明" onClick={() => setGuideOpen(true)} data-testid="web-help">{ICONS.help}</button>
        <a className="avatar" href={ME_SETTINGS_PATH} aria-label="我的设置" title="设备与设置">{ICONS.avatar}</a>
      </div>
      <OnboardingDialog open={guideOpen} onClose={(outcome) => { recordOnboarding(outcome); setGuideOpen(false) }} />
    </header>
  )
}

/** Phone / small tablet navigation (≤ 820 px), same six boards and order. */
export function WebBottomTabs({ active = currentBoard() }: { active?: WebBoard }) {
  return (
    <nav className="bottom-tabs" aria-label="底部导航" data-testid="web-bottom-tabs">
      {WEB_NAV.map((item) => (
        <a key={item.id} className={`bottom-tab${active === item.id ? ' active' : ''}`} href={item.href} aria-current={active === item.id ? 'page' : undefined}><span aria-hidden="true">{item.icon}</span>{item.label}</a>
      ))}
    </nav>
  )
}

interface WebShellProps {
  children: ReactNode
  active?: WebBoard
  /** Extra class on the `.page` container. */
  pageClassName?: string
  /** Render children directly in `<main>` (the home hero is full width, without the `.page` container). */
  bare?: boolean
  testId?: string
}

/** AppShell of the six Web V1 boards: design topbar, the page, mobile bottom tabs and the shared toast. */
export function WebShell({ children, active, pageClassName, bare = false, testId }: WebShellProps) {
  const toast = useToast()
  return (
    <div className="fpw">
      <div className="app-shell">
        <WebTopbar active={active} onToast={toast.show} />
        <main data-testid={bare ? testId : undefined}>{bare ? children : <div className={`page${pageClassName ? ` ${pageClassName}` : ''}`} data-testid={testId}>{children}</div>}</main>
        <WebBottomTabs active={active} />
      </div>
      <WebToast message={toast.message} />
    </div>
  )
}

/** The design's status pill. */
export function StatusPill({ tone = 'blue', children, testId }: { tone?: 'blue' | 'mint' | 'coral'; children: ReactNode; testId?: string }) {
  return <span className={`status-pill ${tone}`} data-testid={testId}>{children}</span>
}

/** Design `.empty` block for first use and missing data. */
export function WebEmpty({ mark = '◌', title, children, action, testId }: { mark?: string; title: string; children?: ReactNode; action?: ReactNode; testId?: string }) {
  return (
    <div className="empty" data-testid={testId}>
      <div className="empty-mark" aria-hidden="true">{mark}</div>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  )
}
