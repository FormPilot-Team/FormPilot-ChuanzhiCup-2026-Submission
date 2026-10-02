import { useEffect } from 'react'
import { ROUND_OPTIONS, SESSION_CAP_OPTIONS, type Settings } from '../shared/settings'

export function SettingsDialog({ settings, onChange, onClose }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })
  return (
    <div className="dialog-back" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="设置" onClick={(e) => e.stopPropagation()}>
        <h2>设置</h2>
        <div className="field">
          <div className="option-label">每局时长</div>
          <div className="seg">
            {ROUND_OPTIONS.map((s) => (
              <button key={s} aria-pressed={settings.roundSeconds === s} onClick={() => set({ roundSeconds: s })}>{s / 60} 分钟</button>
            ))}
          </div>
        </div>
        <div className="field">
          <div className="option-label">建议休息前的总时长（本次打开期间）</div>
          <div className="seg">
            {SESSION_CAP_OPTIONS.map((m) => (
              <button key={m} aria-pressed={settings.sessionCapMinutes === m} onClick={() => set({ sessionCapMinutes: m })}>{m} 分钟</button>
            ))}
          </div>
        </div>
        <div className="field">
          <div className="option-label">局中休息提醒</div>
          <div className="seg">
            {[0, 60, 90, 120].map((s) => (
              <button key={s} aria-pressed={settings.restReminderSeconds === s} onClick={() => set({ restReminderSeconds: s })}>{s === 0 ? '关闭' : `${s} 秒后`}</button>
            ))}
          </div>
        </div>
        <label className="toggle-row">声音<input type="checkbox" checked={settings.sound} onChange={(e) => set({ sound: e.target.checked })} /></label>
        <label className="toggle-row">游戏中显示镜像小窗<input type="checkbox" checked={settings.showMirror} onChange={(e) => set({ showMirror: e.target.checked })} /></label>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onClose}>完成</button>
      </div>
    </div>
  )
}
