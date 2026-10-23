# Archery (林间射箭)

Playable. A side-on forest range: the target stands down the lane on the bow-hand side, so pushing
the bow toward it and pulling the string back mirrors the player's own horizontal arm motion
(the layout mirrors for a left-hand string).

- **State machine (round 2):** `READY → DRAW → HOLD → RETURN_ARMED → FIRE → HIT → RESET`. The motion
  part lives in `motion/drawDetector.ts` (`wait-ready → ready → draw → hold → armed → FIRE → cooldown`;
  `armed` = RETURN_ARMED); FIRE / HIT (arrow flight + score) and RESET (hands back together) are the
  game's display phases (`controller.ts` `archeryPhase`).
- **The shot = bring the string hand back to the chest.** The round-1 "quick let-go of the string"
  (fall below the confirmed peak within 450 ms) is gone: players did not understand it and could not
  fire, and a pose model cannot see fingers. After the hold, FIRE when the string hand has come back
  40 % of the way from its drawn position toward its READY position (measured against at least 0.3
  torso units) on 3 consecutive frames. No speed, no time window. The return must be mostly sideways
  (vertical ≤ 1.2 × sideways + 0.1), so dropping the arm to the side is not a shot.
- **The bow hand aims and never blocks.** Its height against the bow shoulder moves the reticle up and
  down (sideways is deliberately not mapped). The elbow angle, aiming moves and a turned torso never
  pause, reset or cancel anything; a bent arm (< 80° for 3 s) or a turned torso (3 s) only add a soft
  line under the instruction. The hold timer only watches the string hand (it pauses while that hand
  is still moving; it never resets).
- **Aim locking:** when the return begins, the aim is locked to the mean aim over the 200 ms before the
  return onset (the last frame the string hand was still at its peak). The reticle freezes there and
  the arrow flies there, so the firing move cannot drag the aim.
- **What still protects the game:** no FIRE without DRAW → HOLD (coming back early → "圆圈转满后再收回",
  pull out again to retry); the string hand must be pulled out ≥ 0.15 from READY (else "拉弦的手也向外拉开");
  hold jitter cannot reach the return threshold (median-3 + light smoothing, 3 frames); tracking loss
  cancels at once; one FIRE per draw; READY (hands together) before the next draw; both wrists below
  0.78 torso units (arms hanging) = not a bow: no hold, no FIRE.
- **Teaching:** three tutorial cards (hands together / draw + aim up-down + hold / bring the string hand
  back with an arrow); in RETURN_ARMED a ring around the string hand fills, the string glows and the
  nock eases forward as the hand comes back; before the first arrow, waiting 1 s shows a ghost hand
  gliding back to the chest (4 s for later arrows), hidden the moment the return begins.
- **Hit model (no randomness):** `round.ts` `aimOffset` = locked aim × gain + a wobble term from hold
  steadiness (detrended bow-hand RMS: a slow aiming glide is not wobble) + a drop for an incomplete
  draw, scaled by the target distance stage.
- **Never an angle measurement:** draw amount is a wrist-separation proxy relative to the player's
  arm length; the elbow angle is debug-only.
- **Files:** `config.ts`, `round.ts`, `controller.ts`, `ArcheryScene.ts`, `ArcheryPlay.tsx`,
  `archery.test.ts`; detector tests in `motion/detectors.test.ts` (incl. the human-like replay,
  `motion/humanArcher.fixture.ts`).
