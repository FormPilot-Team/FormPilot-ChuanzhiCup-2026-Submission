# Boating (林间划船)

Playable. A small boat on a forest river: each paddle stroke pushes the boat forward, a steady
left–right rhythm turns on "flow" (顺流, faster), floating lotus lanterns are collected by a stroke
on their side while they drift alongside, landmarks mark the way. Self-paced: the river only moves
when the player paddles; missing a lantern costs nothing.

- **Motion (scheme A, default):** `motion/strokeDetector.ts`, rewritten after the first human
  playtest (players imitating the on-screen track were often not recognised). Per side:
  `READY → OUTWARD → STROKE → RETURN → READY` (`ready → out → STROKE_x → return`; `wait` only while
  the hand is not tracked). A stroke depends only on the wrist's outward travel from the player's own
  neutral (the lower envelope of the last 1.5 s), measured in the player's shoulder widths
  (轻松 0.22 / 标准 0.28 / 挑战 0.36), confirmed on two frames and taking ≥ 70 ms. No "hold still"
  wait, no required end position outside the shoulder, no torso-turn or elbow rule: up/down drift, a
  rising or sinking path, bent elbows and any comfortable speed all count. No double counts: the next
  stroke needs the hand back by half a stroke (hysteresis ≫ jitter), and moving inward never starts
  one. Only a hand clearly above the head (waving) is ignored. Scheme B (downward stroke) stays
  available for comparison only via `?stroke=down`.
- **Never a rotation measurement:** strokes are a 2D trajectory proxy for paddling. No shoulder
  internal/external rotation angle or ROM is computed, shown or claimed.
- **Files:** `config.ts` (difficulty, physics, rhythm, scoring, landmarks), `round.ts` (rules),
  `controller.ts` (shared PlayController + oar / cursor state), `BoatScene.ts` (Phaser renderer),
  `BoatingPlay.tsx` (shared GamePlay shell), `boating.test.ts`.
- **Hand language / live guidance:** each hand has a stroke track at its side of the screen. Its start
  point is labelled 从这里开始 until that side has paddled twice; the track fills in gold as the hand
  moves out and drains as it comes back; a chevron shows the direction; the whole track flashes when
  the stroke counts. The hand cursor rides it (open → half while stroking → fist at the catch) and the
  oar follows the same progress, eased every rendered frame. A translucent ghost hand demonstrates the
  stroke (at most three loops) until a side has paddled, and two more loops after ~10 s without
  strokes. A pulsing dot marks the side to paddle next and turns gold when a lantern waits.
