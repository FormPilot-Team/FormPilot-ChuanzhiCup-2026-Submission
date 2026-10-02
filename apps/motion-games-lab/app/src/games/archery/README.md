# Archery (林间射箭)

Playable. A side-on forest range: the target stands down the lane on the bow-hand side, so pushing
the bow toward it and pulling the string back mirrors the player's own horizontal arm motion
(the layout mirrors for a left-hand string).

- **State machine:** `READY → DRAW → HOLD → RELEASE → HIT → RESET`. The motion part lives in
  `motion/drawDetector.ts` (`wait-ready → ready → draw → hold → armed → RELEASE → cooldown`); HIT
  (arrow flight + score) and RESET (hands back together) are the game's display phases
  (`controller.ts` `archeryPhase`).
- **Guards (round 1: never on a single frame):** a condition must persist before it becomes a guard —
  0.4 s for torso rotation (projected shoulder width < 80 % of the frontal width) and hands below the
  chest band, 0.7 s for a clearly bent bow arm (2D elbow angle < 95°) or a string elbow that does not
  travel outward (wrist flick). A guard pauses the hold; only turned / hands-low cancel, after a
  further 0.8 s. The bow arm is tiered: ≥ 125° nothing; 95–125° only a soft line under the
  instruction (手臂再伸展一点会更稳), the shot is never blocked; < 95° for 0.7 s pauses the hold. Debounce: the draw must exceed its start threshold for two frames; one attempt releases at
  most once; after a release the hands must return to READY and a 0.9 s cooldown passes. Tracking
  loss cancels immediately — losing the hands is never read as letting go. The hold only counts once
  both hands have settled (net speed over 300 ms), so a still-travelling bow arm cannot bias the aim.
- **Release (round 1):** only from ARMED (the hold was fully held). Both wrists are median-filtered
  over three frames; the confirmed peak is the highest filtered draw since HOLD began. RELEASE = the
  filtered draw falls below `peak − max(0.2, 0.3 × draw goal)` on two consecutive frames (≥ 50 ms),
  within 450 ms of leaving the peak, mostly by the string hand; coming back above half that travel
  resets the confirmation. Before, the "peak" was the single highest raw frame of the last 450 ms, so
  one noisy frame fired the arrow mid-draw. Slowly lowering the bow is "收弓" (no shot). This is a
  pose mapping, not finger detection.
- **Hit model (no randomness):** `round.ts` `aimOffset` = bow-hand drift at the release onset ×
  gain + a wobble term from hold steadiness + a drop for an incomplete draw, scaled by the target
  distance stage. The reticle on the target shows that same prediction live during the hold.
- **Never an angle measurement:** draw amount is a wrist-separation proxy relative to the player's
  arm length; no horizontal-abduction angle is computed, shown or claimed.
- **Files:** `config.ts`, `round.ts`, `controller.ts`, `ArcheryScene.ts`, `ArcheryPlay.tsx`,
  `archery.test.ts`.
