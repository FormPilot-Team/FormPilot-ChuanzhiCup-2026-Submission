import type { ReferencePose } from '../../features/referencePose/types'
import { mapCoachHighlightAnchors } from '../../features/coach/poseAnchorMapping'
import type { CoachDirection, CoachHighlightRegion } from '../../features/coach/types'

interface CoachHighlightOverlayProps {
  pose?: ReferencePose
  region: CoachHighlightRegion
  direction?: CoachDirection
}

export function CoachHighlightOverlay({ pose, region, direction }: CoachHighlightOverlayProps) {
  const anchors = mapCoachHighlightAnchors(pose, region, direction)
  if (!anchors.length) return null

  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox="0 0 1 1"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      data-testid="coach-highlight-overlay"
    >
      {anchors.map((anchor, index) => {
        const arrowEndY = anchor.direction === 'up' ? anchor.y - 0.105 : anchor.direction === 'down' ? anchor.y + 0.105 : undefined
        return (
          <g key={`${region}-${index}`} data-testid="coach-highlight-anchor" data-x={anchor.x.toFixed(4)} data-y={anchor.y.toFixed(4)}>
            <circle cx={anchor.x} cy={anchor.y} r="0.065" fill="rgb(255 115 92 / 0.18)" stroke="rgb(235 93 72 / 0.82)" strokeWidth="0.009" />
            <circle cx={anchor.x} cy={anchor.y} r="0.012" fill="#eb5d48" />
            {arrowEndY !== undefined ? (
              <g stroke="#eb5d48" strokeWidth="0.012" strokeLinecap="round" strokeLinejoin="round">
                <line x1={anchor.x} y1={anchor.y} x2={anchor.x} y2={arrowEndY} />
                <path d={anchor.direction === 'up'
                  ? `M ${anchor.x - 0.025} ${arrowEndY + 0.025} L ${anchor.x} ${arrowEndY} L ${anchor.x + 0.025} ${arrowEndY + 0.025}`
                  : `M ${anchor.x - 0.025} ${arrowEndY - 0.025} L ${anchor.x} ${arrowEndY} L ${anchor.x + 0.025} ${arrowEndY - 0.025}`} fill="none" />
              </g>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
