// Shared Phaser host: HiDPI canvas sized to its parent, resize handling, clean teardown.
// Reused by every game scene (Apple now; Boating / Archery later).
import * as Phaser from 'phaser'
import { FLAGS } from './flags'

export interface PhaserHost {
  game: Phaser.Game
  dpr: number
  destroy(): void
}

/**
 * `key` must equal the scene's own constructor key: Phaser 3.90 stores pre-boot scene data under the
 * key given to scene.add() but looks it up under the scene's own key, so a mismatch silently drops it.
 */
export function createPhaserHost(parent: HTMLElement, key: string, scene: Phaser.Types.Scenes.SceneType, data: object): PhaserHost {
  // Cap the pixel ratio: pose inference shares the machine, so visual cost stays bounded.
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const size = () => ({ w: Math.max(320, parent.clientWidth), h: Math.max(240, parent.clientHeight) })
  const { w, h } = size()
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#a8dcf2',
    banner: false,
    audio: { noAudio: true },
    disableContextMenu: true,
    render: { antialias: true, powerPreference: 'high-performance' },
    scale: { mode: Phaser.Scale.NONE, width: Math.round(w * dpr), height: Math.round(h * dpr), zoom: 1 / dpr },
    // Uncapped by default: Phaser's limiter skips whole vsync frames (e.g. ~48 fps on a 144 Hz
    // display). ?fpsLimit=N exists for performance comparisons.
    // smoothStep off (Round 1): Phaser's delta averaging fed tweens an average delta while frames
    // actually arrived unevenly, so animations drifted against real time; with inference off the main
    // thread, frames are even and the true delta keeps every tween in step with the clock.
    fps: { smoothStep: false, limit: FLAGS.fpsLimit ?? 0 },
  })
  game.scene.add(key, scene, true, data)
  // Test / debug hook (read-only, like window.__mgl): lets automated checks inspect textures and scene state.
  ;(window as unknown as { __mglGame?: Phaser.Game }).__mglGame = game
  const observer = new ResizeObserver(() => {
    const next = size()
    game.scale.resize(Math.round(next.w * dpr), Math.round(next.h * dpr))
    game.scale.setZoom(1 / dpr)
  })
  observer.observe(parent)
  return {
    game,
    dpr,
    destroy() {
      observer.disconnect()
      game.destroy(true)
    },
  }
}

/** (Re)create a canvas texture painted with Canvas 2D. */
export function paintTexture(scene: Phaser.Scene, key: string, width: number, height: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
  if (scene.textures.exists(key)) scene.textures.remove(key)
  const texture = scene.textures.createCanvas(key, Math.max(1, Math.round(width)), Math.max(1, Math.round(height)))
  if (!texture) return
  paint(texture.getContext(), texture.width, texture.height)
  texture.refresh()
}

export const FONT_FAMILY = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", system-ui, sans-serif'
