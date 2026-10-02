# Archery (林间射箭)

Playable. A side-on forest range: the target stands down the lane on the bow-hand side, so pushing
the bow toward it and pulling the string back mirrors the player's own horizontal arm motion
(the layout mirrors for a left-hand string).

- **State machine:** `READY → DRAW → HOLD → RELEASE → HIT → RESET`. The motion part lives in
  `motion/drawDetector.ts` (`wait-ready → ready → draw → hold → armed → RELEASE → cooldown`); HIT
  (arrow flight + score) and RESET (hands back together) are the game's display phases
  (`controller.ts` `archeryPhase`).
- **Guards:** torso rotation (projected shoulder width < 80 % of READY), bow arm bent (< 120°),
  string-hand elbow not travelling outward (wrist flick), hands below the chest band. A guard pauses
  progress; if it lasts 0.6 s the attempt is cancelled (no shot, no penalty) and a short coaching line
  appears. Debounce: the draw must exceed its start threshold for two frames; one attempt releases at
  most once; after a release the hands must return to READY and a 0.9 s cooldown passes. Tracking
  loss cancels immediately — losing the hands is never read as letting go. The hold only counts once
  both hands have settled (net speed over 300 ms), so a still-travelling bow arm cannot bias the aim.
- **Release:** the string hand returns quickly toward the bow hand (≥ 0.22 torso units within
  450 ms, mostly by the string hand). Slowly lowering the bow is "收弓" (no shot). This is a pose
  mapping, not finger detection.
- **Hit model (no randomness):** `round.ts` `aimOffset` = bow-hand drift at the release onset ×
  gain + a wobble term from hold steadiness + a drop for an incomplete draw, scaled by the target
  distance stage. The reticle on the target shows that same prediction live during the hold.
- **Never an angle measurement:** draw amount is a wrist-separation proxy relative to the player's
  arm length; no horizontal-abduction angle is computed, shown or claimed.
- **Files:** `config.ts`, `round.ts`, `controller.ts`, `ArcheryScene.ts`, `ArcheryPlay.tsx`,
  `archery.test.ts`.
