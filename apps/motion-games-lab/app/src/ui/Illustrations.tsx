// Simple flat illustrations for the instruction pages (inline SVG, same palette as the world).
const INK = '#1f3a2e'
const SKIN = '#f3c7a6'
const SHIRT = '#4f9a55'
const LEFT = '#2bb5a8'
const RIGHT = '#ff9a3c'

function Apple({ x, y, r = 16 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#e5483b" />
      <ellipse cx={x - r * 0.35} cy={y - r * 0.3} rx={r * 0.25} ry={r * 0.35} fill="#ffb3a1" opacity="0.8" />
      <path d={`M${x} ${y - r} q2 -8 7 -10`} stroke="#553623" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d={`M${x + 4} ${y - r - 6} q10 -8 18 -2 q-8 8 -18 2z`} fill="#4f9a55" />
    </g>
  )
}

function Person({ x, y, armL, armR, seated = false }: { x: number; y: number; armL: [number, number]; armR: [number, number]; seated?: boolean }) {
  // armX = [elbowX, elbowY] etc. expressed as wrist offset from shoulder
  const sl = { x: x - 22, y: y }
  const sr = { x: x + 22, y: y }
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      {seated && <rect x={x - 34} y={y + 58} width="68" height="10" rx="5" fill="#c08a55" />}
      {seated && <rect x={x - 30} y={y + 66} width="8" height="40" fill="#8a5a32" />}
      {seated && <rect x={x + 22} y={y + 66} width="8" height="40" fill="#8a5a32" />}
      <path d={`M${x - 26} ${y - 4} Q${x} ${y - 12} ${x + 26} ${y - 4} L${x + 20} ${y + 60} L${x - 20} ${y + 60} Z`} fill={SHIRT} />
      {!seated && <path d={`M${x - 14} ${y + 60} L${x - 16} ${y + 120} M${x + 14} ${y + 60} L${x + 16} ${y + 120}`} stroke="#3c5a8a" strokeWidth="14" />}
      {seated && <path d={`M${x - 14} ${y + 60} L${x - 14} ${y + 64} L${x - 40} ${y + 66} L${x - 42} ${y + 110} M${x + 14} ${y + 60} L${x + 14} ${y + 64}`} stroke="#3c5a8a" strokeWidth="14" />}
      <line x1={sl.x} y1={sl.y} x2={sl.x + armL[0]} y2={sl.y + armL[1]} stroke={SKIN} strokeWidth="11" />
      <line x1={sr.x} y1={sr.y} x2={sr.x + armR[0]} y2={sr.y + armR[1]} stroke={SKIN} strokeWidth="11" />
      <circle cx={sl.x + armL[0]} cy={sl.y + armL[1]} r="8" fill={LEFT} />
      <circle cx={sr.x + armR[0]} cy={sr.y + armR[1]} r="8" fill={RIGHT} />
      <circle cx={x} cy={y - 26} r="17" fill={SKIN} />
      <path d={`M${x - 17} ${y - 30} q17 -20 34 0 q-2 -18 -17 -18 q-15 0 -17 18z`} fill="#8a6a55" />
    </g>
  )
}

export function HowReach() {
  return (
    <svg viewBox="0 0 240 150" role="img" aria-label="把手伸到苹果上">
      <rect width="240" height="150" rx="18" fill="#e8f6fb" />
      <ellipse cx="120" cy="40" rx="100" ry="34" fill="#86c46f" />
      <Apple x={176} y={44} />
      <Person x={120} y={80} armL={[-18, 40]} armR={[50, -32]} />
      <circle cx={176} cy={44} r="26" fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="6 5" />
    </svg>
  )
}

export function HowHold() {
  return (
    <svg viewBox="0 0 240 150" role="img" aria-label="停一下，等金色圆圈转满">
      <rect width="240" height="150" rx="18" fill="#e8f6fb" />
      <Apple x={120} y={74} r={30} />
      <circle cx="120" cy="74" r="48" fill="none" stroke="#d9e3dc" strokeWidth="10" />
      <path d="M120 26 A48 48 0 1 1 72 74" fill="none" stroke="#ffc94d" strokeWidth="10" strokeLinecap="round" />
      <circle cx="146" cy="96" r="14" fill="none" stroke={RIGHT} strokeWidth="5" />
    </svg>
  )
}

export function HowBasket() {
  return (
    <svg viewBox="0 0 240 150" role="img" aria-label="苹果落进篮子">
      <rect width="240" height="150" rx="18" fill="#e8f6fb" />
      <path d="M70 40 Q120 0 160 80" fill="none" stroke="#ffc94d" strokeWidth="4" strokeDasharray="6 8" />
      <Apple x={70} y={40} r={14} />
      <path d="M80 92 L160 92 L150 136 Q120 142 90 136 Z" fill="#c08a55" />
      <ellipse cx="120" cy="92" rx="42" ry="8" fill="#e2b47d" />
      <Apple x={108} y={84} r={11} />
      <Apple x={132} y={86} r={11} />
      <text x="172" y="58" fontSize="22" fontWeight="800" fill="#2f6b4f">+10</text>
    </svg>
  )
}

export function PositioningArt({ seated }: { seated: boolean }) {
  return (
    <svg viewBox="0 0 520 330" role="img" aria-label={seated ? '坐姿站位示意图' : '站姿站位示意图'}>
      <rect width="520" height="330" rx="26" fill="#e8f6fb" />
      <rect x="0" y="268" width="520" height="62" fill="#d8eecf" />
      {/* screen + camera */}
      <rect x="28" y="96" width="120" height="84" rx="10" fill={INK} />
      <rect x="36" y="104" width="104" height="66" rx="6" fill="#86c46f" />
      <rect x="78" y="180" width="20" height="40" fill="#4a6357" />
      <rect x="58" y="218" width="60" height="10" rx="5" fill="#4a6357" />
      <circle cx="88" cy="91" r="7" fill="#ffc94d" stroke={INK} strokeWidth="3" />
      {/* field of view */}
      <path d="M88 91 L500 20 L500 300 Z" fill="#ffc94d" opacity="0.13" />
      {/* distance arrow */}
      <path d="M100 292 L330 292" stroke={INK} strokeWidth="3" markerEnd="url(#arrow)" markerStart="url(#arrow)" />
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill={INK} />
        </marker>
      </defs>
      <rect x="168" y="300" width="96" height="26" rx="13" fill="#fff" />
      <text x="216" y="319" fontSize="18" fontWeight="700" textAnchor="middle" fill={INK}>{seated ? '约 1.5 米' : '1.5 – 2 米'}</text>
      <g transform="translate(0,0)">
        <Person x={380} y={seated ? 170 : 128} armL={[-46, -40]} armR={[46, -40]} seated={seated} />
      </g>
      {/* room to reach */}
      <circle cx="380" cy={seated ? 120 : 78} r="104" fill="none" stroke="#2f6b4f" strokeWidth="3" strokeDasharray="8 8" opacity="0.5" />
    </svg>
  )
}

export function RaiseHandArt({ side }: { side: 'left' | 'right' | 'none' }) {
  const up: [number, number] = side === 'left' ? [-34, -52] : [34, -52]
  const down = (s: 'l' | 'r'): [number, number] => [s === 'l' ? -14 : 14, 46]
  return (
    <svg viewBox="0 0 200 170" role="img" aria-label={side === 'none' ? '双手自然放下' : side === 'left' ? '举起左手' : '举起右手'} style={{ width: 150, height: 128 }}>
      <rect width="200" height="170" rx="20" fill="#e8f6fb" />
      <Person x={100} y={86} armL={side === 'left' ? up : down('l')} armR={side === 'right' ? up : down('r')} />
    </svg>
  )
}
