/**
 * FormPilot's digital coach: one character (Family A of docs/hybrid-ai-coach/BASELINE.md) from the Home welcome to
 * training guidance and the AI Coach. The Home and avatar pictures are transparent cut-outs of existing Family A
 * images, not new drawings (`scripts/visual/coach_cutouts.py` removes the flat off-white canvas and pale-blue disc):
 *
 * - COACH_WELCOME_FAMILY_A: `coach-shoulder-rotation.png` (sha256 dacaacc7…), raised open palms, crop 160,36–925,780
 *   (hands to hips), 765 × 744 WebP with alpha. The closest existing greeting gesture; a dedicated welcome pose is
 *   still missing.
 * - COACH_AVATAR_ASSET: `overhead-raise-demo-start.png` (the identity baseline, sha256 e533f3fd…), head-and-shoulders
 *   crop 343,40–723,420 (the whole bun to the shoulder tops; the head fills about two thirds of the circle), 256 px WebP
 *   with alpha, shown on a soft disc by `CoachAvatar`.
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
   * Where the welcome bubble's top-right corner sits, as CSS `right` / `top` inside the picture box; its tail leaves
   * that corner towards the coach. Pick empty space beside her that clears the face AND the raised arms.
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
  // Below the raised right arm (which reaches the shoulder at about 33 % across, 52 % down) and beside the torso
  // (35-38 % across further down): the bubble's right edge stays at 31 %, its tail points up at her.
  bubble: { right: '69%', top: '54%' },
})

/**
 * The Home hero coach. This is the only line to change when the formal welcome-pose picture arrives: put the file
 * under `public/assets/coach/` (transparent PNG/WebP preferred, a white canvas also works with `background: 'light'`)
 * and describe it here. The hero keeps its layout; if the new file fails to load it shows COACH_WELCOME_FALLBACK.
 */
export const COACH_WELCOME_ASSET: CoachImageAsset = COACH_WELCOME_FAMILY_A

/** Shown when COACH_WELCOME_ASSET cannot be loaded. */
export const COACH_WELCOME_FALLBACK: CoachImageAsset = COACH_WELCOME_FAMILY_A

/** A square, transparent bust of the coach for round avatars. */
export interface CoachAvatarAsset {
  src: string
  width: number
  height: number
  background: 'transparent'
}

/**
 * Every small round coach picture (32–64 px: realtime feedback, the 问 AI 教练 button and panel, reports, the workshop)
 * shows this bust through `CoachAvatar`. Never put a full-body picture in a round avatar, and never crop one per page.
 */
export const COACH_AVATAR_ASSET: CoachAvatarAsset = Object.freeze({
  src: '/assets/coach/coach-avatar.webp',
  width: 256,
  height: 256,
  background: 'transparent',
})

export const COACH_NAME = 'FormPilot 教练'
