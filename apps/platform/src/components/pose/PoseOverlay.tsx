import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { MotionError } from '../../features/exercises/types'
import { mapNormalizedLandmarkToCanvas } from '../../features/pose/fitMapping'
import { LANDMARK_INDEX, type PoseFrame } from '../../features/pose/types'

export interface PoseOverlayHandle {
  draw(frame: PoseFrame | null, errors: ReadonlyArray<MotionError>, options?: PoseOverlayDrawOptions): void
  clear(): void
  /**
   * Every processed frame, whether or not the skeleton is shown (Web V1.1): the immersive stage uses it for body-aware
   * framing and for the correction highlight. Optional; the plain overlay ignores it.
   */
  observe?(frame: PoseFrame | null, options?: PoseOverlayDrawOptions): void
}

/** A body region to mark on the user's own skeleton, from a confirmed follow-along correction. */
export type PoseHighlightRegion = 'arms' | 'torso' | 'legs'

export interface PoseOverlayDrawOptions {
  mirrored?: boolean
  sourceWidth?: number
  sourceHeight?: number
  fit?: 'cover' | 'contain'
}

const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
] as const

const CONNECTION_INDICES = [...new Set(CONNECTIONS.flat())]

function activeSide(errors: ReadonlyArray<MotionError>): 'left' | 'right' | undefined {
  return errors.find((item) => item.side)?.side
}

interface PoseOverlayProps {
  visible?: boolean
  /** Marks a whole region (follow-along corrections name a region, not a side). */
  highlight?: PoseHighlightRegion
  /** Draw only the highlighted limbs (the full skeleton is hidden while following). */
  highlightOnly?: boolean
}

const REGION_JOINTS: Readonly<Record<PoseHighlightRegion, ReadonlyArray<number>>> = {
  arms: [11, 12, 13, 14, 15, 16],
  torso: [11, 12, 23, 24],
  legs: [23, 24, 25, 26, 27, 28],
}

const REGION_CONNECTIONS: Readonly<Record<PoseHighlightRegion, ReadonlyArray<readonly [number, number]>>> = {
  arms: [[11, 13], [13, 15], [12, 14], [14, 16]],
  torso: [[11, 12], [11, 23], [12, 24], [23, 24]],
  legs: [[23, 25], [25, 27], [24, 26], [26, 28]],
}

export const PoseOverlay = forwardRef<PoseOverlayHandle, PoseOverlayProps>(function PoseOverlay({ visible = true, highlight, highlightOnly = false }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  const highlightRef = useRef({ highlight, highlightOnly })
  highlightRef.current = { highlight, highlightOnly }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box) return
      sizeRef.current = { width: box.width, height: box.height }
    })
    observer.observe(canvas)
    const rect = canvas.getBoundingClientRect()
    sizeRef.current = { width: rect.width, height: rect.height }
    return () => observer.disconnect()
  }, [])

  const clear = () => {
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }

  useImperativeHandle(ref, () => ({
    clear,
    draw(frame, errors, options = {}) {
      const canvas = canvasRef.current
      if (!canvas || !frame) return clear()
      const bounds = sizeRef.current.width > 0 ? sizeRef.current : canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const targetWidth = Math.round(bounds.width * dpr)
      const targetHeight = Math.round(bounds.height * dpr)
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth
        canvas.height = targetHeight
      }
      const context = canvas.getContext('2d')
      if (!context) return
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.lineCap = 'round'
      context.lineJoin = 'round'
      const side = activeSide(errors)
      const mapping = {
        destWidth: canvas.width,
        destHeight: canvas.height,
        sourceWidth: options.sourceWidth ?? canvas.width,
        sourceHeight: options.sourceHeight ?? canvas.height,
        fit: options.fit ?? 'cover' as const,
        mirrored: options.mirrored ?? true,
      }
      const point = (index: number) => {
        const landmark = frame.landmarks[index]
        return mapNormalizedLandmarkToCanvas(landmark.x, landmark.y, mapping)
      }
      const isSideConnection = (a: number, b: number, target?: 'left' | 'right') => {
        if (!target) return false
        const indices: number[] = target === 'left'
          ? [LANDMARK_INDEX.leftShoulder, LANDMARK_INDEX.leftElbow, LANDMARK_INDEX.leftWrist]
          : [LANDMARK_INDEX.rightShoulder, LANDMARK_INDEX.rightElbow, LANDMARK_INDEX.rightWrist]
        return indices.includes(a) && indices.includes(b)
      }
      const region = highlightRef.current.highlight
      const only = highlightRef.current.highlightOnly
      const isRegionConnection = (a: number, b: number) => Boolean(region && REGION_CONNECTIONS[region].some(([x, y]) => (x === a && y === b) || (x === b && y === a)))
      if (only && !region && !side) return

      for (const [a, b] of CONNECTIONS) {
        const start = point(a)
        const end = point(b)
        const highlighted = isSideConnection(a, b, side) || isRegionConnection(a, b)
        if (only && !highlighted) continue
        context.strokeStyle = highlighted ? '#ff6b54' : 'rgba(121, 187, 255, 0.95)'
        context.lineWidth = (highlighted ? 5 : 3) * dpr
        context.beginPath()
        context.moveTo(start.x, start.y)
        context.lineTo(end.x, end.y)
        context.stroke()
      }
      for (const index of CONNECTION_INDICES) {
        const current = point(index)
        const highlighted =
          side === 'left'
            ? [11, 13, 15].includes(index)
            : side === 'right'
              ? [12, 14, 16].includes(index)
              : Boolean(region && REGION_JOINTS[region].includes(index))
        if (only && !highlighted) continue
        context.fillStyle = highlighted ? '#ff6b54' : '#ffffff'
        context.strokeStyle = highlighted ? '#ffffff' : '#4d9cf8'
        context.lineWidth = 2 * dpr
        context.beginPath()
        context.arc(current.x, current.y, (highlighted ? 6 : 4.5) * dpr, 0, Math.PI * 2)
        context.fill()
        context.stroke()
      }
    },
  }))

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 size-full"
      aria-hidden="true"
      data-testid="pose-overlay"
      data-overlay-visible={visible ? 'true' : 'false'}
      data-overlay-highlight={highlight ?? ''}
      hidden={!visible}
    />
  )
})
