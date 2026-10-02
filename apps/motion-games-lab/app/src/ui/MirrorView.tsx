// Mirrored camera image with a light overlay, drawn in its own rAF loop (no per-frame React state).
// mode 'hands' (formal): only two small hand markers in the cursor colours — the same language as the
//   playfield cursors, no body outline.
// mode 'skeleton' (?debug=1): the full upper-body skeleton and landmarks.
import { useEffect, useRef } from 'react'
import type { MotionAdapterApi, SkeletonJoint } from '../motion/contracts'
import { mapNormalizedLandmarkToCanvas } from '../motion/vendor/fitMapping'
import { FLAGS } from '../shared/flags'

const BONES: [SkeletonJoint, SkeletonJoint, 'left' | 'right' | 'mid'][] = [
  ['leftShoulder', 'rightShoulder', 'mid'],
  ['leftShoulder', 'leftElbow', 'left'], ['leftElbow', 'leftWrist', 'left'],
  ['rightShoulder', 'rightElbow', 'right'], ['rightElbow', 'rightWrist', 'right'],
  ['leftShoulder', 'leftHip', 'mid'], ['rightShoulder', 'rightHip', 'mid'], ['leftHip', 'rightHip', 'mid'],
]
const COLOR = { left: '#2bb5a8', right: '#ff9a3c', mid: 'rgba(255,255,255,0.9)' }

export type MirrorMode = 'hands' | 'skeleton'

export function MirrorView({ adapter, stream, label, className, showVideo = true, mode = FLAGS.debug ? 'skeleton' : 'hands' }: {
  adapter: MotionAdapterApi
  stream: MediaStream | null
  label?: string
  className?: string
  showVideo?: boolean
  mode?: MirrorMode
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = showVideo ? stream : null
    if (stream && showVideo) void video.play().catch(() => undefined)
  }, [stream, showVideo])

  useEffect(() => {
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const frame = adapter.latestFrame()
      const skeleton = frame?.skeleton
      if (!skeleton) return
      // Skeleton points are already mirrored; map with the same cover fit as the video.
      const sourceH = 720
      const sourceW = Math.round(sourceH * skeleton.aspect)
      const map = (x: number, y: number) => mapNormalizedLandmarkToCanvas(x, y, { destWidth: w, destHeight: h, sourceWidth: sourceW, sourceHeight: sourceH, fit: 'cover', mirrored: false })
      const lw = Math.max(3, w / 120)
      if (mode === 'hands') {
        for (const side of ['left', 'right'] as const) {
          const wrist = skeleton.points[side === 'left' ? 'leftWrist' : 'rightWrist']
          const elbow = skeleton.points[side === 'left' ? 'leftElbow' : 'rightElbow']
          if (!wrist?.visible || !frame.tracking[side]) continue
          // palm centre, like the playfield cursor
          const px = elbow?.visible ? wrist.x + (wrist.x - elbow.x) * 0.3 : wrist.x
          const py = elbow?.visible ? wrist.y + (wrist.y - elbow.y) * 0.3 : wrist.y
          const P = map(px, py)
          const r = Math.max(7, w / 26)
          ctx.fillStyle = 'rgba(255,255,255,0.95)'
          ctx.beginPath()
          ctx.arc(P.x, P.y, r + 3, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = COLOR[side]
          ctx.beginPath()
          ctx.arc(P.x, P.y, r, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = '#fff'
          ctx.font = `800 ${Math.round(r * 1.15)}px "PingFang SC", "Microsoft YaHei", sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(side === 'left' ? '左' : '右', P.x, P.y + 1)
        }
        return
      }
      ctx.lineCap = 'round'
      for (const [a, b, side] of BONES) {
        const pa = skeleton.points[a]
        const pb = skeleton.points[b]
        if (!pa?.visible || !pb?.visible) continue
        const A = map(pa.x, pa.y)
        const B = map(pb.x, pb.y)
        ctx.strokeStyle = COLOR[side]
        ctx.lineWidth = lw
        ctx.beginPath()
        ctx.moveTo(A.x, A.y)
        ctx.lineTo(B.x, B.y)
        ctx.stroke()
      }
      for (const [joint, p] of Object.entries(skeleton.points)) {
        if (!p?.visible) continue
        const P = map(p.x, p.y)
        const isWrist = joint === 'leftWrist' || joint === 'rightWrist'
        ctx.fillStyle = joint.startsWith('left') ? COLOR.left : joint.startsWith('right') ? COLOR.right : '#fff'
        ctx.beginPath()
        ctx.arc(P.x, P.y, isWrist ? lw * 2.2 : lw * 1.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [adapter, mode])

  return (
    <div className={className} data-mirror-mode={mode}>
      {showVideo && <video ref={videoRef} className="mirror-video" muted playsInline aria-hidden="true" />}
      <canvas ref={canvasRef} className="mirror-canvas" aria-hidden="true" />
      {label && <span className="mirror-label">{label}</span>}
    </div>
  )
}
