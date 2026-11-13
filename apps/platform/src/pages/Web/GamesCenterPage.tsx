import { useEffect, useRef, useState } from 'react'
import { WebShell } from '../../components/web/WebShell'
import { WEB_GAMES, findWebGame, motionGameUrl, motionGamesBaseUrl, probeMotionGames, type GameServiceStatus, type WebGame } from '../../features/web/games'

type LaunchState = 'idle' | 'opened' | 'blocked'

/**
 * 游戏中心: the #52 game page (three equal-height cards) rendered natively instead of in an iframe.
 * "开始" opens the design's preparation dialog; from there the real Motion Games Lab game opens in its own window.
 * When that app does not answer, the dialog says the game is not connected and offers only the way back.
 */
export function GamesCenterPage({ probe = probeMotionGames }: { probe?: () => Promise<Exclude<GameServiceStatus, 'checking'>> }) {
  const [service, setService] = useState<GameServiceStatus>('checking')
  // AI Coach links to /games?game=<id>: open that game's preparation dialog directly.
  const [selected, setSelected] = useState<WebGame | null>(() => (typeof window === 'undefined' ? null : findWebGame(new URLSearchParams(window.location.search).get('game')) ?? null))
  const [launch, setLaunch] = useState<LaunchState>('idle')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const settingsRef = useRef<HTMLDialogElement>(null)
  const childRef = useRef<Window | null>(null)

  const recheck = () => { setService('checking'); void probe().then(setService) }
  useEffect(() => { let alive = true; void probe().then((status) => { if (alive) setService(status) }); return () => { alive = false } }, [probe])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (selected && !dialog.open) dialog.showModal?.()
    if (!selected && dialog.open) dialog.close()
  }, [selected])
  useEffect(() => {
    const dialog = settingsRef.current
    if (!dialog) return
    if (settingsOpen && !dialog.open) dialog.showModal?.()
    if (!settingsOpen && dialog.open) dialog.close()
  }, [settingsOpen])

  // When the game window closes, the dialog goes back to its idle state ("返回游戏中心").
  useEffect(() => {
    if (launch !== 'opened') return
    const timer = setInterval(() => { if (childRef.current?.closed) { childRef.current = null; setLaunch('idle'); setSelected(null) } }, 800)
    return () => clearInterval(timer)
  }, [launch])

  const open = (game: WebGame) => { setLaunch('idle'); setSelected(game) }
  const close = () => { setSelected(null); setLaunch('idle') }
  const start = () => {
    if (!selected) return
    const child = window.open(motionGameUrl(selected.id), `formpilot-game-${selected.id}`)
    if (!child) { setLaunch('blocked'); return }
    childRef.current = child
    setLaunch('opened')
  }

  const fullscreen = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
      else await document.exitFullscreen()
    } catch { /* some browsers refuse fullscreen; keep the page as it is */ }
  }

  return (
    <WebShell active="games" pageClassName="games-page" testId="web-games">
      <div className="fpw-gc">
        <div className="gc-page">
          <header className="gc-topbar">
            <div className="gc-brand"><div className="gc-brand-copy"><h1>体感游戏</h1><p>跟着身体动起来的森林小游戏</p></div></div>
            <nav className="gc-tools" aria-label="页面工具">
              <button className="gc-tool-button" type="button" onClick={() => void fullscreen()} aria-label="切换全屏"><span className="gc-tool-icon" aria-hidden="true">⛶</span>全屏</button>
              <button className="gc-tool-button" type="button" onClick={() => setSettingsOpen(true)}><span className="gc-tool-icon" aria-hidden="true">⚙</span>设置</button>
            </nav>
          </header>

          <p className={`gc-service gc-service-${service}`} role="status" data-testid="games-service">
            {service === 'checking' ? '正在检查体感游戏服务…' : service === 'available' ? '体感游戏服务已连接 · 游戏在新窗口中运行，摄像头画面只在本机处理' : <>体感游戏服务未启动 · 游戏尚未接入当前环境<button type="button" className="gc-link" onClick={recheck}>重新检查</button></>}
          </p>

          <section className="gc-grid" aria-label="森林体感小游戏">
            {WEB_GAMES.map((game) => (
              <article key={game.id} className="gc-card" data-testid={`game-card-${game.id}`}>
                <img className="gc-art" src={game.image} alt={game.alt} />
                <div className="gc-content">
                  <h2>{game.title}</h2>
                  <p className="gc-action-line"><span className="gc-dot" aria-hidden="true">●</span><span>主要动作：{game.action}</span></p>
                  <p className="gc-description">{game.description}</p>
                  <button className="gc-start-button" type="button" onClick={() => open(game)} data-testid={`game-start-${game.id}`}>开始</button>
                </div>
              </article>
            ))}
          </section>

          <footer className="gc-page-foot">
            <div className="gc-safety-note"><span aria-hidden="true">⚠</span><span>动作慢一点，在舒服的范围内就好。感到不适请立即停止。游戏成绩只在游戏内显示，不计入正式训练数据。</span></div>
            <p className="gc-labels">Apple Picking · Boating · Archery</p>
          </footer>
        </div>

        <dialog ref={dialogRef} className="gc-dialog" aria-labelledby="game-dialog-title" onClose={close} onClick={(event) => { if (event.target === event.currentTarget) close() }} data-testid="game-dialog">
          {selected ? (
            <div className="gc-dialog-inner">
              <div className="gc-dialog-head"><div><p className="gc-dialog-kicker">体感游戏</p><h2 className="gc-dialog-title" id="game-dialog-title">{selected.title}</h2></div><button className="gc-dialog-close" type="button" aria-label="关闭" onClick={close}>×</button></div>
              <img className="gc-dialog-art" src={selected.image} alt="" />
              <p className="gc-dialog-copy">主要动作：{selected.action}。{selected.copy}</p>
              {launch === 'opened' ? (
                <>
                  <p className="gc-dialog-status" role="status" data-testid="game-running">游戏已在新窗口中运行。玩完后关闭该窗口，就会回到游戏中心。</p>
                  <button className="gc-start-button gc-dialog-action" type="button" onClick={() => { childRef.current?.focus() }}>切换到游戏窗口</button>
                  <button className="gc-secondary" type="button" onClick={close} data-testid="game-return">返回游戏中心</button>
                </>
              ) : service === 'available' ? (
                <>
                  {launch === 'blocked' ? <p className="gc-dialog-status" role="alert">浏览器拦截了新窗口。请允许本站弹出窗口，或<a href={motionGameUrl(selected.id)} target="_blank" rel="noopener">点击这里打开游戏</a>。</p> : null}
                  <button className="gc-start-button gc-dialog-action" type="button" onClick={start} data-testid="game-launch">开始游戏</button>
                  <button className="gc-secondary" type="button" onClick={close}>返回游戏中心</button>
                </>
              ) : (
                <>
                  <p className="gc-dialog-status" role="status" data-testid="game-unavailable">{service === 'checking' ? '正在检查体感游戏服务…' : `尚未接入：未连接到体感游戏服务（${motionGamesBaseUrl()}）。请先启动 Motion Games Lab，再重新检查。`}</p>
                  <button className="gc-start-button gc-dialog-action" type="button" onClick={recheck} disabled={service === 'checking'}>重新检查</button>
                  <button className="gc-secondary" type="button" onClick={close} data-testid="game-return">返回游戏中心</button>
                </>
              )}
            </div>
          ) : null}
        </dialog>

        <dialog ref={settingsRef} className="gc-dialog" aria-labelledby="game-settings-title" onClose={() => setSettingsOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}>
          <div className="gc-dialog-inner">
            <div className="gc-dialog-head"><div><p className="gc-dialog-kicker">偏好设置</p><h2 className="gc-dialog-title" id="game-settings-title">设置</h2></div><button className="gc-dialog-close" type="button" aria-label="关闭" onClick={() => setSettingsOpen(false)}>×</button></div>
            <p className="gc-dialog-copy">请在宽敞、安全的空间体验游戏，并根据自己的情况调整动作幅度。页面动效可通过系统的“减少动态效果”设置关闭。</p>
            <button className="gc-start-button gc-dialog-action" type="button" onClick={() => setSettingsOpen(false)}>完成</button>
          </div>
        </dialog>
      </div>
    </WebShell>
  )
}
