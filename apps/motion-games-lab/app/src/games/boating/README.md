# Boating (林间划船) — reserved, not implemented in Stage A + B

Nothing here runs yet. This note records what the shared layers already provide so the next round
can plug in without changing them.

- **Motion events (types only, `src/motion/contracts.ts`):** `STROKE_LEFT` / `STROKE_RIGHT`
  `{ cycleId, amplitude, durationMs }`, plus the shared `TRACKING_LOST/RESTORED` and `POSTURE_CHANGED`.
  `MotionAdapter.enable('strokes')` currently throws "reserved" on purpose.
- **Definition:** periodic upper-limb movement + bilateral coordination + rhythm. Never shows
  "shoulder internal/external rotation ROM" (NO-GO since Phase 0).
- **Candidate trajectories:** Phase 0.5 scheme A (outward sweep) and B (downward stroke), see
  `experiments/playground/engine.ts` `updateRowing`. To be chosen next round.
- **Reusable as-is:** `shared/metrics.ts` `GameResult` + `ui/ResultScreen.tsx`, `shared/phaserHost.ts`,
  `shared/world/painters.ts` (`paintRiverCard`, sky/hills/tree lines/meadow), `shared/audio.ts`,
  `ui/GameFlow` steps (intro → positioning → camera/calibration → countdown → play → result),
  posture hints, pause/tracking-lost overlays and the debug panel.
