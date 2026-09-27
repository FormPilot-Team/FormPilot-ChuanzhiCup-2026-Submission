/**
 * FormPilot's digital coach: one character (Family A of docs/hybrid-ai-coach/BASELINE.md) from the Home welcome to
 * training guidance and the AI Coach. The Home and avatar pictures are transparent cut-outs of existing Family A
 * images, not new drawings (`scripts/visual/coach_cutouts.py` removes the flat off-white canvas and pale-blue disc):
 *
 * - COACH_WELCOME_FAMILY_A: `coach-shoulder-rotation.png` (sha256 dacaacc7…), raised open palms, crop 160,36–925,780
 *   (hands to hips), 765 × 744 WebP with alpha. The closest existing greeting gesture; a dedicated welcome pose is
 *   still missing.
 * - COACH_AVATAR_ASSET: `overhead-raise-demo-start.png` (the identity baseline, sha256 e533f3fd…), head crop
 *   363,36–703,376, 192 px WebP with alpha, shown on a soft disc by `CoachAvatar`.
 *
 * The cut-outs are tuned for FormPilot's light surfaces.
 */

/** A coach picture and how Home frames it. */
export interface CoachImageAsset {
  src: string
  /** Intrinsic size in pixels, so the layout never jumps while it loads. */
  width: number
  height: number
  /**
   * `transparent`: a cut-out (PNG/WebP with alpha), shown as it is.
   * `light`: drawn on a flat white or off-white canvas; shown with `mix-blend-mode: multiply` so the canvas melts into
   * the light page instead of showing a box.
   */
  background: 'transparent' | 'light'
  /** CSS object-position used when a narrow screen crops the picture: keep the face in frame. */
  focus: string
  /** The picture is cut off at the bottom (a half-body crop): fade that edge into the page. */
  fadeBottom: boolean
  /**
   * Where the welcome bubble's top-right corner sits, as CSS `right` / `top` inside the picture box. Pick empty space
   * beside the coach (here: under the raised left arm) so the bubble never covers her.
   */
  bubble: { right: string; top: string }
}

/** The shipped welcome picture, cut out of Family A. Also the fallback for any replacement. */
export const COACH_WELCOME_FAMILY_A: CoachImageAsset = Object.freeze({
  src: '/assets/coach/coach-welcome.webp',
  width: 765,
  height: 744,
  background: 'transparent',
  focus: '50% 22%',
  fadeBottom: true,
  bubble: { right: '76%', top: '34%' },
})

/**
 * The Home hero coach. This is the only line to change when the formal welcome-pose picture arrives: put the file
 * under `public/assets/coach/` (transparent PNG/WebP preferred, a white canvas also works with `background: 'light'`)
 * and describe it here. The hero keeps its layout; if the new file fails to load it shows COACH_WELCOME_FALLBACK.
 */
export const COACH_WELCOME_ASSET: CoachImageAsset = COACH_WELCOME_FAMILY_A

/** Shown when COACH_WELCOME_ASSET cannot be loaded. */
export const COACH_WELCOME_FALLBACK: CoachImageAsset = COACH_WELCOME_FAMILY_A

export const COACH_AVATAR_ASSET = '/assets/coach/coach-avatar.webp'
export const COACH_NAME = 'FormPilot 教练'
