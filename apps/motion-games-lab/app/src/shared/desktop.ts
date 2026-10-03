// Desktop (Tauri) integration that is also safe in a plain browser:
//   - IS_DESKTOP: running inside the 体感游戏工坊 desktop shell
//   - full screen: the Tauri window API on the desktop (the whole window, no WebView edges), the HTML
//     Fullscreen API in a browser; F11 toggles, Esc leaves full screen (and only that — while in full
//     screen Esc does not also pause a game)
//   - Ctrl+Shift+D: reload with / without ?debug=1 (the desktop has no address bar). The developer
//     panel stays hidden by default.
import { useEffect, useState } from 'react'

export const IS_DESKTOP = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

let fullscreen = false
const listeners = new Set<(on: boolean) => void>()

function update(on: boolean): void {
  if (on === fullscreen) return
  fullscreen = on
  for (const listener of listeners) listener(on)
}

async function desktopWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

export async function setFullscreen(on: boolean): Promise<void> {
  try {
    if (IS_DESKTOP) {
      const win = await desktopWindow()
      await win.setFullscreen(on)
      update(await win.isFullscreen())
    } else if (on) {
      await document.documentElement.requestFullscreen()
    } else if (document.fullscreenElement) {
      await document.exitFullscreen()
    }
  } catch {
    // full screen refused (e.g. no user gesture in a browser): stay windowed
  }
}

export function toggleFullscreen(): Promise<void> {
  return setFullscreen(!fullscreen)
}

export function useFullscreen(): boolean {
  const [on, setOn] = useState(fullscreen)
  useEffect(() => {
    listeners.add(setOn)
    setOn(fullscreen)
    return () => {
      listeners.delete(setOn)
    }
  }, [])
  return on
}

let installed = false

/** Keyboard shortcuts and full-screen tracking; call once at start-up. */
export function installDesktopShortcuts(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  if (IS_DESKTOP) {
    void desktopWindow().then(async (win) => {
      update(await win.isFullscreen())
      await win.onResized(async () => update(await win.isFullscreen()))
    }).catch(() => undefined)
  } else {
    document.addEventListener('fullscreenchange', () => update(Boolean(document.fullscreenElement)))
  }
  // capture phase: runs before the game's own Esc = pause handler
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fullscreen) {
      e.preventDefault()
      e.stopImmediatePropagation()
      void setFullscreen(false)
    } else if (e.key === 'F11') {
      e.preventDefault()
      void toggleFullscreen()
    } else if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault()
      const url = new URL(location.href)
      if (url.searchParams.get('debug') === '1') url.searchParams.delete('debug')
      else url.searchParams.set('debug', '1')
      location.replace(url.href)
    }
  }, true)
}
