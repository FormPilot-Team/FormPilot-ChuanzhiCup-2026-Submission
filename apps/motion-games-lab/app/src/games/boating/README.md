# Boating (林间划船)

Playable. A small boat on a forest river: each paddle stroke pushes the boat forward, a steady
left–right rhythm turns on "flow" (顺流, faster), floating lotus lanterns are collected by a stroke
on their side while they drift alongside, landmarks mark the way. Self-paced: the river only moves
when the player paddles; missing a lantern costs nothing.

- **Motion (scheme A, default):** `motion/strokeDetector.ts`. Forearm sweeps outward to the side
  and back, elbows near the body. Per side: `wait → ready → out → STROKE_x (catch) → return → ready`.
  The stroke counts when the displacement from the player's own neutral reaches the amplitude and
  the hand is outside its shoulder; it re-arms only after the hand comes back near neutral.
  Guards: hand above the shoulder (waving), body turned (shoulder width shrinks), a one-frame jump
  (too fast), tracking loss and pause (cancel). Scheme B (downward stroke) stays available for
  comparison only via `?stroke=down`.
- **Never a rotation measurement:** strokes are a 2D trajectory proxy for paddling. No shoulder
  internal/external rotation angle or ROM is computed, shown or claimed.
- **Files:** `config.ts` (difficulty, physics, rhythm, scoring, landmarks), `round.ts` (rules),
  `controller.ts` (shared PlayController + oar / cursor state), `BoatScene.ts` (Phaser renderer),
  `BoatingPlay.tsx` (shared GamePlay shell), `boating.test.ts`.
- **Hand language:** each hand has a stroke track at its side of the screen; the hand cursor rides
  it with the live stroke progress (open → half while stroking → fist at the catch); the oar follows
  the same progress; a pulsing dot marks the side to paddle next and turns gold when a lantern waits.
