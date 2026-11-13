import { useCallback, useEffect, useImperativeHandle, useRef, type RefObject } from 'react'
import {
  BodyFramer,
  IDENTITY_FRAMING,
  boxInside,
  isIdentity,
  landmarkBox,
  significantChange,
  transformBox,
  type FramingTransform,
} from '../../features/framing/bodyFraming'
import type { PoseFrame } from '../../features/pose/types'
import type { PoseOverlayDrawOptions, PoseOverlayHandle } from '../pose/PoseOverlay'

const UPDATE_INTERVAL_MS = 450

function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

interface BodyFramingOptions {
  /** The handle the training runtime draws into; the hook stands in for the real overlay. */
  overlayRef: RefObject<PoseOverlayHandle | null>
  /** Auto framing switched on by the user (default on). */
  enabled: boolean
  /** Framing Assist reports the body in frame; otherwise the whole picture is shown. */
  ready: boolean
  /** Whether the full skeleton is drawn now; while it is hidden only a highlighted region is drawn. */
  skeletonVisible: boolean
  highlightActive: boolean
}

/**
 * Wraps the training runtime's overlay handle: frames are passed on unchanged to the real PoseOverlay, and their
 * landmarks also drive the body-aware framing of the stage (the video and the skeleton canvas move together in one
 * transformed layer, so the skeleton stays exactly on the body). Recognition input is never changed.
 */
export function useBodyFraming({ overlayRef, enabled, ready, skeletonVisible, highlightActive }: BodyFramingOptions) {
  const innerRef = useRef<PoseOverlayHandle>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const framerRef = useRef(new BodyFramer())
  const currentRef = useRef<FramingTransform>(IDENTITY_FRAMING)
  const lastApplyRef = useRef(0)
  const lastFrameRef = useRef<PoseFrame | null>(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  const settings = useRef({ enabled, ready, skeletonVisible, highlightActive })
  settings.current = { enabled, ready, skeletonVisible, highlightActive }

  const apply = useCallback((transform: FramingTransform, urgent: boolean, now: number) => {
    const layer = layerRef.current
    const stage = stageRef.current
    currentRef.current = transform
    lastApplyRef.current = now
    if (!layer || !stage) return
    const duration = prefersReducedMotion() ? 0 : urgent ? 180 : 700
    layer.style.transition = `transform ${duration}ms cubic-bezier(.2,.7,.2,1)`
    layer.style.transform = isIdentity(transform) ? '' : `translate3d(${transform.x.toFixed(1)}px, ${transform.y.toFixed(1)}px, 0) scale(${transform.scale.toFixed(4)})`
    stage.dataset.framingMode = isIdentity(transform) ? 'full' : 'body'
    stage.dataset.framingScale = transform.scale.toFixed(2)
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box) return
      const changed = Math.abs(box.width - sizeRef.current.width) > 1 || Math.abs(box.height - sizeRef.current.height) > 1
      sizeRef.current = { width: box.width, height: box.height }
      // A new stage size invalidates the boxes measured in the old one.
      if (changed) {
        framerRef.current.reset()
        apply(IDENTITY_FRAMING, true, performance.now())
      }
    })
    observer.observe(stage)
    const rect = stage.getBoundingClientRect()
    sizeRef.current = { width: rect.width, height: rect.height }
    return () => observer.disconnect()
  }, [apply])

  useEffect(() => {
    if (!enabled || !ready) {
      framerRef.current.reset()
      apply(IDENTITY_FRAMING, true, performance.now())
    }
  }, [apply, enabled, ready])

  const track = useCallback((frame: PoseFrame | null, options: PoseOverlayDrawOptions = {}) => {
    if (frame && frame === lastFrameRef.current) return
    lastFrameRef.current = frame
    const stage = stageRef.current
    const { width, height } = sizeRef.current
    if (!stage || !(width > 0 && height > 0)) return
    const now = performance.now()
    const box = frame ? landmarkBox(frame.landmarks, {
      destWidth: width,
      destHeight: height,
      sourceWidth: options.sourceWidth ?? width,
      sourceHeight: options.sourceHeight ?? height,
      fit: options.fit ?? 'cover',
      mirrored: options.mirrored ?? true,
    }) : null
    framerRef.current.push(box, now)
    const current = currentRef.current
    if (box) {
      const shown = transformBox(box, current)
      stage.dataset.bodyBox = [shown.left, shown.top, shown.right, shown.bottom].map((value) => Math.round(value)).join(',')
      stage.dataset.bodyInside = boxInside(box, current, width, height) ? 'true' : 'false'
    } else {
      delete stage.dataset.bodyBox
      stage.dataset.bodyInside = 'none'
    }
    const { enabled: on, ready: inFrame } = settings.current
    const target = on && inFrame ? framerRef.current.target(width, height, now) : IDENTITY_FRAMING
    const urgent = (box !== null && !boxInside(box, current, width, height)) || (isIdentity(target) && !isIdentity(current))
    if (urgent || (now - lastApplyRef.current >= UPDATE_INTERVAL_MS && significantChange(current, target, width, height))) apply(target, urgent, now)
  }, [apply])

  useImperativeHandle(overlayRef, () => ({
    draw(frame, errors, options) {
      innerRef.current?.draw(frame, errors, options)
      track(frame, options)
    },
    clear() {
      innerRef.current?.clear()
    },
    observe(frame, options) {
      track(frame, options)
      // While following, the full skeleton is hidden; a confirmed region correction is still marked on the body.
      if (!settings.current.skeletonVisible && settings.current.highlightActive) innerRef.current?.draw(frame, [], options)
    },
  }), [track])

  return { innerRef, stageRef, layerRef }
}
