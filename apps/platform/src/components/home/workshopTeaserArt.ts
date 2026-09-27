import type { SilhouetteShape } from './ModeFigure'

/**
 * 动作工坊 on Home: the person in front of the camera, drawn by hand in the camera frame's 50 x 58 viewBox. It is on
 * purpose NOT a frame from any training's pose track: 动作工坊 learns whatever action the user shows it, so the card shows
 * someone standing at ease — mirror-symmetric about `axis`, arms relaxed at the sides, nothing above `shoulderY` but the
 * head — and no action anyone could name.
 */
export interface NeutralFigure extends SilhouetteShape {
  axis: number
  shoulderY: number
}

type Segment = SilhouetteShape['segments'][number]

const AXIS = 25
const SHOULDER_Y = 20

/** The viewer's left arm and leg (upper, then lower part); the right side is their mirror image. */
const LEFT_LIMBS: ReadonlyArray<Segment> = [
  [19.9, 21, 17.7, 28.4, 3.1],
  [17.7, 28.4, 16.6, 35.2, 2.6],
  [23, 32.6, 22.7, 40.8, 4],
  [22.7, 40.8, 22.6, 48.2, 3.1],
]

const mirror = ([x1, y1, x2, y2, width]: Segment): Segment => [2 * AXIS - x1, y1, 2 * AXIS - x2, y2, width]

export const WORKSHOP_NEUTRAL_FIGURE: NeutralFigure = {
  axis: AXIS,
  shoulderY: SHOULDER_Y,
  head: [AXIS, 12.8, 4.2],
  segments: [[AXIS, 17.8, AXIS, SHOULDER_Y, 2.6], ...LEFT_LIMBS, ...LEFT_LIMBS.map(mirror)],
  torso: `M19.9 ${SHOULDER_Y} 30.1 ${SHOULDER_Y} 28.4 32.8 21.6 32.8Z`,
  torsoRound: 2.4,
}
