/**
 * FormPilot's digital coach: one character (Family A of docs/hybrid-ai-coach/BASELINE.md) from the Home welcome to
 * training guidance and the AI Coach. Both Home images are crops of existing Family A assets, not new drawings:
 *
 * - COACH_WELCOME_ASSET: `coach-shoulder-rotation.png` (sha256 dacaacc7…), crop 120,24–962,1010, 600 px wide WebP.
 *   The raised open-palm pose is the closest existing welcome gesture; a dedicated greeting asset is still missing.
 * - COACH_AVATAR_ASSET: `overhead-raise-demo-start.png` (the identity baseline, sha256 e533f3fd…), head crop
 *   363,36–703,376, 192 px WebP.
 *
 * Both keep the source's off-white background and pale-blue disc, so they are shown on light surfaces with
 * `mix-blend-mode: multiply` rather than cut out.
 */
export const COACH_WELCOME_ASSET = '/assets/coach/coach-welcome.webp'
export const COACH_AVATAR_ASSET = '/assets/coach/coach-avatar.webp'
export const COACH_NAME = 'FormPilot 教练'
