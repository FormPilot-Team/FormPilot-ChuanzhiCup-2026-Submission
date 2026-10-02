// ?debug=1 only: the player's body drawn on the playfield (light figure, skeleton, landmarks).
// The formal game never shows a body outline — it uses the two hand cursors instead.
import type * as Phaser from 'phaser'
import type { MotionFrame, Point } from '../../motion/contracts'

export function drawDebugBody(g: Phaser.GameObjects.Graphics, f: MotionFrame | null, toScreen: (p: Point) => Point, unit: number, dpr: number): void {
  g.clear()
  if (!f?.tracking.body || !f.leftShoulder || !f.rightShoulder) return
  const ls = toScreen(f.leftShoulder)
  const rs = toScreen(f.rightShoulder)
  const hipL = toScreen({ x: f.leftShoulder.x * 0.78, y: f.leftShoulder.y + 1 })
  const hipR = toScreen({ x: f.rightShoulder.x * 0.78, y: f.rightShoulder.y + 1 })
  // translucent figure ("描边") + skeleton lines
  g.lineStyle(Math.max(2, 0.025 * unit), 0xffffff, 0.35)
  g.fillStyle(0xffffff, 0.12)
  g.beginPath()
  g.moveTo(ls.x, ls.y)
  g.lineTo(rs.x, rs.y)
  g.lineTo(hipR.x, hipR.y)
  g.lineTo(hipL.x, hipL.y)
  g.closePath()
  g.fillPath()
  g.strokePath()
  g.fillStyle(0xffffff, 0.12)
  g.fillCircle((ls.x + rs.x) / 2, (ls.y + rs.y) / 2 - 0.55 * unit, 0.2 * unit)
  for (const side of ['left', 'right'] as const) {
    const shoulder = side === 'left' ? ls : rs
    const elbow = side === 'left' ? f.leftElbow : f.rightElbow
    const wrist = side === 'left' ? f.leftWrist : f.rightWrist
    const hand = side === 'left' ? f.leftHand : f.rightHand
    if (!f.tracking[side] || !elbow || !wrist) continue
    const e = toScreen(elbow)
    const w = toScreen(wrist)
    g.lineStyle(Math.max(3, 0.05 * unit), side === 'left' ? 0x2bb5a8 : 0xff9a3c, 0.7)
    g.beginPath()
    g.moveTo(shoulder.x, shoulder.y)
    g.lineTo(e.x, e.y)
    g.lineTo(w.x, w.y)
    g.strokePath()
    // landmarks: shoulder / elbow / wrist (magenta), palm-centre hit point (white ring)
    g.fillStyle(0xff00ff, 1)
    for (const p of [shoulder, e, w]) g.fillCircle(p.x, p.y, 5 * dpr)
    if (hand) {
      const h = toScreen(hand)
      g.lineStyle(2 * dpr, 0xffffff, 0.95)
      g.strokeCircle(h.x, h.y, 7 * dpr)
    }
  }
}
