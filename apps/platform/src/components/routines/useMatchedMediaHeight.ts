import { useEffect, useRef, useState } from 'react'

/** The width from which the demonstration and the camera sit side by side (Tailwind `md`). */
export const SIDE_BY_SIDE_QUERY = '(min-width: 48rem)'

/**
 * The rendered height of the demonstration video box, while the camera sits beside it, so the camera box can take the
 * same height (follow-along stage: 标准示范 | 我的画面 share one media height). Undefined when stacked (phones): the camera
 * then keeps its own 16:9 box. Only the outer box is matched; neither picture is stretched or cropped.
 */
export function useMatchedMediaHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState<number>()

  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia(SIDE_BY_SIDE_QUERY)
    const update = () => {
      const next = query.matches ? element.getBoundingClientRect().height : undefined
      setHeight((current) => (current === next ? current : next))
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    query.addEventListener('change', update)
    update()
    return () => {
      observer.disconnect()
      query.removeEventListener('change', update)
    }
  }, [])

  return { ref, height: height && height > 0 ? height : undefined }
}
