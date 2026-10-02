# Archery (林间射箭) — reserved, not implemented in Stage A + B

Nothing here runs yet. This note records what the shared layers already provide.

- **Motion events (types only, `src/motion/contracts.ts`):** `DRAW_START`, `DRAW_HOLD { progress, stability }`,
  `RELEASE { drawAmount, holdStability }`. `MotionAdapter.enable('draw')` throws "reserved" on purpose.
- **Planned state machine:** READY → DRAW → HOLD → RELEASE → HIT → RESET with torso-rotation guard,
  elbow-flexion guard, debounce, cooldown and tracking-loss recovery. The hit result depends on HOLD
  stability, completeness and release timing — no purely random outcome. Phase 0.5 prototype:
  `experiments/playground/engine.ts` `updateArchery`.
- **Reusable as-is:** the same shared result page, Phaser host, world painters (`paintRangeCard`),
  audio, flow steps, posture/tracking overlays and pause gating (`setDetectionActive`), which already
  guarantees that no event can complete while the game is paused.
