import { useEffect, useState } from 'react'

/** Landscape screens from 896 px wide put the demonstration and the camera side by side; portrait screens stack them. */
export const SIDE_BY_SIDE_IMMERSIVE_QUERY = '(orientation: landscape) and (min-width: 56rem)'

export type MediaArrangement = 'side-by-side' | 'stacked'

function current(): MediaArrangement {
  try {
    return window.matchMedia(SIDE_BY_SIDE_IMMERSIVE_QUERY).matches ? 'side-by-side' : 'stacked'
  } catch {
    return 'side-by-side'
  }
}

export function useMediaArrangement(): MediaArrangement {
  const [arrangement, setArrangement] = useState<MediaArrangement>(current)
  useEffect(() => {
    let query: MediaQueryList
    try { query = window.matchMedia(SIDE_BY_SIDE_IMMERSIVE_QUERY) } catch { return undefined }
    const update = () => setArrangement(query.matches ? 'side-by-side' : 'stacked')
    query.addEventListener('change', update)
    update()
    return () => query.removeEventListener('change', update)
  }, [])
  return arrangement
}
