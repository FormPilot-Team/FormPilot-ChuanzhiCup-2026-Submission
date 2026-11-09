import { WebBottomTabs, WebToast, WebTopbar, useToast } from '../web/WebShell'

/**
 * Header of the existing feature pages (training, routine detail, report, history, 动作工坊). Since Web V1 it is the
 * #52 design topbar with the six boards, so every page shares one navigation. Immersive training pages pass
 * `immersive`, which keeps the topbar but leaves out the phone bottom tabs so they never cover training controls.
 */
export function AppHeader({ immersive = false }: { immersive?: boolean }) {
  const toast = useToast()
  return (
    <div className="fpw fpw-bar" data-testid="app-header">
      <WebTopbar onToast={toast.show} />
      {immersive ? null : <WebBottomTabs />}
      <WebToast message={toast.message} />
    </div>
  )
}
