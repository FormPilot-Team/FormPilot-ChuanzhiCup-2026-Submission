// One palette for the whole forest world (orchard → river → training glade), so the three games
// read as one product. Also mirrored as CSS custom properties in ui/styles.css.
export const PALETTE = Object.freeze({
  skyTop: '#6cc3ec',
  skyMid: '#a8dcf2',
  skyHorizon: '#eaf6ee',
  sun: '#fff1b8',
  sunGlow: 'rgba(255, 236, 170, 0.55)',
  cloud: '#ffffff',
  hillFar: '#9fcfb2',
  hillMid: '#79b98f',
  hillNear: '#5aa173',
  forestFar: '#4f8f6c',
  forestDeep: '#2f6b4f',
  leafDark: '#2e6e45',
  leaf: '#4f9a55',
  leafLight: '#86c46f',
  leafGlint: '#c4e78e',
  bark: '#7a5134',
  barkDark: '#553623',
  grass: '#6fb35d',
  grassLight: '#9ad072',
  grassDark: '#4b8d45',
  appleRed: '#e5483b',
  appleDeep: '#b8282a',
  appleShine: '#ffd3c4',
  wood: '#c08a55',
  woodDark: '#8a5a32',
  woodLight: '#e2b47d',
  water: '#5cb8d6',
  waterDeep: '#3b8fb3',
  waterLight: '#bfe9f2',
  gold: '#ffc94d',
  teal: '#2bb5a8',
  amber: '#ff9a3c',
  /** hand cursor: one warm-white design for both hands (left and right differ only by position) */
  handLight: '#fffdf8',
  handFill: '#fbf2e6',
  handShade: '#efdcc6',
  handLine: 'rgba(108, 80, 58, 0.62)',
  ink: '#1f3a2e',
  cream: '#fffaf0',
})

/** Accent for hand-related playfield marks (stroke tracks, halos): the same for both hands. */
export const HAND_ACCENT = 0xffd36b
export const HAND_HALO = 0xfff4dc
