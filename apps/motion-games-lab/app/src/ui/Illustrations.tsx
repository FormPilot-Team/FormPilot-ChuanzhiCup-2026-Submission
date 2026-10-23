// Simple flat illustrations for the instruction pages (inline SVG, same palette as the world).
const INK = '#1f3a2e'
const SKIN = '#f3c7a6'
const SHIRT = '#4f9a55'
/** hands: the same warm white as the in-game hand cursor, for both hands (no left/right colours) */
const HAND = '#fbf2e6'
const HAND_LINE = '#8a6d55'
const ACCENT = '#e0a21b'
const PANTS = '#3c5a8a'
const CHAIR = '#c08a55'
const CHAIR_DARK = '#8a5a32'

function Hand({ x, y, r = 8 }: { x: number; y: number; r?: number }) {
  return <circle cx={x} cy={y} r={r} fill={HAND} stroke={HAND_LINE} strokeWidth="2" />
}

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

function Person({ x, y, armL, armR, seated = false, elbowL, elbowR }: {
  x: number
  y: number
  armL: [number, number]
  armR: [number, number]
  seated?: boolean
  /** optional elbow offsets from the shoulder (bent arms) */
  elbowL?: [number, number]
  elbowR?: [number, number]
}) {
  // armX = [elbowX, elbowY] etc. expressed as wrist offset from shoulder
  const sl = { x: x - 22, y: y }
  const sr = { x: x + 22, y: y }
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      {/* seated, facing the camera: the chair sits behind the player, its legs outside the player's legs */}
      {seated && <rect x={x - 48} y={y + 54} width="96" height="11" rx="5" fill={CHAIR} />}
      {seated && <rect x={x - 46} y={y + 63} width="8" height="44" rx="2" fill={CHAIR_DARK} />}
      {seated && <rect x={x + 38} y={y + 63} width="8" height="44" rx="2" fill={CHAIR_DARK} />}
      <path d={`M${x - 26} ${y - 4} Q${x} ${y - 12} ${x + 26} ${y - 4} L${x + 20} ${y + 60} L${x - 20} ${y + 60} Z`} fill={SHIRT} />
      {!seated && <path d={`M${x - 14} ${y + 60} L${x - 16} ${y + 120} M${x + 14} ${y + 60} L${x + 16} ${y + 120}`} stroke={PANTS} strokeWidth="14" />}
      {seated && (
        <g data-testid="seated-legs">
          {/* thighs come toward the camera (short), knees a little apart, shins straight down, feet on the floor */}
          <path d={`M${x - 11} ${y + 60} L${x - 19} ${y + 74} L${x - 20} ${y + 108}`} stroke={PANTS} strokeWidth="14" fill="none" />
          <path d={`M${x + 11} ${y + 60} L${x + 19} ${y + 74} L${x + 20} ${y + 108}`} stroke={PANTS} strokeWidth="14" fill="none" />
          <circle cx={x - 19} cy={y + 74} r="7.5" fill="#4a6aa0" />
          <circle cx={x + 19} cy={y + 74} r="7.5" fill="#4a6aa0" />
          <ellipse cx={x - 23} cy={y + 113} rx="11" ry="5" fill="#3a3a44" />
          <ellipse cx={x + 23} cy={y + 113} rx="11" ry="5" fill="#3a3a44" />
        </g>
      )}
      <polyline points={`${sl.x},${sl.y} ${elbowL ? `${sl.x + elbowL[0]},${sl.y + elbowL[1]} ` : ''}${sl.x + armL[0]},${sl.y + armL[1]}`} stroke={SKIN} strokeWidth="11" fill="none" />
      <polyline points={`${sr.x},${sr.y} ${elbowR ? `${sr.x + elbowR[0]},${sr.y + elbowR[1]} ` : ''}${sr.x + armR[0]},${sr.y + armR[1]}`} stroke={SKIN} strokeWidth="11" fill="none" />
      <Hand x={sl.x + armL[0]} y={sl.y + armL[1]} />
      <Hand x={sr.x + armR[0]} y={sr.y + armR[1]} />
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
      <Hand x={146} y={96} r={13} />
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

// ---------- Boating ----------

function Water() {
  return (
    <g>
      <path d="M0 112 Q60 104 120 112 T240 112 L240 150 L0 150 Z" fill="#5cb8d6" />
      <path d="M20 124 q14 -6 28 0 M150 132 q14 -6 28 0 M90 140 q14 -6 28 0" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.7" />
    </g>
  )
}

export function HowPaddleReady() {
  return (
    <svg viewBox="0 0 240 150" role="img" aria-label="两手放在身前，手肘靠近身体">
      <rect width="240" height="150" rx="18" fill="#e8f6fb" />
      <Water />
      <Person x={120} y={50} elbowL={[-6, 34]} armL={[14, 52]} elbowR={[6, 34]} armR={[-14, 52]} />
    </svg>
  )
}

export function HowPaddleSweep() {
  // one stroke in three beats: ① hand in front of the body → ② sweep outward → ③ back in front
  return (
    <svg viewBox="0 0 240 150" role="img" aria-label="从身前向外划开，再回到身前">
      <rect width="240" height="150" rx="18" fill="#e8f6fb" />
      <Water />
      <defs>
        <marker id="sweep-out" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill={ACCENT} />
        </marker>
        <marker id="sweep-back" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="#2f6b4f" />
        </marker>
      </defs>
      {/* where the right hand starts: a faint arm in front of the body */}
      <g opacity="0.38">
        <polyline points="142,50 148,84 130,100" stroke={SKIN} strokeWidth="11" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Hand x={130} y={100} />
      </g>
      <Person x={120} y={50} elbowL={[-6, 34]} armL={[14, 52]} elbowR={[8, 34]} armR={[54, 42]} />
      <path d="M134 108 Q162 116 190 102" fill="none" stroke={ACCENT} strokeWidth="4.5" strokeLinecap="round" markerEnd="url(#sweep-out)" />
      <path d="M192 120 Q164 132 138 124" fill="none" stroke="#2f6b4f" strokeWidth="3.5" strokeDasharray="5 5" strokeLinecap="round" markerEnd="url(#sweep-back)" />
      <g fontSize="14" fontWeight="800" fill="#1f3a2e" textAnchor="middle">
        <rect x="58" y="7" width="176" height="22" rx="11" fill="#fffaf0" opacity="0.92" />
        <text x="146" y="23">身前 → 向外 → 回到身前</text>
      </g>
    </svg>
  )
}

export function HowLantern() {
  return (
    <svg viewBox="0 0 240 150" role="img" aria-label="顺路收下水面上的花灯">
      <rect width="240" height="150" rx="18" fill="#e8f6fb" />
      <Water />
      <path d="M86 110 L154 110 Q148 132 120 134 Q92 132 86 110 Z" fill="#8a5a32" />
      <rect x="88" y="104" width="64" height="8" rx="4" fill="#c08a55" />
      <g transform="translate(184 106)">
        <circle r="18" fill="#ffe7a0" opacity="0.6" />
        <path d="M-14 4 Q-10 -12 0 -16 Q10 -12 14 4 Z" fill="#f59fb8" />
        <path d="M-8 4 Q0 -20 8 4 Z" fill="#ffd0dd" />
        <rect x="-14" y="2" width="28" height="6" rx="3" fill="#6fb35d" />
      </g>
      <text x="176" y="72" fontSize="22" fontWeight="800" fill="#2f6b4f">+20</text>
    </svg>
  )
}

// ---------- Archery ----------

function Bow({ x, y, bend, flip = false }: { x: number; y: number; bend: number; flip?: boolean }) {
  const s = flip ? -1 : 1
  return (
    <g>
      <path d={`M${x} ${y - 34} Q${x - s * (16 + bend)} ${y} ${x} ${y + 34}`} fill="none" stroke="#8a5a32" strokeWidth="5" strokeLinecap="round" />
      <path d={`M${x} ${y - 34} L${x + s * bend * 1.6} ${y} L${x} ${y + 34}`} fill="none" stroke="#fffaf0" strokeWidth="2" />
    </g>
  )
}

export function HowBowReady() {
  return (
    <svg viewBox="0 0 240 150" role="img" aria-label="双手合在胸前">
      <rect width="240" height="150" rx="18" fill="#e8f6fb" />
      <Person x={120} y={60} elbowL={[-10, 30]} armL={[16, 30]} elbowR={[10, 30]} armR={[-16, 30]} />
      <Bow x={120} y={88} bend={0} />
    </svg>
  )
}

/** Bow held in the left (screen-left) hand, string pulled to `nock`. */
function DrawnBow({ grip, nock }: { grip: [number, number]; nock: [number, number] }) {
  const [gx, gy] = grip
  return (
    <g>
      <path d={`M${gx + 6} ${gy - 36} Q${gx - 18} ${gy} ${gx + 6} ${gy + 36}`} fill="none" stroke="#8a5a32" strokeWidth="5" strokeLinecap="round" />
      <path d={`M${gx + 6} ${gy - 36} L${nock[0]} ${nock[1]} L${gx + 6} ${gy + 36}`} fill="none" stroke="#fffaf0" strokeWidth="2" />
    </g>
  )
}

function SmallTarget({ x, y, r = 17 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#f4ead2" />
      <circle cx={x} cy={y} r={r * 0.72} fill="#e5483b" />
      <circle cx={x} cy={y} r={r * 0.46} fill="#f4ead2" />
      <circle cx={x} cy={y} r={r * 0.22} fill="#ffc94d" />
    </g>
  )
}

function Label({ x, y, text, w }: { x: number; y: number; text: string; w: number }) {
  return (
    <g>
      <rect x={x - w / 2} y={y - 17} width={w} height="24" rx="12" fill="#fffaf0" opacity="0.94" />
      <text x={x} y={y} fontSize="15" fontWeight="800" fill="#2f6b4f" textAnchor="middle">{text}</text>
    </g>
  )
}

export function HowBowDraw() {
  // bow hand out to the left (it aims: up / down moves the reticle), string hand pulled out to the right
  return (
    <svg viewBox="0 0 240 150" role="img" aria-label="两手向两边拉开弓，用持弓的手上下瞄准，稳住等圆圈转满">
      <rect width="240" height="150" rx="18" fill="#e8f6fb" />
      <Person x={130} y={66} armL={[-66, 0]} elbowR={[22, 12]} armR={[44, -2]} />
      <DrawnBow grip={[42, 66]} nock={[196, 64]} />
      {/* up / down aiming arrows beside the bow hand */}
      <path d="M22 50 v-16 m-6 6 l6 -7 l6 7 M22 82 v16 m-6 -6 l6 7 l6 -7" stroke={ACCENT} strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* the reticle on a small target, with the hold ring */}
      <SmallTarget x={204} y={28} r={16} />
      <circle cx="204" cy="28" r="22" fill="none" stroke="#d9e3dc" strokeWidth="5" />
      <path d="M204 6 A22 22 0 1 1 182 28" fill="none" stroke="#ffc94d" strokeWidth="5" strokeLinecap="round" />
      <Label x={120} y={140} w={150} text="拉开 · 上下瞄准 · 稳住" />
    </svg>
  )
}

export function HowBowReturn() {
  // the string hand comes back from its drawn position to the chest → the arrow flies to the target
  return (
    <svg viewBox="0 0 240 150" role="img" aria-label="把拉弦的手从拉开的位置收回胸前，箭就射出去">
      <rect width="240" height="150" rx="18" fill="#e8f6fb" />
      <Person x={130} y={66} armL={[-66, 0]} elbowR={[30, 26]} armR={[-6, 26]} />
      <DrawnBow grip={[42, 66]} nock={[48, 66]} />
      {/* where the string hand was: a dashed ghost hand */}
      <circle cx="196" cy="64" r="9" fill="none" stroke={HAND_LINE} strokeWidth="2" strokeDasharray="3 3" />
      {/* the direction: from there back to the chest */}
      <path d="M186 70 Q164 98 136 94" fill="none" stroke={ACCENT} strokeWidth="5" strokeLinecap="round" />
      <path d="M131 94 l13 -9 l-1 9 l1 9 z" fill={ACCENT} />
      {/* the arrow flies off the bow to the target */}
      <SmallTarget x={26} y={24} r={15} />
      <path d="M60 52 L32 30" stroke="#553623" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M30 28 l3 10 l4 -5 l6 -1 z" fill="#553623" />
      <path d="M66 50 l6 -2 M70 55 l6 -1" stroke="#fffaf0" strokeWidth="3" strokeLinecap="round" />
      <Label x={120} y={140} w={176} text="收回胸前 → 箭射出！" />
    </svg>
  )
}
